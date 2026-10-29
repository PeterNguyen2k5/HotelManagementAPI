using System.Data;
using HotelManagementAPI.Data;
using HotelManagementAPI.Models;
using Microsoft.EntityFrameworkCore;

namespace HotelManagementAPI.Services;

public sealed class BookingHolds(HotelDbContext db, HotelWorkflow workflow, TimeProvider clock)
{
    public const int Minutes = 30;
    public const string ExpiredMessage = "Đã hết hạn thanh toán 30 phút. Booking đã hủy và phòng được mở đặt lại. Vui lòng đặt phòng mới; khoản chuyển đến muộn cần liên hệ lễ tân đối soát.";
    public static DateTime? Utc(DateTime? value) => value.HasValue ? DateTime.SpecifyKind(value.Value, DateTimeKind.Utc) : null;
    public static bool HasReceipt(Booking booking) => booking.Payments.Any(p => p.Amount > 0 && (p.Type == "Deposit" || p.Type == "Payment"));
    public static bool AwaitingPayment(Booking booking) => booking.Status == BookingStates.Reserved && booking.PaymentDueAtUtc.HasValue && !HasReceipt(booking);
    public static IQueryable<Booking> Blocking(HotelDbContext db, DateTime utcNow) => db.Bookings.Where(b =>
        b.Status == BookingStates.CheckedIn || b.Status == BookingStates.Reserved &&
        (b.PaymentDueAtUtc == null || b.PaymentDueAtUtc > utcNow ||
         b.Payments.Any(p => p.Amount > 0 && (p.Type == "Deposit" || p.Type == "Payment"))));

    // The caller owns the serializable transaction and must commit an expired result.
    public async Task<bool> TryExpire(Booking booking)
    {
        if (booking.HoldExpiredAtUtc.HasValue) return true;
        if (booking.Status != BookingStates.Reserved || !booking.PaymentDueAtUtc.HasValue || booking.PaymentDueAtUtc > clock.GetUtcNow().UtcDateTime)
            return false;
        if (await db.BookingPayments.AnyAsync(p => p.BookingId == booking.Id && p.Amount > 0 && (p.Type == "Deposit" || p.Type == "Payment"))) return false;
        await workflow.Cancel(booking);
        booking.HoldExpiredAtUtc = clock.GetUtcNow().UtcDateTime;
        foreach (var entry in db.ChangeTracker.Entries<BookingRequest>().Where(x => x.Entity.BookingId == booking.Id && x.State == EntityState.Modified))
        { entry.Entity.StaffNote = ExpiredMessage; entry.Entity.ResolvedBy = "System"; }
        return true;
    }

    public async Task Reap(CancellationToken cancellationToken = default)
    {
        var now = clock.GetUtcNow().UtcDateTime;
        var due = db.Bookings.Where(b => b.Status == BookingStates.Reserved && b.PaymentDueAtUtc != null && b.PaymentDueAtUtc <= now &&
            !b.Payments.Any(p => p.Amount > 0 && (p.Type == "Deposit" || p.Type == "Payment")));
        if (!await due.AnyAsync(cancellationToken)) return;
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken);
        foreach (var booking in await due.OrderBy(b => b.PaymentDueAtUtc).Take(100).ToListAsync(cancellationToken))
            await TryExpire(booking);
        await db.SaveChangesAsync(cancellationToken);
        await tx.CommitAsync(cancellationToken);
    }
}

public sealed class BookingHoldExpiryService(IServiceScopeFactory scopes, ILogger<BookingHoldExpiryService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(15));
        do
        {
            try
            {
                using var scope = scopes.CreateScope();
                await scope.ServiceProvider.GetRequiredService<BookingHolds>().Reap(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception ex) { logger.LogError(ex, "Cannot expire unpaid booking holds; will retry."); }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}

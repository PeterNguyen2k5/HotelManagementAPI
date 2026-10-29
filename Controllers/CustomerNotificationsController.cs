using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Security.Claims;
using HotelManagementAPI.Data;
using HotelManagementAPI.Services;
using HotelManagementAPI.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace HotelManagementAPI.Controllers;

[ApiController, Route("api/CustomerNotifications"), Authorize(Roles = Roles.Customer)]
public sealed class CustomerNotificationsController(HotelDbContext db, BookingHolds holds, TimeProvider clock) : ControllerBase
{
    public sealed record ReadRequest([Required, MaxLength(100)] string[] Keys);
    private sealed record Item(string Id, int BookingId, string Kind, string Title, string Message, DateTime CreatedAtUtc, bool IsRead = false);
    private Task<int> CustomerId() => db.CustomerAccounts.Where(x => x.Id == int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!) && x.IsActive)
        .Select(x => x.CustomerId).FirstAsync();
    private DateTime Utc(DateTime local) => TimeZoneInfo.ConvertTimeToUtc(DateTime.SpecifyKind(local, DateTimeKind.Unspecified), clock.LocalTimeZone);

    // Stable source IDs make retries and polling idempotent. Read receipts survive sign-out and restart.
    private async Task<List<Item>> Feed(int customerId)
    {
        var items = new List<Item>();
        var bookings = await db.Bookings.AsNoTracking().Include(x => x.Payments)
            .Where(x => x.CustomerId == customerId && x.PaymentDueAtUtc != null).OrderByDescending(x => x.Id).Take(100).ToListAsync();
        foreach (var b in bookings)
        {
            var due = BookingHolds.Utc(b.PaymentDueAtUtc)!.Value;
            items.Add(new($"hold-{b.Id}", b.Id, "deadline", "Hạn thanh toán booking #" + b.Id,
                $"Thanh toán cọc trước {TimeZoneInfo.ConvertTimeFromUtc(due, clock.LocalTimeZone):HH:mm dd/MM/yyyy} (giờ khách sạn). Chưa nhận được tiền khi hết hạn 30 phút thì booking tự hủy.", due.AddMinutes(-BookingHolds.Minutes)));
            if (BookingHolds.AwaitingPayment(b) && due > clock.GetUtcNow().UtcDateTime && due <= clock.GetUtcNow().UtcDateTime.AddMinutes(5))
                items.Add(new($"reminder-{b.Id}", b.Id, "deadline", "Sắp hết hạn thanh toán #" + b.Id,
                    "Còn dưới 5 phút để thanh toán. Mở booking để xem thời gian còn lại.", due.AddMinutes(-5)));
            if (b.HoldExpiredAtUtc.HasValue)
                items.Add(new($"expired-{b.Id}", b.Id, "expired", "Giữ chỗ đã hết hạn #" + b.Id,
                    "Chưa nhận được khoản thanh toán trong thời hạn. Booking đã tự hủy; bạn có thể chọn phòng và đặt lại.", BookingHolds.Utc(b.HoldExpiredAtUtc)!.Value));
        }
        foreach (var p in await db.BookingPayments.AsNoTracking().Where(x => x.Booking.CustomerId == customerId && x.Amount > 0 &&
                     (x.Type == "Deposit" || x.Type == "Payment" || x.Type == "Refund")).OrderByDescending(x => x.Id).Take(100).ToListAsync())
            items.Add(new($"payment-{p.Id}", p.BookingId, "payment", (p.Type == "Refund" ? "Đã ghi nhận hoàn tiền #" : "Đã nhận tiền booking #") + p.BookingId,
                $"{p.Amount.ToString("N0", CultureInfo.GetCultureInfo("vi-VN"))} đ · {(p.Method == "Transfer" ? "Chuyển khoản" : "Tiền mặt")}. Xem chi tiết trong lịch sử thanh toán.", Utc(p.CreatedAt)));
        foreach (var r in await db.BookingRequests.AsNoTracking().Where(x => x.Booking.CustomerId == customerId && x.Status != "Pending" && x.ResolvedAt != null)
                     .OrderByDescending(x => x.ResolvedAt).Take(100).ToListAsync())
            items.Add(new($"request-{r.Id}", r.BookingId, "request", $"Yêu cầu {(r.Type == "Change" ? "đổi" : "hủy")} phòng #{r.BookingId}: {(r.Status == "Approved" ? "đã chấp thuận" : "đã từ chối")}",
                r.StaffNote ?? "Mở booking để xem phản hồi của khách sạn.", Utc(r.ResolvedAt!.Value)));
        var latest = items.OrderByDescending(x => x.CreatedAtUtc).ThenByDescending(x => x.Id).Take(100).ToList();
        var keys = latest.Select(x => x.Id).ToArray();
        var read = (await db.CustomerNotificationReads.Where(x => x.CustomerId == customerId && keys.Contains(x.EventKey)).Select(x => x.EventKey).ToListAsync()).ToHashSet();
        return latest.Select(x => x with { IsRead = read.Contains(x.Id) }).ToList();
    }

    [HttpGet]
    public async Task<IActionResult> List()
    {
        await holds.Reap(HttpContext.RequestAborted);
        var items = await Feed(await CustomerId());
        Response.Headers.CacheControl = "no-store";
        return Ok(new { items, unreadCount = items.Count(x => !x.IsRead), serverTimeUtc = clock.GetUtcNow() });
    }

    [HttpPost("read")]
    public async Task<IActionResult> Read(ReadRequest request)
    {
        var customerId = await CustomerId();
        var allowed = (await Feed(customerId)).Select(x => x.Id).ToHashSet();
        if (request.Keys.Any(x => x is null || !allowed.Contains(x))) return NotFound();
        foreach (var key in request.Keys.Distinct())
            await db.Database.ExecuteSqlInterpolatedAsync($"INSERT OR IGNORE INTO CustomerNotificationReads (CustomerId, EventKey, ReadAtUtc) VALUES ({customerId}, {key}, {clock.GetUtcNow().UtcDateTime})");
        return NoContent();
    }
}

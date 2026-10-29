using System.Data;
using System.Security.Claims;
using HotelManagementAPI.Data;
using HotelManagementAPI.DTOs;
using HotelManagementAPI.Models;
using HotelManagementAPI.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace HotelManagementAPI.Controllers;

[ApiController, Route("api/[controller]"), Authorize]
public sealed class BookingsController(HotelDbContext db, TimeProvider clock, HotelWorkflow workflow, BookingHolds holds) : ControllerBase
{
    [HttpGet, Authorize(Roles = Roles.Staff)]
    public async Task<IActionResult> List([FromQuery] BookingQuery query)
    {
        await holds.Reap();
        if (!string.IsNullOrWhiteSpace(query.Status) &&
            query.Status is not (BookingStates.Reserved or BookingStates.CheckedIn or
                BookingStates.CheckedOut or BookingStates.Cancelled))
            return BadRequest(new { message = "Trạng thái booking không hợp lệ." });
        if (!BookingAttention.Valid(query.Attention))
            return BadRequest(new { message = "Bộ lọc công việc không hợp lệ." });
        var rows = BookingAttention.Filter(ApiSupport.FullBookings(db).AsNoTracking(), query.Attention, clock.GetLocalNow().Date);
        if (!string.IsNullOrWhiteSpace(query.CustomerKeyword))
        {
            // Escape LIKE wildcards so search text is always treated literally.
            var term = query.CustomerKeyword.Trim().Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");
            var pattern = "%" + term + "%";
            rows = rows.Where(x => EF.Functions.Like(x.Customer.FullName, pattern, "\\") ||
                (x.Customer.Phone != null && EF.Functions.Like(x.Customer.Phone, pattern, "\\")) ||
                (x.Customer.Email != null && EF.Functions.Like(x.Customer.Email, pattern, "\\")) ||
                (x.Customer.IdentityCard != null && EF.Functions.Like(x.Customer.IdentityCard, pattern, "\\")));
        }
        if (!string.IsNullOrWhiteSpace(query.RoomNumber))
        {
            var roomNumber = query.RoomNumber.Trim();
            rows = rows.Where(x => x.Room.RoomNumber.Contains(roomNumber));
        }
        if (query.FromDate.HasValue)
        {
            var start = query.FromDate.Value.Date;
            rows = rows.Where(x => x.CheckOutDate > start);
        }
        if (query.ToDate.HasValue)
        {
            var exclusiveEnd = query.ToDate.Value.Date.AddDays(1);
            rows = rows.Where(x => x.CheckInDate < exclusiveEnd);
        }
        if (query.CustomerId.HasValue) rows = rows.Where(x => x.CustomerId == query.CustomerId);
        if (query.RoomId.HasValue) rows = rows.Where(x => x.RoomId == query.RoomId);
        if (query.Status is not null) rows = rows.Where(x => x.Status == query.Status);
        var count = await rows.CountAsync();
        var skip = (long)(query.PageNumber - 1) * query.PageSize;
        var bookings = skip >= count ? new List<Booking>() :
            await rows.OrderByDescending(x => x.Id).Skip((int)skip).Take(query.PageSize).ToListAsync();
        return Ok(ApiSupport.Page(bookings.Select(ApiSupport.BookingView).ToList(),
            count, query.PageNumber, query.PageSize));
    }

    [HttpGet("{id:int}"), Authorize(Roles = Roles.Staff)]
    public async Task<IActionResult> Get(int id)
    {
        var booking = await ApiSupport.FullBookings(db).AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == id);
        return booking is null ? NotFound() : Ok(ApiSupport.BookingView(booking));
    }

    [HttpGet("guest-options"), AllowAnonymous]
    public async Task<IActionResult> GuestOptions(CancellationToken cancellationToken)
    {
        Response.Headers.CacheControl = "no-store";
        var capacity = await db.Rooms.AsNoTracking().Select(x => (int?)x.Capacity).MaxAsync(cancellationToken);
        return Ok(new { maxGuests = Math.Clamp(capacity ?? 1, 1, 100) });
    }

    [HttpGet("available-rooms"), AllowAnonymous]
    public async Task<IActionResult> Available([FromQuery] AvailableRoomsQuery query)
    {
        var start = query.CheckInDate!.Value.Date;
        var end = query.CheckOutDate!.Value.Date;
        var today = clock.GetLocalNow().Date;
        if (start < today)
            return BadRequest(new { message = "Ngày nhận phòng không thể ở trong quá khứ." });
        var rooms = await db.Rooms.AsNoTracking().Include(x => x.RoomType)
            .Where(x => x.Capacity >= query.GuestCount && x.Status != RoomStatus.Maintenance &&
                (x.Status == RoomStatus.Available || (x.Status == RoomStatus.Cleaning && start > today) ||
                 db.Bookings.Any(b => b.RoomId == x.Id && b.Status == BookingStates.CheckedIn)) &&
                !BookingHolds.Blocking(db, clock.GetUtcNow().UtcDateTime).Any(b => b.RoomId == x.Id &&
                    (b.Status == BookingStates.CheckedIn && b.CheckOutDate <= today ||
                     b.CheckInDate < end && start < b.CheckOutDate)))
            .OrderBy(x => x.RoomNumber).ToListAsync();
        return Ok(rooms.Select(ApiSupport.RoomView));
    }

    [HttpPost, Authorize(Roles = Roles.Staff)]
    public async Task<IActionResult> Create(BookingCreate request)
    {
        var start = request.CheckInDate!.Value.Date;
        var end = request.CheckOutDate!.Value.Date;
        var today = clock.GetLocalNow().Date;
        if (start < today)
            return BadRequest(new { message = "Ngày nhận phòng không thể ở trong quá khứ." });
        try
        {
            await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            if (!await db.Customers.AnyAsync(x => x.Id == request.CustomerId))
                return BadRequest(new { message = "Khách hàng không tồn tại." });
            var room = await db.Rooms.FirstOrDefaultAsync(x => x.Id == request.RoomId);
            if (room is null) return BadRequest(new { message = "Phòng không tồn tại." });
            if (request.GuestCount > room.Capacity)
                return BadRequest(new { message = "Số khách vượt quá sức chứa của phòng." });
            if (room.Status == RoomStatus.Maintenance || (room.Status == RoomStatus.Cleaning && start <= today) ||
                (room.Status == RoomStatus.Occupied &&
                 !await db.Bookings.AnyAsync(x => x.RoomId == room.Id && x.Status == BookingStates.CheckedIn)))
                return Conflict(new { message = "Phòng không khả dụng." });
            if (await BookingHolds.Blocking(db, clock.GetUtcNow().UtcDateTime).AnyAsync(x => x.RoomId == room.Id &&
                (x.Status == BookingStates.CheckedIn && x.CheckOutDate <= today ||
                 x.CheckInDate < end && start < x.CheckOutDate)))
                return Conflict(new { message = "Phòng đã được đặt hoặc khách hiện tại chưa trả phòng." });
            var nights = (end - start).Days;
            if (!TryAmount(room.Price, nights, out var total))
                return BadRequest(new { message = "Tiền phòng vượt giới hạn." });
            var booking = new Booking
            {
                CustomerId = request.CustomerId, RoomId = room.Id,
                GuestCount = request.GuestCount, CheckInDate = start, CheckOutDate = end, Note = request.Note?.Trim(),
                Detail = new BookingDetail
                {
                    RoomPricePerNight = room.Price, Nights = nights, RoomTotal = total
                }
            };
            db.Bookings.Add(booking);
            await db.SaveChangesAsync();
            await tx.CommitAsync();
            return CreatedAtAction(nameof(Get), new { id = booking.Id },
                ApiSupport.BookingView((await ApiSupport.FullBookings(db)
                    .AsNoTracking().FirstAsync(x => x.Id == booking.Id))));
        }
        catch (Exception ex) when (ApiSupport.Busy(ex) ||
            ex is DbUpdateException update && ApiSupport.ForeignKey(update))
        { return Conflict(new { message = "Dữ liệu đặt phòng đã thay đổi. Hãy thử lại." }); }
    }

    [HttpPost("public"), Authorize(Roles = Roles.Customer), EnableRateLimiting("public-booking")]
    public async Task<IActionResult> CreatePublic(PublicBookingCreate request)
    {
        var start = request.CheckInDate!.Value.Date;
        var end = request.CheckOutDate!.Value.Date;
        var today = clock.GetLocalNow().Date;
        if (start < today)
            return BadRequest(new { message = "Ngày nhận phòng không thể ở trong quá khứ." });
        try
        {
            await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            var room = await db.Rooms.FirstOrDefaultAsync(x => x.Id == request.RoomId);
            if (room is null || room.Status == RoomStatus.Maintenance || (room.Status == RoomStatus.Cleaning && start <= today) ||
                (room.Status == RoomStatus.Occupied &&
                 !await db.Bookings.AnyAsync(x => x.RoomId == room.Id &&
                     x.Status == BookingStates.CheckedIn)))
                return Conflict(new { message = "Phòng không khả dụng." });
            if (request.GuestCount > room.Capacity)
                return BadRequest(new { message = "Số khách vượt quá sức chứa của phòng." });
            if (await BookingHolds.Blocking(db, clock.GetUtcNow().UtcDateTime).AnyAsync(x => x.RoomId == room.Id &&
                (x.Status == BookingStates.CheckedIn && x.CheckOutDate <= today ||
                 x.CheckInDate < end && start < x.CheckOutDate)))
                return Conflict(new { message = "Phòng đã được đặt hoặc khách hiện tại chưa trả phòng." });
            var nights = (end - start).Days;
            if (!TryAmount(room.Price, nights, out var total))
                return BadRequest(new { message = "Tiền phòng vượt giới hạn." });
            var accountId = int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
            var account = await db.CustomerAccounts.Include(x => x.Customer)
                .FirstOrDefaultAsync(x => x.Id == accountId && x.IsActive);
            if (account is null) return Unauthorized();
            var booking = new Booking
            {
                Customer = account.Customer, RoomId = room.Id,
                PaymentDueAtUtc = total > 0 ? clock.GetUtcNow().UtcDateTime.AddMinutes(BookingHolds.Minutes) : null,
                GuestCount = request.GuestCount, CheckInDate = start, CheckOutDate = end,
                Note = request.Note?.Trim(),
                Detail = new BookingDetail
                {
                    RoomPricePerNight = room.Price, Nights = nights, RoomTotal = total
                }
            };
            db.Bookings.Add(booking);
            await db.SaveChangesAsync();
            await tx.CommitAsync();
            return StatusCode(StatusCodes.Status201Created, new
            {
                booking.Id, booking.Status, booking.GuestCount, room.RoomNumber,
                booking.CheckInDate, booking.CheckOutDate, totalAmount = total,
                paymentDueAtUtc = BookingHolds.Utc(booking.PaymentDueAtUtc), serverTimeUtc = clock.GetUtcNow()
            });
        }
        catch (Exception ex) when (ApiSupport.Busy(ex) ||
            ex is DbUpdateException update && ApiSupport.ForeignKey(update))
        { return Conflict(new { message = "Phòng vừa được đặt. Hãy chọn phòng khác." }); }
    }

    [HttpPost("{id:int}/check-in"), Authorize(Roles = Roles.Staff)]
    public async Task<IActionResult> CheckIn(int id)
    {
        try
        {
            await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            var booking = await ApiSupport.FullBookings(db).FirstOrDefaultAsync(x => x.Id == id);
            if (booking is null) return NotFound();
            if (await holds.TryExpire(booking)) { await db.SaveChangesAsync(); await tx.CommitAsync(); return Conflict(new { message = BookingHolds.ExpiredMessage }); }
            if (BookingHolds.AwaitingPayment(booking)) return Conflict(new { message = "Booking giữ chỗ cần được ghi nhận tiền cọc trước khi nhận phòng." });
            if (booking.Status != BookingStates.Reserved)
                return Conflict(new { message = "Trạng thái booking không cho phép check-in." });
            var now = clock.GetLocalNow().DateTime;
            if (now.Date < booking.CheckInDate.Date || now >= booking.CheckOutDate ||
                booking.Room.Status != RoomStatus.Available)
                return Conflict(new { message = "Phòng hoặc ngày nhận phòng không khả dụng." });
            booking.Status = BookingStates.CheckedIn;
            booking.ActualCheckInAt = now;
            booking.CurrentRoomSince = now.Date;
            booking.Revision++;
            booking.Room.Status = RoomStatus.Occupied;
            await db.SaveChangesAsync();
            await tx.CommitAsync();
            return Ok(ApiSupport.BookingView(await ApiSupport.FullBookings(db)
                .AsNoTracking().FirstAsync(x => x.Id == id)));
        }
        catch (Exception ex) when (ApiSupport.Busy(ex))
        { return Conflict(new { message = "Booking đang được cập nhật. Hãy thử lại." }); }
    }

    [HttpPost("{id:int}/check-out"), Authorize(Roles = Roles.Staff)]
    public async Task<IActionResult> CheckOut(int id)
    {
        try
        {
            await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            var booking = await ApiSupport.FullBookings(db).FirstOrDefaultAsync(x => x.Id == id);
            if (booking is null) return NotFound();
            if (booking.Status != BookingStates.CheckedIn || !booking.ActualCheckInAt.HasValue)
                return Conflict(new { message = "Booking chưa check-in hoặc đã trả phòng." });
            var now = clock.GetLocalNow().DateTime;
            if (now <= booking.ActualCheckInAt.Value)
                return Conflict(new { message = "Thời gian trả phòng không hợp lệ." });
            workflow.CloseRoomSegment(booking,now,true);
            booking.Detail.Nights = booking.RoomCharges.Sum(x=>x.Nights);
            booking.Detail.RoomTotal = booking.RoomCharges.Sum(x=>x.Total);
            if(booking.Detail.RoomTotal>9999999999999999.99m)throw new WorkflowConflict("Tiền phòng vượt giới hạn.");
            booking.ActualCheckOutAt = now;
            booking.Status = BookingStates.CheckedOut;
            booking.Room.Status = RoomStatus.Cleaning;
            booking.Revision++;
            workflow.IssueInvoice(booking);
            await db.SaveChangesAsync();
            await tx.CommitAsync();
            return Ok(ApiSupport.BookingView(await ApiSupport.FullBookings(db)
                .AsNoTracking().FirstAsync(x => x.Id == id)));
        }
        catch(WorkflowConflict ex){return BadRequest(new {message=ex.Message});}
        catch (Exception ex) when (ApiSupport.Busy(ex))
        { return Conflict(new { message = "Booking đang được cập nhật. Hãy thử lại." }); }
    }

    [HttpPost("{id:int}/cancel"), Authorize(Roles = Roles.Staff)]
    public async Task<IActionResult> Cancel(int id)
    {
        try {
            await using var tx=await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            var booking=await ApiSupport.FullBookings(db).FirstOrDefaultAsync(x=>x.Id==id);
            if(booking is null)return NotFound();
            await workflow.Cancel(booking);await db.SaveChangesAsync();await tx.CommitAsync();
            return Ok(ApiSupport.BookingView(booking));
        }catch(WorkflowConflict ex){return Conflict(new {message=ex.Message});}
        catch(Exception ex) when(ApiSupport.Busy(ex)){return Conflict(new {message="Booking đang cập nhật. Hãy thử lại."});}
    }

    private static bool TryAmount(decimal unit, int quantity, out decimal result)
    {
        result = 0;
        try
        {
            result = checked(unit * quantity);
            return result <= 9999999999999999.99m;
        }
        catch (OverflowException) { return false; }
    }
}

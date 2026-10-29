using System.Security.Claims;
using HotelManagementAPI.Data;
using HotelManagementAPI.DTOs;
using HotelManagementAPI.Models;
using HotelManagementAPI.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
namespace HotelManagementAPI.Controllers;

[ApiController, Route("api/CustomerPortal"), Authorize(Roles = Roles.Customer)]
public sealed class CustomerPortalController(HotelDbContext db) : ControllerBase
{
    private Task<int> CustomerId() => db.CustomerAccounts
        .Where(x => x.Id == int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!) && x.IsActive)
        .Select(x => x.CustomerId).FirstAsync();
    private IQueryable<Booking> FullOwned(int customerId) => ApiSupport.FullBookings(db).AsNoTracking()
        .Include(x => x.Room).ThenInclude(x => x.RoomType).Where(x => x.CustomerId == customerId);

    [HttpGet("summary")]
    public async Task<IActionResult> Summary()
    {
        var customerId = await CustomerId();
        var bookings = await FullOwned(customerId).ToListAsync();
        var pending = await db.BookingRequests.CountAsync(x => x.Booking.CustomerId == customerId && x.Status == "Pending");
        return Ok(new
        {
            totalBookings = bookings.Count,
            reserved = bookings.Count(x => x.Status == BookingStates.Reserved),
            checkedIn = bookings.Count(x => x.Status == BookingStates.CheckedIn),
            checkedOut = bookings.Count(x => x.Status == BookingStates.CheckedOut),
            cancelled = bookings.Count(x => x.Status == BookingStates.Cancelled),
            pendingRequests = pending,
            paidAmount = bookings.Sum(HotelWorkflow.Paid),
            amountDue = bookings.Sum(x => Math.Max(0, HotelWorkflow.Gross(x) - HotelWorkflow.Paid(x))),
            refundDue = bookings.Sum(x => Math.Max(0, HotelWorkflow.Paid(x) - HotelWorkflow.Gross(x)))
        });
    }

    [HttpGet("bookings")]
    public async Task<IActionResult> Bookings([FromQuery] CustomerPortalBookingQuery query)
    {
        var customerId = await CustomerId();
        var rows = FullOwned(customerId);
        if (!string.IsNullOrWhiteSpace(query.Status)) rows = rows.Where(x => x.Status == query.Status);
        if (!string.IsNullOrWhiteSpace(query.Keyword))
        {
            var keyword = query.Keyword.Trim();
            var isId = int.TryParse(keyword.TrimStart('#'), out var id);
            rows = rows.Where(x => x.Room.RoomNumber.Contains(keyword) || isId && x.Id == id);
        }
        if (query.FromDate.HasValue) { var start = query.FromDate.Value.Date; rows = rows.Where(x => x.CheckOutDate > start); }
        if (query.ToDate.HasValue) { var end = query.ToDate.Value.Date.AddDays(1); rows = rows.Where(x => x.CheckInDate < end); }
        var count = await rows.CountAsync();
        var skip = (long)(query.PageNumber - 1) * query.PageSize;
        var items = skip >= count ? new List<Booking>() : await rows.OrderByDescending(x => x.Id)
            .Skip((int)skip).Take(query.PageSize).ToListAsync();
        var ids = items.Select(x => x.Id).ToList();
        var pending = await db.BookingRequests.Where(x => ids.Contains(x.BookingId) && x.Status == "Pending")
            .Select(x => x.BookingId).ToListAsync();
        return Ok(ApiSupport.Page(items.Select(x => new
        {
            booking = ApiSupport.BookingView(x), roomTypeName = x.Room.RoomType.Name,
            coverUrl = "/api/RoomPresentation/" + x.RoomId + "/cover",
            hasPendingRequest = pending.Contains(x.Id)
        }).ToList(), count, query.PageNumber, query.PageSize));
    }

    [HttpGet("bookings/{id:int}")]
    public async Task<IActionResult> Detail(int id)
    {
        var customerId = await CustomerId();
        var booking = await FullOwned(customerId).FirstOrDefaultAsync(x => x.Id == id);
        if (booking is null) return NotFound();
        var requests = await db.BookingRequests.AsNoTracking().Where(x => x.BookingId == id && x.Booking.CustomerId == customerId)
            .OrderByDescending(x => x.Id).Select(x => new
            { x.Id, x.Type, x.Status, x.Reason, x.StaffNote, x.RoomId, x.CheckInDate, x.CheckOutDate, x.CreatedAt, x.ResolvedAt }).ToListAsync();
        return Ok(new
        {
            booking = ApiSupport.BookingView(booking), roomTypeName = booking.Room.RoomType.Name,
            coverUrl = "/api/RoomPresentation/" + booking.RoomId + "/cover",
            contact = new { booking.Customer.FullName, booking.Customer.Phone, booking.Customer.Email },
            balance = HotelWorkflow.Balance(booking),
            services = booking.ServiceUsages.OrderBy(x => x.Id).Select(x => new
            { x.Id, name = x.ServiceName, x.Quantity, x.UnitPrice, x.Total, x.UsedAt }),
            payments = booking.Payments.OrderByDescending(x => x.Id).Select(x => new
            { x.Id, x.Type, x.Method, x.Amount, x.Reference, x.CreatedAt }),
            requests,
            canRequestChangeOrCancel = booking.Status == BookingStates.Reserved && !requests.Any(x => x.Status == "Pending"),
            canPay = booking.Status != BookingStates.Cancelled && HotelWorkflow.Gross(booking) > HotelWorkflow.Paid(booking),
            canViewInvoice = booking.Status == BookingStates.CheckedOut
        });
    }
}

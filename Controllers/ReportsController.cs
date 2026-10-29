using HotelManagementAPI.Data;
using HotelManagementAPI.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace HotelManagementAPI.Controllers;

[ApiController, Route("api/[controller]"), Authorize(Roles = Roles.Admin)]
public sealed class ReportsController(HotelDbContext db) : ControllerBase
{
    [HttpGet("rooms")]
    public async Task<IActionResult> Rooms()
    {
        var rooms = await db.Rooms.AsNoTracking().ToListAsync();
        var occupied = rooms.Count(x => x.Status == RoomStatus.Occupied);
        return Ok(new
        {
            totalRooms = rooms.Count,
            available = rooms.Count(x => x.Status == RoomStatus.Available),
            occupied,
            maintenance = rooms.Count(x => x.Status == RoomStatus.Maintenance),
            cleaning = rooms.Count(x=>x.Status==RoomStatus.Cleaning),
            occupancyRate = rooms.Count == 0 ? 0 : Math.Round(100.0 * occupied / rooms.Count, 2)
        });
    }

    [HttpGet("revenue")]
    public async Task<IActionResult> Revenue([FromQuery] DateTime? from, [FromQuery] DateTime? to)
    {
        if (!ValidRange(from, to)) return BadRequest(new { message = "Khoảng ngày không hợp lệ." });
        var start = from!.Value.Date;
        var end = to!.Value.Date;
        var bookings = await CheckedOutBookings(start, end.AddDays(1)).Include(x => x.Detail)
            .Include(x => x.ServiceUsages).AsSplitQuery()
            .ToListAsync();
        var daily = bookings.GroupBy(x => x.ActualCheckOutAt!.Value.Date)
            .OrderBy(x => x.Key)
            .Select(group => new
            {
                date = group.Key,
                roomRevenue = group.Sum(x => x.Detail.RoomTotal),
                serviceRevenue = group.Sum(x => x.ServiceUsages.Sum(u => u.Total)),
                total = group.Sum(x => x.Detail.RoomTotal + x.ServiceUsages.Sum(u => u.Total))
            }).ToList();
        var roomRevenue = bookings.Sum(x => x.Detail.RoomTotal);
        var serviceRevenue = bookings.Sum(x => x.ServiceUsages.Sum(u => u.Total));
        return Ok(new
        {
            from = start, to = end, bookings = bookings.Count,
            roomRevenue, serviceRevenue, totalRevenue = roomRevenue + serviceRevenue,
            daily
        });
    }

    [HttpGet("popular-services")]
    public async Task<IActionResult> PopularServices([FromQuery] DateTime? from, [FromQuery] DateTime? to)
    {
        if (!ValidRange(from, to)) return BadRequest(new { message = "Khoảng ngày không hợp lệ." });
        var start = from!.Value.Date;
        var end = to!.Value.Date.AddDays(1);
        var usages = await CheckedOutBookings(start, end)
            .SelectMany(x => x.ServiceUsages).Include(x => x.Service).ToListAsync();
        return Ok(usages.GroupBy(x => new { x.ServiceId, x.Service.Name })
            .Select(group => new
            {
                serviceId = group.Key.ServiceId, name = group.Key.Name,
                quantity = group.Sum(x => x.Quantity), revenue = group.Sum(x => x.Total)
            }).OrderByDescending(x => x.revenue).ToList());
    }

    private IQueryable<Booking> CheckedOutBookings(DateTime start, DateTime exclusiveEnd) =>
        db.Bookings.AsNoTracking().Where(x => x.Status == BookingStates.CheckedOut &&
            x.ActualCheckOutAt >= start && x.ActualCheckOutAt < exclusiveEnd);

    private static bool ValidRange(DateTime? from, DateTime? to) =>
        from.HasValue && to.HasValue && from.Value.Date <= to.Value.Date &&
        to.Value.Date < DateTime.MaxValue.Date && (to.Value.Date - from.Value.Date).TotalDays <= 366;
}

using HotelManagementAPI.Data;
using HotelManagementAPI.Models;
using HotelManagementAPI.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace HotelManagementAPI.Controllers;

[ApiController, Route("api/Notifications"), Authorize(Roles = Roles.Staff)]
public sealed class NotificationsController(HotelDbContext db, TimeProvider clock) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> List(CancellationToken cancellationToken)
    {
        var today = clock.GetLocalNow().Date;
        var bookings = db.Bookings.AsNoTracking();
        var items = new List<NotificationGroup>();
        void Add(string kind, string title, string description, int count)
        {
            if (count > 0) items.Add(new(kind, title, description, count));
        }
        Add("requests", "Yêu cầu hủy / đổi chờ duyệt", "Kiểm tra yêu cầu mới của khách và phản hồi.",
            await db.BookingRequests.CountAsync(x => x.Status == "Pending", cancellationToken));
        Add("overdue", "Khách quá ngày trả phòng", "Khách vẫn đang lưu trú sau ngày trả dự kiến.",
            await BookingAttention.Filter(bookings, "overdue", today).CountAsync(cancellationToken));
        Add("arrivals", "Khách nhận phòng hôm nay", "Các booking hôm nay chưa check-in.",
            await BookingAttention.Filter(bookings, "arrivals", today).CountAsync(cancellationToken));
        Add("departures", "Khách trả phòng hôm nay", "Các booking đang ở có ngày trả dự kiến hôm nay.",
            await BookingAttention.Filter(bookings, "departures", today).CountAsync(cancellationToken));
        Add("housekeeping", "Phòng đang chờ dọn", "Xác nhận dọn xong trước khi đón khách tiếp theo.",
            await db.Rooms.CountAsync(x => x.Status == RoomStatus.Cleaning, cancellationToken));
        Response.Headers.CacheControl = "no-store";
        return Ok(new { totalCount = items.Sum(x => x.Count), generatedAt = clock.GetLocalNow(), items });
    }

    private sealed record NotificationGroup(string Kind, string Title, string Description, int Count);
}

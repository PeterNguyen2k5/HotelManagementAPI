using HotelManagementAPI.Data;
using HotelManagementAPI.Models;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace HotelManagementAPI.Services;

public static class ApiSupport
{
    public static bool Unique(DbUpdateException ex) =>
        ex.InnerException is SqliteException sqlite &&
        sqlite.SqliteErrorCode == 19 && sqlite.SqliteExtendedErrorCode is 1555 or 2067;

    public static bool ForeignKey(DbUpdateException ex) =>
        ex.InnerException is SqliteException sqlite && sqlite.SqliteExtendedErrorCode == 787;

    public static bool Busy(Exception ex)
    {
        var cause = ex is DbUpdateException update ? update.InnerException : ex;
        return cause is SqliteException sqlite && sqlite.SqliteErrorCode is 5 or 6;
    }

    public static object Page<T>(IReadOnlyList<T> items, int total, int page, int size) => new
    {
        totalCount = total, pageNumber = page, pageSize = size,
        totalPages = (int)Math.Ceiling(total / (double)size), items
    };

    public static object UserView(User user) => new
    {
        user.Id, user.Username, user.FullName, user.Email, user.Role, user.IsActive, user.MustChangePassword
    };

    public static object RoomView(Room room) => new
    {
        room.Id, room.RoomNumber, room.RoomTypeId,
        roomTypeName = room.RoomType?.Name ?? "",
        room.Price, room.Capacity, room.Status, room.Description,
        coverUrl = "/api/RoomPresentation/" + room.Id + "/cover"
    };

    public static object TypeView(RoomType type, int count) => new
    {
        type.Id, type.Name, type.Description, roomCount = count
    };

    public static object BookingView(Booking booking)
    {
        var roomTotal = booking.Detail?.RoomTotal ?? 0m;
        var serviceTotal = booking.ServiceUsages.Sum(x => x.Total);
        return new
        {
            booking.Id, booking.CustomerId, customerName = booking.Customer?.FullName,
            booking.RoomId, roomNumber = booking.Room?.RoomNumber,
            booking.GuestCount, booking.CheckInDate, booking.CheckOutDate,
            booking.ActualCheckInAt, booking.ActualCheckOutAt,
            booking.Status, booking.Note,
            paidAmount = booking.Payments.Sum(p=>p.Type=="Refund" ? -p.Amount : p.Amount),
            balance = (booking.Status==BookingStates.Cancelled ? 0 : roomTotal+serviceTotal)-booking.Payments.Sum(p=>p.Type=="Refund" ? -p.Amount : p.Amount),
            roomPricePerNight = booking.Detail?.RoomPricePerNight ?? 0m,
            nights = booking.Detail?.Nights ?? 0,
            roomTotal, serviceTotal, totalAmount = booking.Status==BookingStates.Cancelled ? 0 : roomTotal + serviceTotal
        };
    }

    public static IQueryable<Booking> FullBookings(HotelDbContext db) =>
        db.Bookings.Include(x => x.Customer).Include(x => x.Room)
            .Include(x => x.Detail).Include(x => x.Payments).Include(x=>x.RoomCharges)
            .Include(x => x.ServiceUsages).ThenInclude(x=>x.Service).AsSplitQuery();
}

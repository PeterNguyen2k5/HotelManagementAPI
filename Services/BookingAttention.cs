using HotelManagementAPI.Models;

namespace HotelManagementAPI.Services;

public static class BookingAttention
{
    public static bool Valid(string? attention) => attention is null or "arrivals" or "departures" or "overdue";

    public static IQueryable<Booking> Filter(IQueryable<Booking> bookings, string? attention, DateTime today) => attention switch
    {
        "arrivals" => bookings.Where(x => x.Status == BookingStates.Reserved && x.CheckInDate >= today && x.CheckInDate < today.AddDays(1)),
        "departures" => bookings.Where(x => x.Status == BookingStates.CheckedIn && x.CheckOutDate >= today && x.CheckOutDate < today.AddDays(1)),
        "overdue" => bookings.Where(x => x.Status == BookingStates.CheckedIn && x.CheckOutDate < today),
        _ => bookings
    };
}

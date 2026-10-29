namespace HotelManagementAPI.Models;

public sealed class CustomerNotificationRead
{
    public int CustomerId { get; set; }
    public string EventKey { get; set; } = "";
    public DateTime ReadAtUtc { get; set; }
}

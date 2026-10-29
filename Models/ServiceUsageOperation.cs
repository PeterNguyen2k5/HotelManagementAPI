namespace HotelManagementAPI.Models;

// Keep the request key even after a usage is deleted, so delayed retries cannot recreate it.
public sealed class ServiceUsageOperation
{
    public string RequestId { get; set; } = "";
    public int BookingId { get; set; }
    public int ServiceId { get; set; }
    public int Quantity { get; set; }
    public string ServiceName { get; set; } = "";
    public int? UsageId { get; set; }
    public ServiceUsage? Usage { get; set; }
    public DateTime CreatedAt { get; set; }
}

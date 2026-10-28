namespace HotelManagementAPI.Models;

public sealed class BookingRequest
{
    public int Id { get; set; }
    public int BookingId { get; set; }
    public Booking Booking { get; set; } = null!;
    public string Type { get; set; } = "Cancel";
    public string Status { get; set; } = "Pending";
    public int BookingRevision { get; set; }
    public int? RoomId { get; set; }
    public DateTime? CheckInDate { get; set; }
    public DateTime? CheckOutDate { get; set; }
    public string Reason { get; set; } = "";
    public string? StaffNote { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? ResolvedAt { get; set; }
    public string? ResolvedBy { get; set; }
}
public sealed class BookingPayment
{
    public int Id { get; set; }
    public int BookingId { get; set; }
    public Booking Booking { get; set; } = null!;
    public string RequestId { get; set; } = "";
    public string Type { get; set; } = "Payment";
    public string Method { get; set; } = "Cash";
    public decimal Amount { get; set; }
    public string? Reference { get; set; }
    public string? BankReferenceKey { get; set; }
    public string RecordedBy { get; set; } = "";
    public DateTime CreatedAt { get; set; }
}
public sealed class RoomCharge
{
    public int Id { get; set; }
    public int BookingId { get; set; }
    public Booking Booking { get; set; } = null!;
    public string RoomNumber { get; set; } = "";
    public DateTime StartDate { get; set; }
    public DateTime EndDate { get; set; }
    public int Nights { get; set; }
    public decimal UnitPrice { get; set; }
    public decimal Total { get; set; }
}
public sealed class BookingInvoice
{
    public int Id { get; set; }
    public int BookingId { get; set; }
    public Booking Booking { get; set; } = null!;
    public string Number { get; set; } = "";
    public DateTime IssuedAt { get; set; }
    public string Snapshot { get; set; } = "";
}
public sealed class AuditLog
{
    public int Id { get; set; }
    public DateTime CreatedAt { get; set; }
    public string Actor { get; set; } = "System";
    public string Role { get; set; } = "System";
    public string Action { get; set; } = "";
    public string Entity { get; set; } = "";
    public string EntityId { get; set; } = "";
    public string Summary { get; set; } = "";
}
public sealed class DatabaseBackup
{
    public int Id { get; set; }
    public string FileName { get; set; } = "";
    public long Size { get; set; }
    public DateTime CreatedAt { get; set; }
    public string CreatedBy { get; set; } = "System";
}

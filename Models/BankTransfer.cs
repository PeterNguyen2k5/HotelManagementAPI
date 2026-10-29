namespace HotelManagementAPI.Models;

// Authenticated incoming bank receipts exist independently of a booking/payment.
public sealed class BankTransfer
{
    public int Id { get; set; }
    public long SepayId { get; set; }
    public string Fingerprint { get; set; } = "";
    public string AccountNumber { get; set; } = "";
    public decimal Amount { get; set; }
    public string? Gateway { get; set; }
    public string? TransactionDate { get; set; }
    public string? Content { get; set; }
    public string? Description { get; set; }
    public string? Code { get; set; }
    public string? ReferenceCode { get; set; }
    public string? BankReferenceKey { get; set; }
    public int? SuggestedBookingId { get; set; }
    public string Status { get; set; } = "Pending";
    public string Reason { get; set; } = "MissingBookingCode";
    public int? BookingId { get; set; }
    public int? PaymentId { get; set; }
    public BookingPayment? Payment { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? ResolvedAt { get; set; }
    public string? ResolvedBy { get; set; }
    public string? ResolutionNote { get; set; }
}

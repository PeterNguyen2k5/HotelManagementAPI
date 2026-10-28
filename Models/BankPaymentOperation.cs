namespace HotelManagementAPI.Models;

// A staff retry must stay bound to its original payload even when it reuses a webhook payment.
public sealed class BankPaymentOperation
{
    public string RequestId { get; set; } = "";
    public string Fingerprint { get; set; } = "";
    public int PaymentId { get; set; }
    public BookingPayment Payment { get; set; } = null!;
    public DateTime CreatedAt { get; set; }
}

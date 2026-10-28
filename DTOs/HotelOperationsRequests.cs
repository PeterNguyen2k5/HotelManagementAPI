using System.ComponentModel.DataAnnotations;
namespace HotelManagementAPI.DTOs;
public sealed class AmendBooking : IValidatableObject
{
    [Range(1,int.MaxValue)] public int RoomId { get; set; }
    [Required] public DateTime? CheckInDate { get; set; }
    [Required] public DateTime? CheckOutDate { get; set; }
    public IEnumerable<ValidationResult> Validate(ValidationContext context)
    {
        if(CheckInDate.HasValue && CheckOutDate.HasValue && CheckOutDate.Value.Date<=CheckInDate.Value.Date)
            yield return new ValidationResult("Ngày trả phải sau ngày nhận phòng.");
    }
}
public sealed class GuestBookingRequest
{
    [Required,RegularExpression("^(Cancel|Change)$")] public string Type { get; set; } = "Cancel";
    [Required,StringLength(500)] public string Reason { get; set; } = "";
    [Range(1,int.MaxValue)] public int? RoomId { get; set; }
    public DateTime? CheckInDate { get; set; }
    public DateTime? CheckOutDate { get; set; }
}
public sealed class ResolveBookingRequest
{
    [Required] public bool? Approve { get; set; }
    [StringLength(500)] public string? Note { get; set; }
}
public sealed class PaymentCreate : IValidatableObject
{
    [Required,RegularExpression("^(Deposit|Payment|Refund)$")] public string Type { get; set; } = "Payment";
    [Required,RegularExpression("^(Cash|Transfer)$")] public string Method { get; set; } = "Cash";
    [Range(typeof(decimal),"0.01","1000000000000")] public decimal Amount { get; set; }
    [Required,StringLength(36,MinimumLength=36)] public string RequestId { get; set; } = "";
    [StringLength(200)] public string? Reference { get; set; }
    [StringLength(50)] public string? BankId { get; set; }
    [StringLength(50)] public string? BankAccountNumber { get; set; }
    public IEnumerable<ValidationResult> Validate(ValidationContext context)
    {
        if(!Guid.TryParse(RequestId,out _)) yield return new ValidationResult("Mã yêu cầu thanh toán không hợp lệ.");
        if(decimal.Round(Amount,2)!=Amount) yield return new ValidationResult("Số tiền tối đa 2 chữ số thập phân.");
        if(Method=="Transfer" && string.IsNullOrWhiteSpace(Reference)) yield return new ValidationResult("Hãy nhập mã tham chiếu chuyển khoản.");
    }
}

public sealed class CustomerPaymentRequest : IValidatableObject
{
    [Required, RegularExpression("^(Deposit|Payment|Direct)$")] public string Type { get; set; } = "Payment";
    [Required, RegularExpression("^(Cash|Transfer)$")] public string Method { get; set; } = "Transfer";
    [Range(typeof(decimal), "0", "1000000000000"), MoneyPrecision] public decimal Amount { get; set; }
    [Required, StringLength(36, MinimumLength = 36)] public string RequestId { get; set; } = "";
    [StringLength(200)] public string? Reference { get; set; }
    public IEnumerable<ValidationResult> Validate(ValidationContext context)
    {
        if (!Guid.TryParse(RequestId, out _)) yield return new ValidationResult("Mã yêu cầu không hợp lệ.");
        if (Type != "Direct" && Amount <= 0) yield return new ValidationResult("Số tiền thanh toán phải lớn hơn 0.");
        if (Method == "Transfer" && Type != "Direct" && string.IsNullOrWhiteSpace(Reference))
            yield return new ValidationResult("Hãy nhập mã tham chiếu hoặc nội dung chuyển khoản.");
    }
}

public sealed class BankConfigSave
{
    [Required, StringLength(50)] public string BankId { get; set; } = "";
    [Required, StringLength(100)] public string BankName { get; set; } = "";
    [Required, StringLength(50)] public string AccountNumber { get; set; } = "";
    [Required, StringLength(100)] public string AccountName { get; set; } = "";
    [StringLength(500)] public string? QrImageUrl { get; set; }
    [StringLength(100)] public string? SepayApiKey { get; set; }

    [System.Text.Json.Serialization.JsonIgnore]
    public bool IsConfigured => !string.IsNullOrWhiteSpace(BankId) &&
        !string.IsNullOrWhiteSpace(BankName) && !string.IsNullOrWhiteSpace(AccountNumber) &&
        !string.IsNullOrWhiteSpace(AccountName) &&
        // Older versions could save the prefilled demo account. Require real details again.
        !(BankId.Trim().Equals("MB", StringComparison.OrdinalIgnoreCase) &&
          AccountNumber.Trim() == "090123456789" &&
          AccountName.Trim().Equals("AN NHIEN HOTEL AND RESORT", StringComparison.OrdinalIgnoreCase));
}

public sealed class SepayWebhookRequest
{
    [Range(1, long.MaxValue)] public long Id { get; set; }
    [StringLength(100)] public string? Gateway { get; set; }
    [StringLength(100)] public string? TransactionDate { get; set; }
    [StringLength(50)] public string? AccountNumber { get; set; }
    [StringLength(200)] public string? Code { get; set; }
    [StringLength(4000)] public string? Content { get; set; }
    public string? TransferType { get; set; }
    [Range(typeof(decimal), "0.01", "1000000000000"), MoneyPrecision] public decimal TransferAmount { get; set; }
    public decimal? Accumulated { get; set; }
    public string? SubAccount { get; set; }
    [StringLength(200)] public string? ReferenceCode { get; set; }
    [StringLength(4000)] public string? Description { get; set; }
}

public sealed class PaymentSimulationRequest
{
    [Range(typeof(decimal), "0.01", "1000000000000"), MoneyPrecision] public decimal? Amount { get; set; }
}

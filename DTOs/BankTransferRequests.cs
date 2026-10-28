using System.ComponentModel.DataAnnotations;

namespace HotelManagementAPI.DTOs;

public sealed class BankTransferQuery : PageQuery
{
    [RegularExpression("^(Pending|Matched|Closed)$")] public string? Status { get; set; }
    [StringLength(200)] public string? Keyword { get; set; }
}

public sealed class BankTransferMatch : IValidatableObject
{
    [Range(1, int.MaxValue)] public int BookingId { get; set; }
    [Required, StringLength(500)] public string Note { get; set; } = "";
    [Range(1, int.MaxValue)] public int? ExistingPaymentId { get; set; }
    public bool RecordAsNew { get; set; }
    public IEnumerable<ValidationResult> Validate(ValidationContext context)
    {
        if (ExistingPaymentId.HasValue && RecordAsNew)
            yield return new ValidationResult("Chọn liên kết khoản đã thu hoặc ghi khoản mới, không chọn cả hai.");
    }
}

public sealed class BankTransferClose
{
    [Required, StringLength(500)] public string Note { get; set; } = "";
}

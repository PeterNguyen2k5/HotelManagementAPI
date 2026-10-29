using System.ComponentModel.DataAnnotations;
namespace HotelManagementAPI.DTOs;

public sealed class CustomerPortalBookingQuery : PageQuery, IValidatableObject
{
    [StringLength(100)] public string? Keyword { get; set; }
    [RegularExpression("^(Reserved|CheckedIn|CheckedOut|Cancelled)$")] public string? Status { get; set; }
    public DateTime? FromDate { get; set; }
    public DateTime? ToDate { get; set; }
    public IEnumerable<ValidationResult> Validate(ValidationContext context)
    {
        if (FromDate.HasValue && ToDate.HasValue && ToDate.Value.Date < FromDate.Value.Date)
            yield return new ValidationResult("Ngày kết thúc phải từ ngày bắt đầu trở đi.", [nameof(ToDate)]);
        if (ToDate.HasValue && ToDate.Value.Date == DateTime.MaxValue.Date)
            yield return new ValidationResult("Ngày kết thúc vượt giới hạn.", [nameof(ToDate)]);
    }
}

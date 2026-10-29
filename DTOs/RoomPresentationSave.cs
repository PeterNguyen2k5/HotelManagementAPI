using System.ComponentModel.DataAnnotations;

namespace HotelManagementAPI.DTOs;

public sealed class RoomPresentationSave : IValidatableObject
{
    [StringLength(4000)] public string? Description { get; set; }
    [StringLength(100)] public string? Beds { get; set; }
    [Range(1, 1000)] public double? Area { get; set; }
    [Required, MaxLength(30)] public List<string> Amenities { get; set; } = [];
    [Required, MaxLength(10)] public List<string> Images { get; set; } = [];

    public IEnumerable<ValidationResult> Validate(ValidationContext context)
    {
        if (Amenities?.Any(x => string.IsNullOrWhiteSpace(x) || x.Length > 80) == true)
            yield return new ValidationResult("Mỗi tiện nghi cần có nội dung và tối đa 80 ký tự.", [nameof(Amenities)]);
        if (Images?.Any(x => string.IsNullOrWhiteSpace(x) || x.Length > 200) == true)
            yield return new ValidationResult("Đường dẫn ảnh không hợp lệ.", [nameof(Images)]);
    }
}

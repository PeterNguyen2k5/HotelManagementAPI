using System.ComponentModel.DataAnnotations;
using HotelManagementAPI.Models;

namespace HotelManagementAPI.DTOs;

public class PageQuery
{
    [Range(1, int.MaxValue)] public int PageNumber { get; set; } = 1;
    [Range(1, 100)] public int PageSize { get; set; } = 20;
}

public sealed class RoomQuery : PageQuery
{
    public string? Keyword { get; set; }
    public RoomStatus? Status { get; set; }
    public int? RoomTypeId { get; set; }
    public string? SortBy { get; set; }
}

public sealed class RoomTypeQuery : PageQuery
{
    public string? Keyword { get; set; }
    public string? SortBy { get; set; }
}

public sealed class BookingQuery : PageQuery, IValidatableObject
{
    [StringLength(200)] public string? CustomerKeyword { get; set; }
    [StringLength(10)] public string? RoomNumber { get; set; }
    public DateTime? FromDate { get; set; }
    public DateTime? ToDate { get; set; }
    [RegularExpression("^(arrivals|departures|overdue)$")] public string? Attention { get; set; }
    public int? CustomerId { get; set; }
    public int? RoomId { get; set; }
    public string? Status { get; set; }
    public IEnumerable<ValidationResult> Validate(ValidationContext context)
    {
        if (FromDate.HasValue && ToDate.HasValue && FromDate.Value.Date > ToDate.Value.Date)
            yield return new ValidationResult("Ngày kết thúc phải từ ngày bắt đầu trở đi.", [nameof(ToDate)]);
        if (ToDate.HasValue && ToDate.Value.Date == DateTime.MaxValue.Date)
            yield return new ValidationResult("Ngày kết thúc vượt giới hạn cho phép.", [nameof(ToDate)]);
    }
}

public sealed class RoomTypeSave
{
    [Required, StringLength(100)] public string Name { get; set; } = "";
    [StringLength(500)] public string? Description { get; set; }
}

public class RoomSave
{
    [Range(1, 100)] public int Capacity { get; set; } = 2;
    [Required, StringLength(10)] public string RoomNumber { get; set; } = "";
    [Range(1, int.MaxValue)] public int RoomTypeId { get; set; }
    [Required, MoneyPrecision, Range(typeof(decimal), "0", "9999999999999999.99")]
    public decimal? Price { get; set; }
    [StringLength(500)] public string? Description { get; set; }
}

public sealed class RoomUpdate : RoomSave
{
    [Required, EnumDataType(typeof(RoomStatus))] public RoomStatus? Status { get; set; }
}

public sealed class CustomerSave
{
    private string? email;
    [Required, StringLength(100)] public string FullName { get; set; } = "";
    [StringLength(20)] public string? IdentityCard { get; set; }
    [Phone, StringLength(30)] public string? Phone { get; set; }
    [EmailAddress, StringLength(200)]
    public string? Email
    {
        get => email;
        set => email = string.IsNullOrWhiteSpace(value) ? null : value.Trim().ToLowerInvariant();
    }
    [StringLength(200)] public string? Address { get; set; }
}

public sealed class BookingCreate : IValidatableObject
{
    [Range(1, 100)] public int GuestCount { get; set; } = 1;
    [Range(1, int.MaxValue)] public int CustomerId { get; set; }
    [Range(1, int.MaxValue)] public int RoomId { get; set; }
    [Required] public DateTime? CheckInDate { get; set; }
    [Required] public DateTime? CheckOutDate { get; set; }
    [StringLength(500)] public string? Note { get; set; }
    public IEnumerable<ValidationResult> Validate(ValidationContext context)
    {
        if (CheckInDate.HasValue && CheckOutDate.HasValue &&
            CheckOutDate.Value.Date <= CheckInDate.Value.Date)
            yield return new ValidationResult("Ngày trả phòng phải sau ngày nhận phòng.", [nameof(CheckOutDate)]);
    }
}

public sealed class PublicBookingCreate : IValidatableObject
{
    [Range(1, 100)] public int GuestCount { get; set; } = 1;
    [Required, StringLength(100)] public string FullName { get; set; } = "";
    [Required, Phone, StringLength(30)] public string Phone { get; set; } = "";
    [EmailAddress, StringLength(200)] public string? Email { get; set; }
    [Range(1, int.MaxValue)] public int RoomId { get; set; }
    [Required] public DateTime? CheckInDate { get; set; }
    [Required] public DateTime? CheckOutDate { get; set; }
    [StringLength(500)] public string? Note { get; set; }

    public IEnumerable<ValidationResult> Validate(ValidationContext context)
    {
        if (CheckInDate.HasValue && CheckOutDate.HasValue &&
            CheckOutDate.Value.Date <= CheckInDate.Value.Date)
            yield return new ValidationResult("Ngày trả phòng phải sau ngày nhận phòng.",
                [nameof(CheckOutDate)]);
    }
}

public sealed class AvailableRoomsQuery : IValidatableObject
{
    [Range(1, 100)] public int GuestCount { get; set; } = 1;
    [Required] public DateTime? CheckInDate { get; set; }
    [Required] public DateTime? CheckOutDate { get; set; }
    public IEnumerable<ValidationResult> Validate(ValidationContext context)
    {
        if (CheckInDate.HasValue && CheckOutDate.HasValue &&
            CheckOutDate.Value.Date <= CheckInDate.Value.Date)
            yield return new ValidationResult("Ngày trả phòng phải sau ngày nhận phòng.", [nameof(CheckOutDate)]);
    }
}

public sealed class LoginRequest
{
    [Required] public string Username { get; set; } = "";
    [Required, StaffPasswordLength] public string Password { get; set; } = "";
}

public sealed class UserCreate
{
    [Required, StringLength(50)] public string Username { get; set; } = "";
    [Required, MinLength(6), StaffPasswordLength] public string Password { get; set; } = "";
    [Required, StringLength(100)] public string FullName { get; set; } = "";
    [EmailAddress, StringLength(100)] public string? Email { get; set; }
    [Required, RegularExpression("^(Admin|Receptionist)$")]
    public string Role { get; set; } = Roles.Receptionist;
}

public sealed class UserUpdate
{
    [Required, StringLength(100)] public string FullName { get; set; } = "";
    [EmailAddress, StringLength(100)] public string? Email { get; set; }
    [Required, RegularExpression("^(Admin|Receptionist)$")]
    public string Role { get; set; } = Roles.Receptionist;
    public bool IsActive { get; set; } = true;
}

public sealed class ChangePassword
{
    [Required, StaffPasswordLength] public string OldPassword { get; set; } = "";
    [Required, MinLength(6), StaffPasswordLength] public string NewPassword { get; set; } = "";
}

public sealed class ServiceSave
{
    [Required, StringLength(100)] public string Name { get; set; } = "";
    [StringLength(500)] public string? Description { get; set; }
    [Required, StringLength(50)] public string Unit { get; set; } = "";
    [Required, MoneyPrecision, Range(typeof(decimal), "0", "9999999999999999.99")]
    public decimal? Price { get; set; }
}

public sealed class UsageCreate : IValidatableObject
{
    [Required, StringLength(36, MinimumLength = 36)] public string RequestId { get; set; } = "";
    [Range(1, int.MaxValue)] public int BookingId { get; set; }
    [Range(1, int.MaxValue)] public int ServiceId { get; set; }
    [Range(1, int.MaxValue)] public int Quantity { get; set; }
    public IEnumerable<ValidationResult> Validate(ValidationContext context)
    {
        if (!Guid.TryParseExact(RequestId, "D", out var id) || id == Guid.Empty)
            yield return new ValidationResult("Mã thao tác dịch vụ phải là UUID hợp lệ.", [nameof(RequestId)]);
    }
}

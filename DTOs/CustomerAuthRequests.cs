using System.ComponentModel.DataAnnotations;

namespace HotelManagementAPI.DTOs;

public sealed class CustomerRegister
{
    [Required, StringLength(50, MinimumLength = 3), RegularExpression("^[a-zA-Z0-9_.-]+$")]
    public string Username { get; set; } = "";
    [Required, StringLength(72, MinimumLength = 8)] public string Password { get; set; } = "";
    [Required, StringLength(100)] public string FullName { get; set; } = "";
    [Required, EmailAddress, StringLength(200)] public string Email { get; set; } = "";
    [Required, Phone, StringLength(30)] public string Phone { get; set; } = "";
}

public sealed class CustomerLogin
{
    [Required, StringLength(50)] public string Username { get; set; } = "";
    [Required, StringLength(72)] public string Password { get; set; } = "";
}

public sealed class CustomerProfileUpdate
{
    [Required, StringLength(100)] public string FullName { get; set; } = "";
    [Required, Phone, StringLength(30)] public string Phone { get; set; } = "";
    [Required, EmailAddress, StringLength(200)] public string Email { get; set; } = "";
    [StringLength(20)] public string? IdentityCard { get; set; }
    [StringLength(200)] public string? Address { get; set; }
    [StringLength(72)] public string? CurrentPassword { get; set; }
}

public sealed class CustomerPasswordChange
{
    [Required, StringLength(72)] public string OldPassword { get; set; } = "";
    [Required, StringLength(72, MinimumLength = 8)] public string NewPassword { get; set; } = "";
}

public sealed class CustomerForgotPassword
{
    [Required, EmailAddress, StringLength(200)] public string Email { get; set; } = "";
}

public sealed class CustomerResetPassword
{
    [Required, StringLength(4096)] public string Token { get; set; } = "";
    [Required, StringLength(72, MinimumLength = 8)] public string NewPassword { get; set; } = "";
}

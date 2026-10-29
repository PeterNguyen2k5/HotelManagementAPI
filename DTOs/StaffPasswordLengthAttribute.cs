using System.ComponentModel.DataAnnotations;
using HotelManagementAPI.Services;

namespace HotelManagementAPI.DTOs;

// Validate before any BCrypt operation, including verification of the old password.
[AttributeUsage(AttributeTargets.Property)]
public sealed class StaffPasswordLengthAttribute : ValidationAttribute
{
    public StaffPasswordLengthAttribute() : base(StaffPasswordPolicy.LengthError) { }

    public override bool IsValid(object? value) =>
        value is null || value is string password && StaffPasswordPolicy.WithinByteLimit(password);
}

using System.ComponentModel.DataAnnotations;

namespace HotelManagementAPI.DTOs;

[AttributeUsage(AttributeTargets.Property)]
public sealed class MoneyPrecisionAttribute : ValidationAttribute
{
    public MoneyPrecisionAttribute() : base("Giá chỉ được có tối đa 2 chữ số thập phân.") { }

    public override bool IsValid(object? value) =>
        value is null || value is decimal amount && decimal.Round(amount, 2) == amount;
}

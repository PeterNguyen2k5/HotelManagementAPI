using System.ComponentModel.DataAnnotations;

namespace HotelManagementAPI.Models;

public sealed class CustomerAccount
{
    public int Id { get; set; }
    [MaxLength(50)] public string Username { get; set; } = "";
    [MaxLength(200)] public string Email { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public int CustomerId { get; set; }
    public Customer Customer { get; set; } = null!;
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; }
}

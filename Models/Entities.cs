using System.ComponentModel.DataAnnotations;

namespace HotelManagementAPI.Models;

public static class Roles
{
    public const string Admin = "Admin";
    public const string Customer = "Customer";
    public const string Staff = "Admin,Receptionist";
    public const string Receptionist = "Receptionist";
}

public static class BookingStates
{
    public const string Reserved = "Reserved";
    public const string CheckedIn = "CheckedIn";
    public const string CheckedOut = "CheckedOut";
    public const string Cancelled = "Cancelled";
}

public enum RoomStatus { Available = 0, Occupied = 1, Maintenance = 2, Cleaning = 3 }

public sealed class User
{
    public int Id { get; set; }
    [MaxLength(50)] public string Username { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    [MaxLength(100)] public string FullName { get; set; } = "";
    [MaxLength(100)] public string? Email { get; set; }
    public string Role { get; set; } = Roles.Receptionist;
    public bool IsActive { get; set; } = true;
    public bool MustChangePassword { get; set; }
    public long SessionVersion { get; set; }
    public DateTime CreatedAt { get; set; }
}

public sealed class RoomType
{
    public int Id { get; set; }
    [MaxLength(100)] public string Name { get; set; } = "";
    [MaxLength(500)] public string? Description { get; set; }
    public ICollection<Room> Rooms { get; set; } = new List<Room>();
}

public sealed class Room
{
    public int Id { get; set; }
    [MaxLength(10)] public string RoomNumber { get; set; } = "";
    public int RoomTypeId { get; set; }
    public RoomType RoomType { get; set; } = null!;
    [Range(1, 100)] public int Capacity { get; set; } = 2;
    public decimal Price { get; set; }
    public RoomStatus Status { get; set; } = RoomStatus.Available;
    [MaxLength(500)] public string? Description { get; set; }
    public ICollection<Booking> Bookings { get; set; } = new List<Booking>();
}

public sealed class Customer
{
    public int Id { get; set; }
    [MaxLength(100)] public string FullName { get; set; } = "";
    [MaxLength(20)] public string? IdentityCard { get; set; }
    [MaxLength(30)] public string? Phone { get; set; }
    [MaxLength(200)] public string? Email { get; set; }
    [MaxLength(200)] public string? Address { get; set; }
    public DateTime CreatedAt { get; set; }
    public ICollection<Booking> Bookings { get; set; } = new List<Booking>();
}

public sealed class Booking
{
    public int Id { get; set; }
    public int CustomerId { get; set; }
    public Customer Customer { get; set; } = null!;
    public int RoomId { get; set; }
    public Room Room { get; set; } = null!;
    public int Revision { get; set; }
    public DateTime? CurrentRoomSince { get; set; }
    public ICollection<RoomCharge> RoomCharges { get; set; } = new List<RoomCharge>();
    public ICollection<BookingPayment> Payments { get; set; } = new List<BookingPayment>();
    public int? GuestCount { get; set; }
    public DateTime CheckInDate { get; set; }
    public DateTime CheckOutDate { get; set; }
    public DateTime? ActualCheckInAt { get; set; }
    public DateTime? ActualCheckOutAt { get; set; }
    [MaxLength(20)] public string Status { get; set; } = BookingStates.Reserved;
    [MaxLength(500)] public string? Note { get; set; }
    public DateTime CreatedAt { get; set; }
    public BookingDetail Detail { get; set; } = null!;
    public ICollection<ServiceUsage> ServiceUsages { get; set; } = new List<ServiceUsage>();
}

public sealed class BookingDetail
{
    public int Id { get; set; }
    public int BookingId { get; set; }
    public Booking Booking { get; set; } = null!;
    public decimal RoomPricePerNight { get; set; }
    public int Nights { get; set; }
    public decimal RoomTotal { get; set; }
}

public sealed class HotelService
{
    public int Id { get; set; }
    [MaxLength(100)] public string Name { get; set; } = "";
    [MaxLength(500)] public string? Description { get; set; }
    [MaxLength(50)] public string Unit { get; set; } = "";
    public decimal Price { get; set; }
    public bool IsActive { get; set; } = true;
    public ICollection<ServiceUsage> Usages { get; set; } = new List<ServiceUsage>();
}

public sealed class ServiceUsage
{
    public int Id { get; set; }
    public int BookingId { get; set; }
    public Booking Booking { get; set; } = null!;
    public int ServiceId { get; set; }
    public HotelService Service { get; set; } = null!;
    public int Quantity { get; set; }
    public decimal UnitPrice { get; set; }
    public decimal Total { get; set; }
    public DateTime UsedAt { get; set; }
}

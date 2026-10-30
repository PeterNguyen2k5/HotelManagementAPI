using System.Globalization;
using System.Text.Json;
namespace HotelManagement.Client;

public sealed record Credentials(string Username,string Password);
public sealed record Session(string Token,DateTimeOffset Expires,StaffProfile? User,CustomerProfile? Account);
public sealed record StaffProfile(int Id,string Username,string FullName,string Role,bool MustChangePassword);
public sealed record CustomerProfile(int Id,string Username,string Email,int CustomerId,string FullName,string Phone,string? Address,string? IdentityCard);
public sealed record Page<T>(int TotalCount,int PageNumber,int PageSize,int TotalPages,List<T> Items);
public sealed record HotelConfiguration(string TimeZone,DateOnly Today);
public sealed record GuestOptions(int MaxGuests);
public sealed record Room(int Id,string RoomNumber,int RoomTypeId,string RoomTypeName,decimal Price,int Capacity,JsonElement Status,string? Description,string CoverUrl);
public sealed record Customer(int Id,string FullName,string? Phone,string? Email,string? Address);
public sealed record CustomerSave(string FullName,string? Phone,string? Email,string? Address);
public sealed record StaffBookingCreate(int CustomerId,int RoomId,int GuestCount,DateOnly CheckInDate,DateOnly CheckOutDate,string? Note);
public sealed record GuestBookingCreate(int RoomId,int GuestCount,DateOnly CheckInDate,DateOnly CheckOutDate,string FullName,string Phone,string? Email,string? Note);
public sealed record Booking(int Id,int CustomerId,string? CustomerName,int RoomId,string? RoomNumber,int? GuestCount,DateTime CheckInDate,DateTime CheckOutDate,string Status,string? Note,decimal TotalAmount,decimal PaidAmount,decimal Balance,DateTimeOffset? PaymentDueAtUtc,bool AwaitingPayment,DateTimeOffset ServerTimeUtc);
public sealed record CreatedBooking(int Id,string Status,string RoomNumber,DateTime CheckInDate,DateTime CheckOutDate,decimal TotalAmount,DateTimeOffset? PaymentDueAtUtc,DateTimeOffset ServerTimeUtc);
public sealed record PortalItem(Booking Booking,string RoomTypeName,string CoverUrl,bool HasPendingRequest);
public sealed record Balance(decimal Total,decimal Paid,decimal Due,decimal RefundDue);
public sealed record Payment(int Id,int BookingId,string Type,string Method,decimal Amount,string? Reference,DateTime CreatedAt,string? RecordedBy);
public sealed record PaymentHistory(Balance Balance,List<Payment> Items);
public sealed record PaymentCreate(string RequestId,string Type,string Method,decimal Amount,string? Reference,string? BankId=null,string? BankAccountNumber=null);
public sealed record BankConfiguration(bool BankConfigured,string BankId,string BankName,string AccountNumber,string AccountName,string? QrImageUrl,bool SepayConfigured,string? WebhookAccountNumber);
public sealed record PublicBooking(int Id,int RoomId,string CustomerName,string RoomNumber,string RoomTypeName,int? GuestCount,DateTime CheckInDate,DateTime CheckOutDate,string Status,decimal TotalAmount,Balance Balance,DateTimeOffset? PaymentDueAtUtc,bool AwaitingPayment,DateTimeOffset ServerTimeUtc,bool CanCancelHold,bool CanRequestCancellation,bool HasPendingRequest,List<Payment> Payments);
public sealed record PaymentStatus(int BookingId,decimal Gross,decimal Paid,decimal Remaining,bool HasPaid,bool PayAtHotel,string Status,DateTimeOffset? PaymentDueAtUtc,bool AwaitingPayment,DateTimeOffset ServerTimeUtc,bool CanCancelHold,bool CanRequestCancellation,bool HasPendingRequest,Payment? LatestPayment);
public sealed record BookingRequest(int Id,int BookingId,string? CustomerName,string Type,string Status,string Reason,string? StaffNote);
public sealed record GuestRequest(string Type,string Reason,int? RoomId=null,DateOnly? CheckInDate=null,DateOnly? CheckOutDate=null);
public sealed record Notification(string Id,int BookingId,string Kind,string Title,string Message,DateTimeOffset CreatedAtUtc,bool IsRead);
public sealed record NotificationFeed(List<Notification> Items,int UnreadCount,DateTimeOffset ServerTimeUtc);
public sealed record Contact(string Phone,string? PhoneUrl,string Email,string? EmailUrl,string? FacebookUrl);
public sealed record MessageResult(string Message);

public static class Presentation
{
    public static string Money(decimal amount)=>amount.ToString(amount==decimal.Truncate(amount)?"N0":"N2",CultureInfo.GetCultureInfo("vi-VN"))+" đ";
    public static string BookingStatus(string status)=>status switch{"Reserved"=>"Chờ nhận phòng","CheckedIn"=>"Đang lưu trú","CheckedOut"=>"Đã trả phòng","Cancelled"=>"Đã hủy",_=>status};
    public static string RoomStatus(JsonElement status)=>status.ValueKind==JsonValueKind.Number?status.GetInt32() switch{0=>"Sẵn sàng",1=>"Có khách",2=>"Bảo trì",3=>"Đang dọn",_=>"Chưa rõ"}:status.ToString();
    public static string Date(DateTime date)=>date.ToString("dd/MM/yyyy",CultureInfo.InvariantCulture);
}

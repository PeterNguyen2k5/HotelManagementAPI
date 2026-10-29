using System.Text;

namespace HotelManagementAPI.Services;

public static class StaffPasswordPolicy
{
    public const int MaximumUtf8Bytes = 72;
    public const string LengthError = "Mật khẩu tối đa 72 byte UTF-8. Ký tự có dấu hoặc emoji có thể chiếm nhiều byte.";

    public static bool WithinByteLimit(string password) =>
        Encoding.UTF8.GetByteCount(password) <= MaximumUtf8Bytes;

    public static bool ValidInitialPassword(string? password) =>
        !string.IsNullOrWhiteSpace(password) && password.Length >= 12 &&
        WithinByteLimit(password) && password != "admin123";
}

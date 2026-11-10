using System.Net.Mail;
using System.Text.RegularExpressions;

namespace HotelManagementAPI.Services;

public sealed record HotelContactInfo(string Phone, string? PhoneUrl, string Email, string? EmailUrl,
    string? FacebookUrl, string? Address, string? MapUrl)
{
    public static HotelContactInfo Read(IConfiguration configuration)
    {
        var phone = configuration["HotelContact:Phone"]?.Trim() ?? "";
        var number = Regex.Replace(phone, @"[ ()-]", "");
        if (!Regex.IsMatch(number, @"\A\+?[0-9]{7,15}\z") || !Regex.IsMatch(phone, @"\A[+0-9 ()-]+\z")) phone = number = "";
        var email = configuration["HotelContact:Email"]?.Trim() ?? "";
        if (!MailAddress.TryCreate(email, out var mailbox) || !mailbox.Address.Equals(email, StringComparison.OrdinalIgnoreCase)) email = "";
        var facebook = configuration["HotelContact:FacebookUrl"]?.Trim();
        if (!Uri.TryCreate(facebook, UriKind.Absolute, out var uri) || uri.Scheme != "https" || !uri.IsDefaultPort ||
            !string.IsNullOrEmpty(uri.UserInfo) || uri.Host.ToLowerInvariant() is not ("facebook.com" or "www.facebook.com" or "m.facebook.com")) facebook = null;
        else facebook = uri.AbsoluteUri;
        var address = configuration["HotelContact:Address"]?.Trim();
        if (string.IsNullOrWhiteSpace(address)) address = null;
        var mapUrl = address is null ? null : "https://www.google.com/maps/search/?api=1&query=" + Uri.EscapeDataString(address);
        return new(phone, number.Length > 0 ? "tel:" + number : null,
            email, email.Length > 0 ? "mailto:" + Uri.EscapeDataString(email).Replace("%40", "@") : null,
            facebook, address, mapUrl);
    }
}

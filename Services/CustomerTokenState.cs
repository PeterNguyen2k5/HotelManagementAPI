using System.Globalization;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using HotelManagementAPI.Models;
using Microsoft.IdentityModel.Tokens;

namespace HotelManagementAPI.Services;

public static class CustomerTokenState
{
    public const string ClaimType = "customer_credential_stamp";

    public static string Create(CustomerAccount account, SymmetricSecurityKey key)
    {
        var state = Encoding.UTF8.GetBytes("HotelManagementAPI:customer-session:v1:" +
            account.Id.ToString(CultureInfo.InvariantCulture) + ":" + account.PasswordHash);
        return Convert.ToHexString(HMACSHA256.HashData(key.Key, state));
    }

    public static bool Matches(ClaimsPrincipal? principal, CustomerAccount account, SymmetricSecurityKey key) =>
        MatchesStamp(principal?.FindFirstValue(ClaimType), account, key);

    public static bool MatchesStamp(string? stamp, CustomerAccount account, SymmetricSecurityKey key) =>
        stamp is not null && CryptographicOperations.FixedTimeEquals(
            Encoding.UTF8.GetBytes(stamp), Encoding.ASCII.GetBytes(Create(account, key)));
}

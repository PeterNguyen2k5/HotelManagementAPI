using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using HotelManagementAPI.Models;
using Microsoft.IdentityModel.Tokens;

namespace HotelManagementAPI.Services;

public static class StaffTokenState
{
    public const string ClaimType = "staff_credential_stamp";

    public static string Create(User user, SymmetricSecurityKey key)
    {
        // Revocation survives restoring the old role/active flag, independently of the password.
        var state = Encoding.UTF8.GetBytes($"HotelManagementAPI:staff-session:v2:{user.Id}:{user.SessionVersion}:{user.PasswordHash}");
        return Convert.ToHexString(HMACSHA256.HashData(key.Key, state));
    }

    public static bool Matches(ClaimsPrincipal? principal, User user, SymmetricSecurityKey key)
    {
        var stamp = principal?.FindFirstValue(ClaimType);
        return stamp is not null && CryptographicOperations.FixedTimeEquals(
            Encoding.UTF8.GetBytes(stamp), Encoding.ASCII.GetBytes(Create(user, key)));
    }
}

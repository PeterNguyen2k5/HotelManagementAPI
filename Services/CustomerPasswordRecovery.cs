using System.Security.Cryptography;
using System.Text.Json;
using HotelManagementAPI.Models;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.IdentityModel.Tokens;

namespace HotelManagementAPI.Services;

public sealed class CustomerPasswordRecovery(IDataProtectionProvider protection, SymmetricSecurityKey key, TimeProvider clock)
{
    private readonly ITimeLimitedDataProtector protector = protection
        .CreateProtector("HotelManagementAPI.CustomerPasswordRecovery.v1").ToTimeLimitedDataProtector();

    public sealed record Ticket(int AccountId, string Email, string CredentialStamp);

    public string Create(CustomerAccount account) => protector.Protect(
        JsonSerializer.Serialize(new Ticket(account.Id, account.Email, CustomerTokenState.Create(account, key))),
        clock.GetUtcNow().AddMinutes(30));

    public Ticket? Read(string token)
    {
        try
        {
            var ticket = JsonSerializer.Deserialize<Ticket>(protector.Unprotect(token, out _));
            return ticket is { AccountId: > 0 } && !string.IsNullOrEmpty(ticket.Email) &&
                !string.IsNullOrEmpty(ticket.CredentialStamp) ? ticket : null;
        }
        catch (Exception ex) when (ex is CryptographicException or JsonException or FormatException or ArgumentException)
        { return null; }
    }

    public bool Matches(Ticket ticket, CustomerAccount account) =>
        ticket.AccountId == account.Id && string.Equals(ticket.Email, account.Email, StringComparison.Ordinal) &&
        CustomerTokenState.MatchesStamp(ticket.CredentialStamp, account, key);
}

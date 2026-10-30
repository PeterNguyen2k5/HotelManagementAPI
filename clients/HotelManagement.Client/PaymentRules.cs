using System.Diagnostics;
using System.Globalization;
namespace HotelManagement.Client;

public static class PaymentRules
{
    public static decimal Deposit(decimal remaining,int percent)
    {
        if(percent is not (30 or 50 or 100))throw new ArgumentOutOfRangeException(nameof(percent));
        return Math.Min(Math.Max(0,remaining),percent==100?Math.Max(0,remaining):Math.Max(50000,decimal.Round(Math.Max(0,remaining)*percent/100,0,MidpointRounding.AwayFromZero)));
    }
    public static Uri Qr(BankConfiguration bank,int bookingId,decimal amount)
    {
        if(!bank.BankConfigured||string.IsNullOrWhiteSpace(bank.AccountNumber)||string.IsNullOrWhiteSpace(bank.BankId)||amount<=0||bookingId<=0)throw new InvalidOperationException("Chuyển khoản chưa sẵn sàng.");
        if(!string.IsNullOrWhiteSpace(bank.QrImageUrl))
        {
            if(!Uri.TryCreate(bank.QrImageUrl,UriKind.Absolute,out var custom)||custom.Scheme!="https"||!string.IsNullOrEmpty(custom.UserInfo))throw new InvalidOperationException("URL QR tùy chỉnh không hợp lệ.");
            return custom;
        }
        return new Uri($"https://img.vietqr.io/image/{Uri.EscapeDataString(bank.BankId)}-{Uri.EscapeDataString(bank.AccountNumber)}-compact2.png?amount={amount.ToString(CultureInfo.InvariantCulture)}&addInfo={Uri.EscapeDataString("ANNHIEN "+bookingId)}&accountName={Uri.EscapeDataString(bank.AccountName)}");
    }
}

// Time remaining uses server UTC + a monotonic clock; changing the phone's clock cannot extend a hold.
public sealed class HoldClock
{
    private DateTimeOffset? due;
    private TimeSpan initial;
    private long started;
    public void Synchronize(DateTimeOffset? paymentDueAtUtc,DateTimeOffset serverTimeUtc)
    {due=paymentDueAtUtc;initial=due.HasValue?due.Value-serverTimeUtc:TimeSpan.Zero;started=Stopwatch.GetTimestamp();}
    public TimeSpan Remaining=>due.HasValue?TimeSpan.FromMilliseconds(Math.Max(0,(initial-Stopwatch.GetElapsedTime(started)).TotalMilliseconds)):TimeSpan.Zero;
    public string Text=>due.HasValue?Remaining.ToString(@"mm\:ss"):"Không áp dụng hạn giữ chỗ";
}

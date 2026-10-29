using System.Net;
using System.Net.Mail;
using System.Text;

namespace HotelManagementAPI.Services;

public sealed class CustomerEmailSender(IWebHostEnvironment environment, IConfiguration configuration,
    HotelStorage storage,OperationalMetrics metrics,ILogger<CustomerEmailSender> logger)
{
    private string Mode => configuration["CustomerEmail:Mode"] ?? (environment.IsDevelopment() ? "Pickup" : "Smtp");
    private string From => configuration["CustomerEmail:From"] ?? "no-reply@hotel.local";
    private Uri? PublicRoot
    {
        get
        {
            var configured = configuration["CustomerEmail:PublicBaseUrl"] ??
                (environment.IsDevelopment() ? "https://localhost:7203/" : null);
            if (!Uri.TryCreate(configured, UriKind.Absolute, out var root) ||
                (root.Scheme != "https" && !(environment.IsDevelopment() && root.Scheme == "http")) ||
                !string.IsNullOrEmpty(root.UserInfo) || !string.IsNullOrEmpty(root.Query) || !string.IsNullOrEmpty(root.Fragment))
                return null;
            return new UriBuilder(root) { Path = root.AbsolutePath.TrimEnd('/') + "/" }.Uri;
        }
    }

    public bool IsConfigured => PublicRoot is not null && MailAddress.TryCreate(From, out _) &&
        (Mode.Equals("Pickup", StringComparison.OrdinalIgnoreCase) && environment.IsDevelopment() ||
         Mode.Equals("Smtp", StringComparison.OrdinalIgnoreCase) &&
         !string.IsNullOrWhiteSpace(configuration["CustomerEmail:Smtp:Host"]) &&
         int.TryParse(configuration["CustomerEmail:Smtp:Port"] ?? "587", out var port) && port is > 0 and <= 65535);

    public async Task SendReset(string recipient, string token, CancellationToken cancellationToken)
    {
        try
        {
            var link = new UriBuilder(new Uri(PublicRoot!, "hotel.html"))
            { Fragment = "resetToken=" + Uri.EscapeDataString(token) }.Uri.AbsoluteUri;
            using var message = new MailMessage(From, recipient)
            {
                Subject = "An Nhiên – Đặt lại mật khẩu khách hàng",
                SubjectEncoding = Encoding.UTF8, BodyEncoding = Encoding.UTF8,
                Body = "Bạn đã yêu cầu đặt lại mật khẩu tài khoản khách hàng An Nhiên.\r\n\r\n" +
                    "Mở liên kết sau trong vòng 30 phút:\r\n" + link + "\r\n\r\n" +
                    "Liên kết chỉ dùng một lần. Nếu bạn không yêu cầu, hãy bỏ qua email này."
            };
            using var smtp = new SmtpClient { UseDefaultCredentials = false };
            if (Mode.Equals("Pickup", StringComparison.OrdinalIgnoreCase))
            {
                if (!environment.IsDevelopment()) throw new InvalidOperationException("Pickup email is development-only.");
                var folder = Path.Combine(storage.Root, "App_Data", "mail");
                Directory.CreateDirectory(folder);
                smtp.DeliveryMethod = SmtpDeliveryMethod.SpecifiedPickupDirectory;
                smtp.PickupDirectoryLocation = folder;
            }
            else
            {
                smtp.Host = configuration["CustomerEmail:Smtp:Host"]!;
                smtp.Port = int.Parse(configuration["CustomerEmail:Smtp:Port"] ?? "587");
                smtp.EnableSsl = true;
                var username = configuration["CustomerEmail:Smtp:Username"];
                if (!string.IsNullOrWhiteSpace(username))
                    smtp.Credentials = new NetworkCredential(username, configuration["CustomerEmail:Smtp:Password"]);
            }
            await smtp.SendMailAsync(message, cancellationToken);
        }
        catch (Exception ex) when (ex is SmtpException or IOException or UnauthorizedAccessException or InvalidOperationException)
        {
            metrics.BackgroundFailure("email");
            // Do not log the recipient, reset link, SMTP credentials or exception message.
            logger.LogWarning("Không gửi được email khôi phục mật khẩu. Kiểm tra cấu hình CustomerEmail.");
        }
    }
}

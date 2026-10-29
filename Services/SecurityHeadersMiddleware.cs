using System.Net;

namespace HotelManagementAPI.Services;

public sealed class SecurityHeadersMiddleware(RequestDelegate next, IWebHostEnvironment environment)
{
    public const string Hsts = "max-age=15552000"; // 180 days, scoped to this host (no preload/subdomains).
    // Pin Swashbuckle 6.6.2's favicon helper and the two existing local/cloud initializers.
    // Re-run the Swagger CSP checks when changing that package or its UI configuration.
    private const string SwaggerScripts = " 'sha256-Tui7QoFlnLXkJCSl1/JvEZdIXTmBttnWNxzJpXomQjg='" +
        " 'sha256-vrXa3ddSanCCwCGztpNtMgpzojRnEPR8JgMU9YVvCJw='" +
        " 'sha256-necGxbqs0Tz0JUbBNZluzo2yw7KCd/OUUBVWRIvGg34='";

    private static bool LocalHost(string host) => host.Equals("localhost", StringComparison.OrdinalIgnoreCase) ||
        host.EndsWith(".localhost", StringComparison.OrdinalIgnoreCase) ||
        IPAddress.TryParse(host.Trim('[', ']'), out var ip) && IPAddress.IsLoopback(ip);

    public Task InvokeAsync(HttpContext context)
    {
        var swagger = context.Request.Path.StartsWithSegments("/swagger", StringComparison.OrdinalIgnoreCase);
        var scripts = "'self'" + (swagger ? SwaggerScripts : "");
        var connections = environment.IsDevelopment() ? "'self' ws: wss:" : "'self'";
        var policy = "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; " +
            "frame-src 'none'; form-action 'self'; script-src " + scripts + "; script-src-attr 'none'; " +
            // Existing templates use style attributes; scripts still require self or a pinned hash.
            "style-src 'self' 'unsafe-inline'; img-src 'self' https: data: blob:; font-src 'self' data:; " +
            "connect-src " + connections + "; worker-src 'self' blob:; media-src 'self'";
        context.Response.OnStarting(() =>
        {
            var headers = context.Response.Headers;
            headers["Content-Security-Policy"] = policy;
            headers["X-Frame-Options"] = "DENY";
            headers["X-Content-Type-Options"] = "nosniff";
            headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
            // Use the scheme after ForwardedHeaders; never trust a raw client-supplied header here.
            if (!environment.IsDevelopment() && context.Request.IsHttps && !LocalHost(context.Request.Host.Host))
                headers["Strict-Transport-Security"] = Hsts;
            return Task.CompletedTask;
        });
        return next(context);
    }
}

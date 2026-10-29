using System.Security.Cryptography;
using System.Text;
using HotelManagementAPI.Data;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace HotelManagementAPI.Services;

public sealed class HotelReadinessCheck(IServiceScopeFactory scopes, HotelStorage storage) : IHealthCheck
{
    public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken cancellationToken = default)
    {
        try
        {
            using var scope = scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<HotelDbContext>();
            // Query an application table: opening an empty replacement SQLite file is not readiness.
            await db.Users.AsNoTracking().Select(x => x.Id).Take(1).ToArrayAsync(cancellationToken);
            var probe = Path.Combine(storage.Root, ".health-" + Guid.NewGuid().ToString("N"));
            await using var file = new FileStream(probe, FileMode.CreateNew, FileAccess.Write, FileShare.None,
                1, FileOptions.DeleteOnClose | FileOptions.Asynchronous);
            await file.WriteAsync(new byte[] { 0 }, cancellationToken);
            return HealthCheckResult.Healthy();
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch { return HealthCheckResult.Unhealthy("Required storage is unavailable."); }
    }
}

public static class DeploymentHealth
{
    public static bool IsProbe(HttpContext context) => (HttpMethods.IsGet(context.Request.Method) || HttpMethods.IsHead(context.Request.Method)) &&
        (context.Request.Path.Equals("/health/live", StringComparison.OrdinalIgnoreCase) ||
         context.Request.Path.Equals("/health/ready", StringComparison.OrdinalIgnoreCase) ||
         context.Request.Path.Equals("/metrics", StringComparison.OrdinalIgnoreCase));

    public static void MapDeploymentEndpoints(this WebApplication app, string? scrapeKey)
    {
        static Task Write(HttpContext context, HealthReport report)
        {
            context.Response.Headers.CacheControl = "no-store";
            return context.Response.WriteAsJsonAsync(new { status = report.Status.ToString() }, context.RequestAborted);
        }
        // Bypass authentication too: liveness must not depend on a JWT database lookup.
        app.MapHealthChecks("/health/live", new HealthCheckOptions { Predicate = _ => false, ResponseWriter = Write }).AllowAnonymous().ShortCircuit();
        app.MapHealthChecks("/health/ready", new HealthCheckOptions { Predicate = check => check.Tags.Contains("ready"), ResponseWriter = Write }).AllowAnonymous().ShortCircuit();
        app.MapGet("/metrics", async (HttpContext context, OperationalMetrics metrics, HealthCheckService health) =>
        {
            context.Response.Headers.CacheControl = "no-store";
            if (string.IsNullOrWhiteSpace(scrapeKey)) return Results.NotFound();
            var authorization = context.Request.Headers.Authorization.ToString();
            if (!authorization.StartsWith("Bearer ", StringComparison.Ordinal) ||
                !CryptographicOperations.FixedTimeEquals(SHA256.HashData(Encoding.UTF8.GetBytes(scrapeKey)),
                    SHA256.HashData(Encoding.UTF8.GetBytes(authorization[7..])))) return Results.Unauthorized();
            var report = await health.CheckHealthAsync(check => check.Tags.Contains("ready"), context.RequestAborted);
            return Results.Text(metrics.Export(report.Status == HealthStatus.Healthy), "text/plain; version=0.0.4; charset=utf-8");
        }).AllowAnonymous();
    }
}

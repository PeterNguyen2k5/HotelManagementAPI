using System.Globalization;
using System.Text;

namespace HotelManagementAPI.Services;

public sealed class OperationalMetrics
{
    private readonly long[] requests = new long[6];
    private long durationTicks, requestCount, backupFailures, emailFailures, backupTimestamp;

    public void Request(int status, TimeSpan elapsed)
    {
        Interlocked.Increment(ref requests[Math.Clamp(status / 100, 0, 5)]);
        Interlocked.Increment(ref requestCount);
        Interlocked.Add(ref durationTicks, elapsed.Ticks);
    }
    public void BackgroundFailure(string operation)
    {
        if (operation == "backup") Interlocked.Increment(ref backupFailures);
        if (operation == "email") Interlocked.Increment(ref emailFailures);
    }
    public void BackupSucceeded(DateTimeOffset at) => Interlocked.Exchange(ref backupTimestamp, at.ToUnixTimeSeconds());

    public string Export(bool ready)
    {
        var result = new StringBuilder("# TYPE hotel_api_requests_total counter\n");
        for (var i = 1; i <= 5; i++)
            result.AppendLine($"hotel_api_requests_total{{status_class=\"{i}xx\"}} {Interlocked.Read(ref requests[i])}");
        result.AppendLine("# TYPE hotel_api_request_duration_seconds summary");
        result.AppendLine("hotel_api_request_duration_seconds_sum " + (Interlocked.Read(ref durationTicks) / (double)TimeSpan.TicksPerSecond).ToString("R", CultureInfo.InvariantCulture));
        result.AppendLine($"hotel_api_request_duration_seconds_count {Interlocked.Read(ref requestCount)}");
        result.AppendLine("# TYPE hotel_background_failures_total counter");
        result.AppendLine($"hotel_background_failures_total{{operation=\"backup\"}} {Interlocked.Read(ref backupFailures)}");
        result.AppendLine($"hotel_background_failures_total{{operation=\"email\"}} {Interlocked.Read(ref emailFailures)}");
        result.AppendLine("# TYPE hotel_last_backup_success_timestamp_seconds gauge");
        result.AppendLine($"hotel_last_backup_success_timestamp_seconds {Interlocked.Read(ref backupTimestamp)}");
        result.AppendLine("# TYPE hotel_ready gauge");
        result.AppendLine("hotel_ready " + (ready ? "1" : "0"));
        return result.ToString().Replace("\r\n", "\n");
    }
}

public sealed class RequestMonitoringMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext context, OperationalMetrics metrics)
    {
        if (!context.Request.Path.StartsWithSegments("/api", StringComparison.OrdinalIgnoreCase))
        { await next(context); return; }
        var started = System.Diagnostics.Stopwatch.GetTimestamp();
        try { await next(context); }
        finally { metrics.Request(context.Response.StatusCode, System.Diagnostics.Stopwatch.GetElapsedTime(started)); }
    }
}

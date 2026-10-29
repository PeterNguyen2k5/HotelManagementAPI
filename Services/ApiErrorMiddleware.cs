namespace HotelManagementAPI.Services;

public sealed class ApiErrorMiddleware(RequestDelegate next, ILogger<ApiErrorMiddleware> logger)
{
    public async Task InvokeAsync(HttpContext context)
    {
        var isApi = context.Request.Path.StartsWithSegments("/api", StringComparison.OrdinalIgnoreCase);
        if (isApi)
        {
            context.Response.OnStarting(() =>
            {
                context.Response.Headers["X-Trace-Id"] = context.TraceIdentifier;
                if (context.Response.StatusCode >= 400) context.Response.Headers.CacheControl = "no-store";
                return Task.CompletedTask;
            });
        }
        try
        {
            await next(context);
            // Preserve existing business/validation JSON, and fill responses with no error body.
            if (isApi && context.Response.StatusCode >= 400 && !context.Response.HasStarted &&
                context.Response.ContentLength is null or 0 && string.IsNullOrEmpty(context.Response.ContentType))
                await ApiErrors.Write(context, context.Response.StatusCode);
        }
        catch (Exception ex) when (context.RequestAborted.IsCancellationRequested &&
                                   ex is OperationCanceledException or IOException)
        {
            if (!context.Response.HasStarted) context.Response.StatusCode = 499;
        }
        catch (Exception ex) when (!context.Response.HasStarted)
        {
            var status = ex is BadHttpRequestException badRequest ? badRequest.StatusCode :
                ApiSupport.Busy(ex) ? StatusCodes.Status409Conflict : StatusCodes.Status500InternalServerError;
            if (status >= 500)
            {
                // Log location/type for support, without exception messages, request bodies or credentials.
                logger.LogError("API failure {ExceptionType}. TraceId: {TraceId}. Stack: {StackTrace}",
                    ex.GetType().FullName, context.TraceIdentifier, ex.StackTrace);
            }
            else logger.LogWarning("API request failed with status {StatusCode}. TraceId: {TraceId}", status, context.TraceIdentifier);
            context.Response.Clear();
            await ApiErrors.Write(context, status);
        }
    }
}

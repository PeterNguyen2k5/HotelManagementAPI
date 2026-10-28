namespace HotelManagementAPI.Services;

public sealed record ApiErrorResponse(string Message, int StatusCode, string TraceId);

public static class ApiErrors
{
    public static string Message(int statusCode) => statusCode switch
    {
        400 => "Dữ liệu không hợp lệ. Vui lòng kiểm tra lại.",
        401 => "Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.",
        403 => "Bạn không có quyền thực hiện thao tác này.",
        404 => "Không tìm thấy dữ liệu được yêu cầu.",
        405 => "Phương thức yêu cầu không được hỗ trợ.",
        408 => "Yêu cầu đã hết thời gian chờ. Vui lòng thử lại.",
        409 => "Dữ liệu đang được cập nhật hoặc đã thay đổi. Vui lòng tải lại trước khi thử lại.",
        413 => "Dữ liệu gửi lên quá lớn.",
        415 => "Định dạng dữ liệu gửi lên không được hỗ trợ.",
        429 => "Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau ít phút.",
        503 => "Hệ thống tạm thời chưa sẵn sàng. Vui lòng thử lại sau.",
        >= 500 => "Máy chủ gặp lỗi. Vui lòng thử lại sau.",
        _ => "Không thực hiện được yêu cầu. Vui lòng kiểm tra và thử lại."
    };

    public static ApiErrorResponse Create(HttpContext context, int statusCode, string? message = null) =>
        new(message ?? Message(statusCode), statusCode, context.TraceIdentifier);

    public static Task Write(HttpContext context, int statusCode, string? message = null)
    {
        context.Response.StatusCode = statusCode;
        context.Response.ContentLength = null;
        context.Response.Headers.CacheControl = "no-store";
        context.Response.Headers["X-Trace-Id"] = context.TraceIdentifier;
        return context.Response.WriteAsJsonAsync(Create(context, statusCode, message), context.RequestAborted);
    }
}

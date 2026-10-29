using HotelManagementAPI.Controllers;
using Microsoft.AspNetCore.Mvc.Controllers;

namespace HotelManagementAPI.Services;

public sealed class StaffPasswordChangeMiddleware(RequestDelegate next)
{
    public const string RequiredKey = "StaffPasswordChangeRequired";

    public async Task Invoke(HttpContext context)
    {
        var endpoint = context.GetEndpoint();
        var action = endpoint?.Metadata.GetMetadata<ControllerActionDescriptor>();
        var allowed = action?.ControllerTypeInfo.AsType() == typeof(AuthController) &&
            action.ActionName is nameof(AuthController.Me) or nameof(AuthController.ChangePassword) or nameof(AuthController.Login);
        if (context.User.Identity?.IsAuthenticated == true && context.Items[RequiredKey] is true &&
            !allowed)
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            context.Response.Headers.CacheControl = "no-store";
            await context.Response.WriteAsJsonAsync(new
            {
                message = "Bạn cần đổi mật khẩu khởi tạo trước khi sử dụng chức năng quản trị.",
                code = "PASSWORD_CHANGE_REQUIRED", mustChangePassword = true,
                statusCode = StatusCodes.Status403Forbidden, traceId = context.TraceIdentifier
            }, context.RequestAborted);
            return;
        }
        await next(context);
    }
}

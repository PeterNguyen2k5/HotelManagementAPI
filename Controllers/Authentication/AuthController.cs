using System.Data;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using HotelManagementAPI.Data;
using HotelManagementAPI.DTOs;
using HotelManagementAPI.Models;
using HotelManagementAPI.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

namespace HotelManagementAPI.Controllers;

[ApiController, Route("api/[controller]")]
public sealed class AuthController(HotelDbContext db, SymmetricSecurityKey key) : ControllerBase
{
    [HttpPost("login"), AllowAnonymous, EnableRateLimiting("login")]
    public async Task<IActionResult> Login(LoginRequest request)
    {
        var user = await db.Users.FirstOrDefaultAsync(x => x.Username == request.Username.Trim());
        if (user is null || !user.IsActive || !BCrypt.Net.BCrypt.Verify(request.Password, user.PasswordHash))
            return Unauthorized(new { message = "Tên đăng nhập hoặc mật khẩu không đúng." });
        var expires = DateTime.UtcNow.AddHours(12);
        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new Claim(ClaimTypes.Name, user.Username),
            new Claim(ClaimTypes.Role, user.Role),
            new Claim(StaffTokenState.ClaimType, StaffTokenState.Create(user, key))
        };
        var token = new JwtSecurityToken(
            issuer: "HotelManagementAPI", audience: "HotelManagementFrontend",
            claims: claims, expires: expires,
            signingCredentials: new SigningCredentials(key, SecurityAlgorithms.HmacSha256));
        return Ok(new { token = new JwtSecurityTokenHandler().WriteToken(token),
            expires, user = ApiSupport.UserView(user) });
    }

    [HttpPost("register"), Authorize(Roles = Roles.Admin)]
    public async Task<IActionResult> Register(UserCreate request)
    {
        // Registration creates staff accounts. Only an admin can assign Admin through Users API.
        var user = new User
        {
            Username = request.Username.Trim(), FullName = request.FullName.Trim(),
            Email = request.Email?.Trim(), Role = Roles.Receptionist,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.Password)
        };
        db.Users.Add(user);
        try { await db.SaveChangesAsync(); }
        catch (DbUpdateException ex) when (ApiSupport.Unique(ex))
        { return Conflict(new { message = "Tên đăng nhập hoặc email đã tồn tại." }); }
        return CreatedAtAction(nameof(UsersController.Get), "Users",
            new { id = user.Id }, ApiSupport.UserView(user));
    }

    [HttpGet("me"), Authorize(Roles = Roles.Staff)]
    public async Task<IActionResult> Me()
    {
        var id = int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
        var user = await db.Users.FindAsync(id);
        return user is null ? Unauthorized() : Ok(ApiSupport.UserView(user));
    }

    [HttpPost("change-password"), Authorize(Roles = Roles.Staff)]
    public async Task<IActionResult> ChangePassword(ChangePassword request)
    {
        try
        {
            await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            var id = int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
            var user = await db.Users.FindAsync(id);
            // Recheck after taking the transaction: another request may have changed the password.
            if (user is null || !user.IsActive || user.Role != User.FindFirstValue(ClaimTypes.Role) ||
                !StaffTokenState.Matches(User, user, key))
                return Unauthorized();
            if (!BCrypt.Net.BCrypt.Verify(request.OldPassword, user.PasswordHash))
                return BadRequest(new { message = "Mật khẩu hiện tại không đúng." });
            if (request.NewPassword == "admin123")
                return BadRequest(new { message = "Không được dùng mật khẩu mặc định admin123." });
            if (user.MustChangePassword && (!StaffPasswordPolicy.ValidInitialPassword(request.NewPassword) ||
                request.NewPassword == request.OldPassword))
                return BadRequest(new { message = "Hãy chọn mật khẩu mới khác mật khẩu khởi tạo, tối thiểu 12 ký tự và tối đa 72 byte UTF-8." });
            user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.NewPassword);
            user.MustChangePassword = false;
            await db.SaveChangesAsync();
            await tx.CommitAsync();
            return Ok(new { message = "Đã đổi mật khẩu. Vui lòng đăng nhập lại." });
        }
        catch (Exception ex) when (ApiSupport.Busy(ex))
        { return Conflict(new { message = "Tài khoản đang được cập nhật. Hãy thử lại." }); }
    }
}

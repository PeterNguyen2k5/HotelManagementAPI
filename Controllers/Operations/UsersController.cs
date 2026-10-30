using System.Security.Claims;
using System.Data;
using HotelManagementAPI.Data;
using HotelManagementAPI.DTOs;
using HotelManagementAPI.Models;
using HotelManagementAPI.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

namespace HotelManagementAPI.Controllers;

[ApiController, Route("api/[controller]"), Authorize(Roles = Roles.Admin)]
public sealed class UsersController(HotelDbContext db, SymmetricSecurityKey key) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> List() =>
        Ok((await db.Users.AsNoTracking().OrderBy(x => x.Id).ToListAsync()).Select(ApiSupport.UserView));

    [HttpGet("{id:int}")]
    public async Task<IActionResult> Get(int id)
    {
        var user = await db.Users.FindAsync(id);
        return user is null ? NotFound() : Ok(ApiSupport.UserView(user));
    }

    [HttpPost]
    public async Task<IActionResult> Create(UserCreate request)
    {
        var user = new User
        {
            Username = request.Username.Trim(), PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.Password),
            FullName = request.FullName.Trim(), Email = request.Email?.Trim(), Role = request.Role,
            MustChangePassword = request.Role == Roles.Admin
        };
        db.Users.Add(user);
        try { await db.SaveChangesAsync(); }
        catch (DbUpdateException ex) when (ApiSupport.Unique(ex))
        { return Conflict(new { message = "Tên đăng nhập hoặc email đã tồn tại." }); }
        return CreatedAtAction(nameof(Get), new { id = user.Id }, ApiSupport.UserView(user));
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, UserUpdate request)
    {
        try
        {
            await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            if (!await ActorStillAuthorized()) return Unauthorized();
            var user = await db.Users.FindAsync(id);
            if (user is null) return NotFound();
            var self = User.FindFirstValue(ClaimTypes.NameIdentifier) == id.ToString();
            if (self && (!request.IsActive || request.Role != Roles.Admin))
                return Conflict(new { message = "Không thể tự vô hiệu hóa hoặc bỏ quyền Admin." });
            if (user.Role == Roles.Admin && (request.Role != Roles.Admin || !request.IsActive) &&
                await db.Users.CountAsync(x => x.Role == Roles.Admin && x.IsActive) <= 1)
                return Conflict(new { message = "Cần giữ ít nhất một Admin đang hoạt động." });
            user.FullName = request.FullName.Trim();
            user.Email = request.Email?.Trim();
            if (user.Role != request.Role || user.IsActive != request.IsActive)
                user.SessionVersion = checked(user.SessionVersion + 1);
            user.Role = request.Role;
            user.IsActive = request.IsActive;
            try { await db.SaveChangesAsync(); }
            catch (DbUpdateException ex) when (ApiSupport.Unique(ex))
            { return Conflict(new { message = "Email đã tồn tại." }); }
            await tx.CommitAsync();
            return Ok(ApiSupport.UserView(user));
        }
        catch (Exception ex) when (ApiSupport.Busy(ex))
        { return Conflict(new { message = "Tài khoản đang được cập nhật. Hãy tải lại trước khi thử tiếp." }); }
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Disable(int id)
    {
        try
        {
            await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            if (!await ActorStillAuthorized()) return Unauthorized();
            var user = await db.Users.FindAsync(id);
            if (user is null) return NotFound();
            if (User.FindFirstValue(ClaimTypes.NameIdentifier) == id.ToString())
                return Conflict(new { message = "Không thể tự vô hiệu hóa." });
            if (user.Role == Roles.Admin &&
                await db.Users.CountAsync(x => x.Role == Roles.Admin && x.IsActive) <= 1)
                return Conflict(new { message = "Cần giữ ít nhất một Admin đang hoạt động." });
            if (user.IsActive)
            {
                user.IsActive = false;
                user.SessionVersion = checked(user.SessionVersion + 1);
            }
            await db.SaveChangesAsync();
            await tx.CommitAsync();
            return NoContent();
        }
        catch (Exception ex) when (ApiSupport.Busy(ex))
        { return Conflict(new { message = "Tài khoản đang được cập nhật. Hãy tải lại trước khi thử tiếp." }); }
    }

    private async Task<bool> ActorStillAuthorized()
    {
        if (!int.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var actorId)) return false;
        var actor = await db.Users.AsNoTracking().FirstOrDefaultAsync(x => x.Id == actorId);
        return actor is { IsActive: true, Role: Roles.Admin } && StaffTokenState.Matches(User, actor, key);
    }
}

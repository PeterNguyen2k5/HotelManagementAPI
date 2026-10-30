using System.Data;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using HotelManagementAPI.Data;
using HotelManagementAPI.DTOs;
using HotelManagementAPI.Models;
using HotelManagementAPI.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

namespace HotelManagementAPI.Controllers;

[ApiController, Route("api/CustomerAuth")]
public sealed class CustomerAuthController(HotelDbContext db, SymmetricSecurityKey key,
    CustomerPasswordRecovery recovery, CustomerEmailSender emailSender) : ControllerBase
{
    [HttpPost("register"), AllowAnonymous, EnableRateLimiting("customer-register")]
    public async Task<IActionResult> Register(CustomerRegister request)
    {
        if (Encoding.UTF8.GetByteCount(request.Password) > 72)
            return BadRequest(new { message = "Mật khẩu quá dài. Vui lòng dùng mật khẩu ngắn hơn." });
        var account = new CustomerAccount
        {
            Username = request.Username.Trim().ToLowerInvariant(),
            Email = request.Email.Trim().ToLowerInvariant(),
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.Password),
            Customer = new Customer
            {
                FullName = request.FullName.Trim(), Phone = request.Phone.Trim(),
                Email = request.Email.Trim().ToLowerInvariant()
            }
        };
        db.CustomerAccounts.Add(account);
        try { await db.SaveChangesAsync(); }
        catch (DbUpdateException ex) when (ApiSupport.Unique(ex))
        { return Conflict(new { message = "Tên đăng nhập hoặc email đã được đăng ký." }); }
        return StatusCode(StatusCodes.Status201Created, Session(account));
    }

    [HttpPost("login"), AllowAnonymous, EnableRateLimiting("customer-login")]
    public async Task<IActionResult> Login(CustomerLogin request)
    {
        var username = request.Username.Trim().ToLowerInvariant();
        var account = await db.CustomerAccounts.Include(x => x.Customer)
            .FirstOrDefaultAsync(x => x.Username == username);
        if (account is null || !account.IsActive || Encoding.UTF8.GetByteCount(request.Password) > 72 ||
            !BCrypt.Net.BCrypt.Verify(request.Password, account.PasswordHash))
            return Unauthorized(new { message = "Tên đăng nhập hoặc mật khẩu không đúng." });
        return Ok(Session(account));
    }

    [HttpGet("me"), Authorize(Roles = Roles.Customer)]
    public async Task<IActionResult> Me()
    {
        var id = int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
        var account = await db.CustomerAccounts.AsNoTracking().Include(x => x.Customer)
            .FirstAsync(x => x.Id == id);
        return Ok(Profile(account));
    }

    [HttpPut("me"), Authorize(Roles = Roles.Customer)]
    public async Task<IActionResult> UpdateProfile(CustomerProfileUpdate request)
    {
        try
        {
            await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            var id = int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
            var account = await db.CustomerAccounts.Include(x => x.Customer).FirstOrDefaultAsync(x => x.Id == id);
            if (account is null || !account.IsActive || !CustomerTokenState.Matches(User, account, key))
                return Unauthorized();
            var email = request.Email.Trim().ToLowerInvariant();
            if (email != account.Email && (string.IsNullOrEmpty(request.CurrentPassword) ||
                Encoding.UTF8.GetByteCount(request.CurrentPassword) > 72 ||
                !BCrypt.Net.BCrypt.Verify(request.CurrentPassword, account.PasswordHash)))
                return BadRequest(new { message = "Để đổi email, hãy nhập đúng mật khẩu hiện tại." });
            account.Email = email;
            account.Customer.Email = email;
            account.Customer.FullName = request.FullName.Trim();
            account.Customer.Phone = request.Phone.Trim();
            account.Customer.Address = request.Address?.Trim();
            account.Customer.IdentityCard = request.IdentityCard?.Trim();
            await db.SaveChangesAsync();
            await tx.CommitAsync();
            return Ok(Profile(account));
        }
        catch (DbUpdateException ex) when (ApiSupport.Unique(ex))
        { return Conflict(new { message = "Email đã được đăng ký cho tài khoản khác." }); }
        catch (Exception ex) when (ApiSupport.Busy(ex))
        { return Conflict(new { message = "Hồ sơ đang được cập nhật. Hãy thử lại." }); }
    }

    [HttpPost("change-password"), Authorize(Roles = Roles.Customer), EnableRateLimiting("customer-password")]
    public async Task<IActionResult> ChangePassword(CustomerPasswordChange request)
    {
        if (Encoding.UTF8.GetByteCount(request.OldPassword) > 72 || Encoding.UTF8.GetByteCount(request.NewPassword) > 72)
            return BadRequest(new { message = "Mật khẩu quá dài. Vui lòng dùng tối đa 72 byte UTF-8." });
        try
        {
            await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            var id = int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
            var account = await db.CustomerAccounts.FirstOrDefaultAsync(x => x.Id == id);
            if (account is null || !account.IsActive || !CustomerTokenState.Matches(User, account, key))
                return Unauthorized();
            if (!BCrypt.Net.BCrypt.Verify(request.OldPassword, account.PasswordHash))
                return BadRequest(new { message = "Mật khẩu hiện tại không đúng." });
            account.PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.NewPassword);
            await db.SaveChangesAsync();
            await tx.CommitAsync();
            return Ok(new { message = "Đã đổi mật khẩu. Vui lòng đăng nhập lại." });
        }
        catch (Exception ex) when (ApiSupport.Busy(ex))
        { return Conflict(new { message = "Tài khoản đang được cập nhật. Hãy thử lại." }); }
    }

    [HttpPost("forgot-password"), AllowAnonymous, EnableRateLimiting("customer-forgot")]
    public async Task<IActionResult> ForgotPassword(CustomerForgotPassword request)
    {
        if (!emailSender.IsConfigured)
            return StatusCode(StatusCodes.Status503ServiceUnavailable,
                new { message = "Chức năng khôi phục mật khẩu chưa sẵn sàng. Vui lòng liên hệ khách sạn." });
        var email = request.Email.Trim().ToLowerInvariant();
        var account = await db.CustomerAccounts.AsNoTracking().FirstOrDefaultAsync(x => x.Email == email && x.IsActive);
        if (account is not null)
            await emailSender.SendReset(account.Email, recovery.Create(account), HttpContext.RequestAborted);
        // Keep the response identical for registered, unknown and inactive email addresses.
        return Ok(new { message = "Nếu email có tài khoản đang hoạt động, bạn sẽ nhận được liên kết đặt lại mật khẩu có hiệu lực trong 30 phút." });
    }

    [HttpPost("reset-password"), AllowAnonymous, EnableRateLimiting("customer-reset")]
    public async Task<IActionResult> ResetPassword(CustomerResetPassword request)
    {
        if (Encoding.UTF8.GetByteCount(request.NewPassword) > 72)
            return BadRequest(new { message = "Mật khẩu quá dài. Vui lòng dùng tối đa 72 byte UTF-8." });
        var ticket = recovery.Read(request.Token);
        if (ticket is null) return InvalidReset();
        try
        {
            await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            var account = await db.CustomerAccounts.FirstOrDefaultAsync(x => x.Id == ticket.AccountId);
            if (account is null || !account.IsActive || !recovery.Matches(ticket, account)) return InvalidReset();
            account.PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.NewPassword);
            await db.SaveChangesAsync();
            await tx.CommitAsync();
            return Ok(new { message = "Đã đặt lại mật khẩu. Vui lòng đăng nhập lại." });
        }
        catch (Exception ex) when (ApiSupport.Busy(ex))
        { return Conflict(new { message = "Tài khoản đang được cập nhật. Hãy thử lại." }); }
    }

    private BadRequestObjectResult InvalidReset() =>
        BadRequest(new { message = "Liên kết không hợp lệ, đã hết hạn hoặc đã được sử dụng. Hãy yêu cầu liên kết mới." });

    [HttpGet("bookings"), Authorize(Roles = Roles.Customer)]
    public async Task<IActionResult> Bookings([FromQuery] PageQuery query)
    {
        var id = int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
        var customerId = await db.CustomerAccounts.Where(x => x.Id == id).Select(x => x.CustomerId).FirstAsync();
        var rows = ApiSupport.FullBookings(db).AsNoTracking().Where(x => x.CustomerId == customerId);
        var count = await rows.CountAsync();
        var skip = (long)(query.PageNumber - 1) * query.PageSize;
        var bookings = skip >= count ? new List<Booking>() :
            await rows.OrderByDescending(x => x.Id).Skip((int)skip).Take(query.PageSize).ToListAsync();
        return Ok(ApiSupport.Page(bookings.Select(ApiSupport.BookingView).ToList(), count, query.PageNumber, query.PageSize));
    }

    private object Session(CustomerAccount account)
    {
        var expires = DateTime.UtcNow.AddHours(12);
        var token = new JwtSecurityToken("HotelManagementAPI", "HotelManagementFrontend",
            [new Claim(ClaimTypes.NameIdentifier, account.Id.ToString()),
             new Claim(ClaimTypes.Name, account.Username), new Claim(ClaimTypes.Role, Roles.Customer),
             new Claim(CustomerTokenState.ClaimType, CustomerTokenState.Create(account, key))],
            expires: expires, signingCredentials: new SigningCredentials(key, SecurityAlgorithms.HmacSha256));
        return new { token = new JwtSecurityTokenHandler().WriteToken(token), expires, account = Profile(account) };
    }

    private static object Profile(CustomerAccount account) => new
    {
        account.Id, account.Username, account.Email, account.CustomerId,
        account.Customer.FullName, account.Customer.Phone, account.Customer.Address, account.Customer.IdentityCard
    };
}

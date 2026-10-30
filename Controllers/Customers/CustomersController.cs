using System.Data;
using HotelManagementAPI.Data;
using HotelManagementAPI.DTOs;
using HotelManagementAPI.Models;
using HotelManagementAPI.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace HotelManagementAPI.Controllers;

[ApiController, Route("api/[controller]"), Authorize(Roles = Roles.Staff)]
public sealed class CustomersController(HotelDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> List([FromQuery] string? keyword)
    {
        var rows = db.Customers.AsNoTracking().AsQueryable();
        if (!string.IsNullOrWhiteSpace(keyword))
        {
            var term = keyword.Trim();
            rows = rows.Where(x => x.FullName.Contains(term) ||
                (x.Phone != null && x.Phone.Contains(term)) ||
                (x.IdentityCard != null && x.IdentityCard.Contains(term)));
        }
        return Ok(await rows.OrderBy(x => x.Id).ToListAsync());
    }

    [HttpGet("{id:int}")]
    public async Task<IActionResult> Get(int id)
    {
        var customer = await db.Customers.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id);
        return customer is null ? NotFound() : Ok(customer);
    }

    [HttpPost]
    public async Task<IActionResult> Create(CustomerSave request)
    {
        var customer = new Customer();
        Copy(request, customer);
        db.Customers.Add(customer);
        await db.SaveChangesAsync();
        return CreatedAtAction(nameof(Get), new { id = customer.Id }, customer);
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, CustomerSave request)
    {
        try
        {
            // Serialize with customer self-service updates and commit both email copies together.
            await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            var customer = await db.Customers.FindAsync(id);
            if (customer is null) return NotFound();
            var account = await db.CustomerAccounts.FirstOrDefaultAsync(x => x.CustomerId == id);
            if (account is not null && string.IsNullOrWhiteSpace(request.Email))
                return BadRequest(new { message = "Khách hàng có tài khoản cần email để khôi phục mật khẩu. Không thể bỏ trống email." });
            Copy(request, customer);
            if (account is not null) account.Email = customer.Email!;
            await db.SaveChangesAsync();
            await tx.CommitAsync();
            return Ok(customer);
        }
        catch (DbUpdateException ex) when (ApiSupport.Unique(ex))
        { return Conflict(new { message = "Email đã được đăng ký cho tài khoản khác." }); }
        catch (Exception ex) when (ApiSupport.Busy(ex))
        { return Conflict(new { message = "Hồ sơ đang được cập nhật. Hãy tải lại và thử lại." }); }
    }

    [HttpDelete("{id:int}"), Authorize(Roles = Roles.Admin)]
    public async Task<IActionResult> Delete(int id)
    {
        var customer = await db.Customers.FindAsync(id);
        if (customer is null) return NotFound();
        if (await db.Bookings.AnyAsync(x => x.CustomerId == id))
            return Conflict(new { message = "Khách hàng đã có lịch sử đặt phòng." });
        db.Customers.Remove(customer);
        try { await db.SaveChangesAsync(); }
        catch (DbUpdateException ex) when (ApiSupport.ForeignKey(ex))
        { return Conflict(new { message = "Khách hàng đã có lịch sử đặt phòng." }); }
        return NoContent();
    }

    private static void Copy(CustomerSave request, Customer customer)
    {
        customer.FullName = request.FullName.Trim();
        customer.IdentityCard = request.IdentityCard?.Trim();
        customer.Phone = request.Phone?.Trim();
        customer.Email = request.Email;
        customer.Address = request.Address?.Trim();
    }
}

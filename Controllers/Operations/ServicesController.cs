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
public sealed class ServicesController(HotelDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> List() =>
        Ok(await db.Services.AsNoTracking().OrderBy(x => x.Id).Select(x => new
        { x.Id, x.Name, x.Description, x.Unit, x.Price, x.IsActive }).ToListAsync());

    [HttpGet("{id:int}")]
    public async Task<IActionResult> Get(int id)
    {
        var service = await db.Services.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id);
        return service is null ? NotFound() : Ok(View(service));
    }

    [HttpPost, Authorize(Roles = Roles.Admin)]
    public async Task<IActionResult> Create(ServiceSave request)
    {
        var service = new HotelService();
        Copy(request, service);
        db.Services.Add(service);
        await db.SaveChangesAsync();
        return CreatedAtAction(nameof(Get), new { id = service.Id }, View(service));
    }

    [HttpPut("{id:int}"), Authorize(Roles = Roles.Admin)]
    public async Task<IActionResult> Update(int id, ServiceSave request)
    {
        var service = await db.Services.FindAsync(id);
        if (service is null) return NotFound();
        Copy(request, service);
        await db.SaveChangesAsync();
        return Ok(View(service));
    }

    [HttpDelete("{id:int}"), Authorize(Roles = Roles.Admin)]
    public async Task<IActionResult> Disable(int id)
    {
        var service = await db.Services.FindAsync(id);
        if (service is null) return NotFound();
        service.IsActive = false;
        await db.SaveChangesAsync();
        return NoContent();
    }

    [HttpPost("{id:int}/activate"), Authorize(Roles = Roles.Admin)]
    public async Task<IActionResult> Activate(int id)
    {
        var service = await db.Services.FindAsync(id);
        if (service is null) return NotFound();
        service.IsActive = true;
        await db.SaveChangesAsync();
        return Ok(View(service));
    }

    [HttpPost("usage")]
    public async Task<IActionResult> Use(UsageCreate request)
    {
        try
        {
            await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            var requestId = Guid.Parse(request.RequestId).ToString("D");
            var existing = await db.ServiceUsageOperations.Include(x => x.Usage)
                .FirstOrDefaultAsync(x => x.RequestId == requestId);
            if (existing is not null)
            {
                if (existing.BookingId != request.BookingId || existing.ServiceId != request.ServiceId || existing.Quantity != request.Quantity)
                    return Conflict(new { message = "Mã thao tác đã dùng cho nội dung dịch vụ khác. Hãy kiểm tra lịch sử trước khi tạo thao tác mới." });
                if (existing.Usage is null)
                    return Conflict(new { message = "Lượt dịch vụ của thao tác này đã được xóa. Không ghi thêm khi gửi lại yêu cầu cũ." });
                return Ok(UsageView(existing.Usage, existing.ServiceName));
            }
            var booking = await db.Bookings.FindAsync(request.BookingId);
            if (booking is null) return NotFound(new { message = "Booking không tồn tại." });
            if (booking.Status != BookingStates.CheckedIn)
                return Conflict(new { message = "Chỉ booking đang ở mới được thêm dịch vụ." });
            var service = await db.Services.FindAsync(request.ServiceId);
            if (service is null || !service.IsActive)
                return BadRequest(new { message = "Dịch vụ không khả dụng." });
            decimal total;
            try { total = checked(service.Price * request.Quantity); }
            catch (OverflowException) { return BadRequest(new { message = "Thành tiền vượt giới hạn." }); }
            if (total > 9999999999999999.99m)
                return BadRequest(new { message = "Thành tiền vượt giới hạn." });
            var usage = new ServiceUsage
            {
                BookingId = booking.Id, ServiceId = service.Id,
                Quantity = request.Quantity, UnitPrice = service.Price, Total = total, ServiceName = service.Name
            };
            db.ServiceUsages.Add(usage);
            db.ServiceUsageOperations.Add(new ServiceUsageOperation
            {
                RequestId = requestId, BookingId = booking.Id, ServiceId = service.Id,
                Quantity = request.Quantity, ServiceName = service.Name, Usage = usage
            });
            await db.SaveChangesAsync();
            await tx.CommitAsync();
            return CreatedAtAction(nameof(UsageForBooking), new { bookingId = booking.Id },
                UsageView(usage, service.Name));
        }
        catch (Exception ex) when (ApiSupport.Busy(ex) || ex is DbUpdateException update && ApiSupport.Unique(update))
        { return Conflict(new { message = "Dịch vụ đang được ghi nhận. Hãy thử lại cùng thao tác để tránh tính trùng." }); }
    }

    [HttpGet("usage/booking/{bookingId:int}")]
    public async Task<IActionResult> UsageForBooking(int bookingId)
    {
        var rows = await db.ServiceUsages.AsNoTracking().Include(x => x.Service)
            .Where(x => x.BookingId == bookingId).OrderBy(x => x.Id).ToListAsync();
        return Ok(rows.Select(x => UsageView(x, x.ServiceName)));
    }

    [HttpDelete("usage/{id:int}")]
    public async Task<IActionResult> DeleteUsage(int id)
    {
        try
        {
            // Keep the status check and deletion in the same transaction as competing check-out writes.
            await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            var usage = await db.ServiceUsages.Include(x => x.Booking).FirstOrDefaultAsync(x => x.Id == id);
            if (usage is null) return NotFound();
            if (usage.Booking.Status != BookingStates.CheckedIn)
                return Conflict(new { message = "Không thể sửa dịch vụ của booking đã kết thúc." });
            db.ServiceUsages.Remove(usage);
            await db.SaveChangesAsync();
            await tx.CommitAsync();
            return NoContent();
        }
        catch (Exception ex) when (ApiSupport.Busy(ex))
        { return Conflict(new { message = "Booking hoặc dịch vụ đang được cập nhật. Hãy tải lại trước khi thử lại." }); }
    }

    private static void Copy(ServiceSave request, HotelService service)
    {
        service.Name = request.Name.Trim();
        service.Description = request.Description?.Trim();
        service.Unit = request.Unit.Trim();
        service.Price = request.Price!.Value;
    }

    private static object View(HotelService service) =>
        new { service.Id, service.Name, service.Description, service.Unit, service.Price, service.IsActive };

    private static object UsageView(ServiceUsage usage, string name) =>
        new { usage.Id, usage.BookingId, usage.ServiceId, serviceName = name,
            usage.Quantity, usage.UnitPrice, usage.Total, usage.UsedAt };
}

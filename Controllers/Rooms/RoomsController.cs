using HotelManagementAPI.Data;
using HotelManagementAPI.DTOs;
using HotelManagementAPI.Models;
using HotelManagementAPI.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace HotelManagementAPI.Controllers;

[ApiController, Route("api/[controller]"), Authorize(Roles = Roles.Staff)]
public sealed class RoomsController(HotelDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> List([FromQuery] RoomQuery query)
    {
        var rooms = db.Rooms.Include(x => x.RoomType).AsNoTracking().AsQueryable();
        if (!string.IsNullOrWhiteSpace(query.Keyword))
            rooms = rooms.Where(x => x.RoomNumber.Contains(query.Keyword.Trim()));
        if (query.Status.HasValue) rooms = rooms.Where(x => x.Status == query.Status.Value);
        if (query.RoomTypeId.HasValue) rooms = rooms.Where(x => x.RoomTypeId == query.RoomTypeId.Value);
        var count = await rooms.CountAsync();
        rooms = query.SortBy?.ToLowerInvariant() switch
        {
            "gia_tang" or "price_asc" => rooms.OrderBy(x => x.Price).ThenBy(x => x.Id),
            "gia_giam" or "price_desc" => rooms.OrderByDescending(x => x.Price).ThenBy(x => x.Id),
            "sophong" or "roomnumber" => rooms.OrderBy(x => x.RoomNumber).ThenBy(x => x.Id),
            _ => rooms.OrderBy(x => x.Id)
        };
        var skip = (long)(query.PageNumber - 1) * query.PageSize;
        var rows = skip >= count ? [] : await rooms.Skip((int)skip).Take(query.PageSize).ToListAsync();
        return Ok(ApiSupport.Page(rows.Select(ApiSupport.RoomView).ToList(), count, query.PageNumber, query.PageSize));
    }

    [HttpGet("{id:int}")]
    public async Task<IActionResult> Get(int id)
    {
        var room = await db.Rooms.Include(x => x.RoomType).AsNoTracking().FirstOrDefaultAsync(x => x.Id == id);
        return room is null ? NotFound() : Ok(ApiSupport.RoomView(room));
    }

    [HttpPost, Authorize(Roles = Roles.Admin)]
    public async Task<IActionResult> Create(RoomSave request)
    {
        if (!await db.RoomTypes.AnyAsync(x => x.Id == request.RoomTypeId))
            return BadRequest(new { message = "Loại phòng không tồn tại." });
        var room = new Room
        {
            RoomNumber = request.RoomNumber.Trim(), RoomTypeId = request.RoomTypeId,
            Capacity = request.Capacity, Price = request.Price!.Value, Description = request.Description?.Trim()
        };
        db.Rooms.Add(room);
        try { await db.SaveChangesAsync(); }
        catch (DbUpdateException ex) when (ApiSupport.Unique(ex))
        { return Conflict(new { message = "Số phòng đã tồn tại." }); }
        return CreatedAtAction(nameof(Get), new { id = room.Id }, ApiSupport.RoomView(
            (await db.Rooms.Include(x => x.RoomType).FirstAsync(x => x.Id == room.Id))));
    }

    [HttpPut("{id:int}"), Authorize(Roles = Roles.Admin)]
    public async Task<IActionResult> Update(int id, RoomUpdate request)
    {
        await using var tx = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable);
        var room = await db.Rooms.Include(x => x.RoomType).FirstOrDefaultAsync(x => x.Id == id);
        if (room is null) return NotFound();
        if (!await db.RoomTypes.AnyAsync(x => x.Id == request.RoomTypeId))
            return BadRequest(new { message = "Loại phòng không tồn tại." });
        var occupied = await db.Bookings.AnyAsync(x => x.RoomId == id && x.Status == BookingStates.CheckedIn);
        if ((occupied && request.Status != RoomStatus.Occupied) ||
            (!occupied && request.Status == RoomStatus.Occupied))
            return Conflict(new { message = "Trạng thái Đang thuê chỉ thay đổi qua check-in/check-out." });
        if (await db.Bookings.AnyAsync(x => x.RoomId == id &&
            (x.Status == BookingStates.Reserved || x.Status == BookingStates.CheckedIn) &&
            x.GuestCount > request.Capacity))
            return Conflict(new { message = "Sức chứa thấp hơn số khách của booking chưa kết thúc." });
        if(room.Status==RoomStatus.Cleaning && request.Status==RoomStatus.Available)
            return Conflict(new{message="Hãy xác nhận dọn phòng xong trong mục Dọn phòng."});
        room.Capacity = request.Capacity;
        room.RoomNumber = request.RoomNumber.Trim();
        room.RoomTypeId = request.RoomTypeId;
        room.Price = request.Price!.Value;
        room.Description = request.Description?.Trim();
        room.Status = request.Status!.Value;
        try { await db.SaveChangesAsync(); }
        catch (DbUpdateException ex) when (ApiSupport.Unique(ex))
        { return Conflict(new { message = "Số phòng đã tồn tại." }); }
        await tx.CommitAsync();
        await db.Entry(room).Reference(x => x.RoomType).LoadAsync();
        return Ok(ApiSupport.RoomView(room));
    }

    [HttpPatch("{id:int}/trang-thai"), Authorize(Roles = Roles.Admin)]
    public async Task<IActionResult> ChangeStatus(int id, [FromBody] RoomStatus? status)
    {
        if (!status.HasValue || !Enum.IsDefined(status.Value))
            return BadRequest(new { message = "Trạng thái không hợp lệ." });
        try
        {
            // Acquire the transaction before reading so check-in cannot invalidate these checks.
            await using var tx = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable);
            var room = await db.Rooms.FindAsync(id);
            if (room is null) return NotFound();
            var occupied = await db.Bookings.AnyAsync(x => x.RoomId == id && x.Status == BookingStates.CheckedIn);
            if ((occupied && status != RoomStatus.Occupied) ||
                (!occupied && status == RoomStatus.Occupied))
                return Conflict(new { message = "Trạng thái Đang thuê chỉ thay đổi qua check-in/check-out." });
            if(room.Status==RoomStatus.Cleaning && status==RoomStatus.Available)
                return Conflict(new{message="Hãy xác nhận dọn phòng xong trong mục Dọn phòng."});
            room.Status = status.Value;
            await db.SaveChangesAsync();
            await tx.CommitAsync();
            return Ok(new { room.Id, room.Status });
        }
        catch (Exception ex) when (ApiSupport.Busy(ex))
        { return Conflict(new { message = "Phòng đang được cập nhật. Hãy tải lại trước khi thử lại." }); }
    }

    [HttpDelete("{id:int}"), Authorize(Roles = Roles.Admin)]
    public async Task<IActionResult> Delete(int id)
    {
        var room = await db.Rooms.FindAsync(id);
        if (room is null) return NotFound();
        if (await db.Bookings.AnyAsync(x => x.RoomId == id))
            return Conflict(new { message = "Phòng đã có lịch sử đặt phòng." });
        db.Rooms.Remove(room);
        try { await db.SaveChangesAsync(); }
        catch (DbUpdateException ex) when (ApiSupport.ForeignKey(ex))
        { return Conflict(new { message = "Phòng đã có lịch sử đặt phòng." }); }
        return NoContent();
    }
}

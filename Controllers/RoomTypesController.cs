using HotelManagementAPI.Data;
using HotelManagementAPI.DTOs;
using HotelManagementAPI.Models;
using HotelManagementAPI.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace HotelManagementAPI.Controllers;

[ApiController, Route("api/[controller]"), Authorize(Roles = Roles.Staff)]
public sealed class RoomTypesController(HotelDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> List([FromQuery] RoomTypeQuery query)
    {
        var types = db.RoomTypes.AsNoTracking().AsQueryable();
        if (!string.IsNullOrWhiteSpace(query.Keyword))
            types = types.Where(x => x.Name.Contains(query.Keyword.Trim()));
        var count = await types.CountAsync();
        types = query.SortBy?.ToLowerInvariant() switch
        {
            "name_desc" => types.OrderByDescending(x => x.Name).ThenBy(x => x.Id),
            "room_count_asc" => types.OrderBy(x => x.Rooms.Count).ThenBy(x => x.Id),
            "room_count_desc" => types.OrderByDescending(x => x.Rooms.Count).ThenBy(x => x.Id),
            _ => types.OrderBy(x => x.Name).ThenBy(x => x.Id)
        };
        var skip = (long)(query.PageNumber - 1) * query.PageSize;
        var rows = skip >= count ? [] : await types.Skip((int)skip).Take(query.PageSize)
            .Select(x => new { x.Id, x.Name, x.Description, roomCount = x.Rooms.Count })
            .ToListAsync();
        return Ok(ApiSupport.Page(rows, count, query.PageNumber, query.PageSize));
    }

    [HttpGet("{id:int}")]
    public async Task<IActionResult> Get(int id)
    {
        var type = await db.RoomTypes.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id);
        if (type is null) return NotFound();
        return Ok(ApiSupport.TypeView(type, await db.Rooms.CountAsync(x => x.RoomTypeId == id)));
    }

    [HttpPost, Authorize(Roles = Roles.Admin)]
    public async Task<IActionResult> Create(RoomTypeSave request)
    {
        var type = new RoomType { Name = request.Name.Trim(), Description = request.Description?.Trim() };
        db.RoomTypes.Add(type);
        try { await db.SaveChangesAsync(); }
        catch (DbUpdateException ex) when (ApiSupport.Unique(ex))
        { return Conflict(new { message = "Tên loại phòng đã tồn tại." }); }
        return CreatedAtAction(nameof(Get), new { id = type.Id }, ApiSupport.TypeView(type, 0));
    }

    [HttpPut("{id:int}"), Authorize(Roles = Roles.Admin)]
    public async Task<IActionResult> Update(int id, RoomTypeSave request)
    {
        var type = await db.RoomTypes.FindAsync(id);
        if (type is null) return NotFound();
        type.Name = request.Name.Trim();
        type.Description = request.Description?.Trim();
        try { await db.SaveChangesAsync(); }
        catch (DbUpdateException ex) when (ApiSupport.Unique(ex))
        { return Conflict(new { message = "Tên loại phòng đã tồn tại." }); }
        return Ok(ApiSupport.TypeView(type, await db.Rooms.CountAsync(x => x.RoomTypeId == id)));
    }

    [HttpDelete("{id:int}"), Authorize(Roles = Roles.Admin)]
    public async Task<IActionResult> Delete(int id)
    {
        var type = await db.RoomTypes.FindAsync(id);
        if (type is null) return NotFound();
        if (await db.Rooms.AnyAsync(x => x.RoomTypeId == id))
            return Conflict(new { message = "Loại phòng đang được sử dụng." });
        db.RoomTypes.Remove(type);
        try { await db.SaveChangesAsync(); }
        catch (DbUpdateException ex) when (ApiSupport.ForeignKey(ex))
        { return Conflict(new { message = "Loại phòng đang được sử dụng." }); }
        return NoContent();
    }
}

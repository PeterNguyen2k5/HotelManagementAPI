using HotelManagementAPI.Data;
using HotelManagementAPI.DTOs;
using HotelManagementAPI.Models;
using HotelManagementAPI.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
namespace HotelManagementAPI.Controllers;
[ApiController,Route("api/Administration"),Authorize(Roles=Roles.Admin)]
public sealed class AdministrationController(HotelDbContext db,BackupService backups) : ControllerBase
{
    [HttpPost("demo-rooms")]
    public async Task<IActionResult> DemoRooms(CancellationToken token)
    {
        Response.Headers.CacheControl="no-store";
        try
        {
            await using var tx=await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable,token);
            var created=await DemoRoomCatalog.CreateWhenEmpty(db,token);
            await tx.CommitAsync(token);
            return Ok(new {created,roomsCreated=created?6:0,message=created
                ? "Đã tạo 3 hạng phòng và 6 phòng mẫu. Giá, tiện nghi và ảnh là minh họa; hãy chỉnh lại trước khi nhận khách thật."
                : "Khách sạn đã có phòng. Giữ nguyên dữ liệu hiện có, không thêm hoặc ghi đè phòng mẫu."});
        }
        catch(Exception ex) when(ApiSupport.Busy(ex) || ex is DbUpdateException update && ApiSupport.Unique(update))
        {return Conflict(new{message="Danh sách phòng vừa thay đổi. Hãy tải lại để kiểm tra trước khi thử tiếp."});}
    }
    [HttpGet("audit")]
    public async Task<IActionResult> Audit([FromQuery] PageQuery query)
    {
        var count=await db.AuditLogs.CountAsync();var skip=(long)(query.PageNumber-1)*query.PageSize;
        var rows=skip>=count?new List<AuditLog>():await db.AuditLogs.AsNoTracking().OrderByDescending(x=>x.Id).Skip((int)skip).Take(query.PageSize).ToListAsync();
        return Ok(ApiSupport.Page(rows,count,query.PageNumber,query.PageSize));
    }
    [HttpGet("backups")]
    public async Task<IActionResult> Backups(){Response.Headers.CacheControl="no-store";return Ok(await db.DatabaseBackups.AsNoTracking().OrderByDescending(x=>x.Id).Take(100).ToListAsync());}
    [HttpPost("backups")]
    public async Task<IActionResult> Create(CancellationToken token){Response.Headers.CacheControl="no-store";return Ok(await backups.Create(User.Identity?.Name??"Admin",token));}
    [HttpGet("backups/{id:int}/download")]
    public async Task<IActionResult> Download(int id)
    {
        var record=await db.DatabaseBackups.AsNoTracking().FirstOrDefaultAsync(x=>x.Id==id);
        if(record is null)return NotFound();
        var stream=backups.OpenDownload(record);if(stream is null)return NotFound();
        Response.Headers.CacheControl="no-store";
        return File(stream,record.FileName.EndsWith(".zip",StringComparison.Ordinal)?"application/zip":"application/octet-stream",record.FileName,enableRangeProcessing:true);
    }
}

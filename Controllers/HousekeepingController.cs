using System.Data;
using HotelManagementAPI.Data;
using HotelManagementAPI.Models;
using HotelManagementAPI.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
namespace HotelManagementAPI.Controllers;
[ApiController,Route("api/Housekeeping"),Authorize(Roles=Roles.Staff)]
public sealed class HousekeepingController(HotelDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> List()=>Ok((await db.Rooms.AsNoTracking().Include(x=>x.RoomType).Where(x=>x.Status==RoomStatus.Cleaning).OrderBy(x=>x.RoomNumber).ToListAsync()).Select(ApiSupport.RoomView));
    [HttpPost("{id:int}/complete")]
    public async Task<IActionResult> Complete(int id)
    {
        try{
            await using var tx=await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            var room=await db.Rooms.Include(x=>x.RoomType).FirstOrDefaultAsync(x=>x.Id==id);
            if(room is null)return NotFound();
            if(room.Status!=RoomStatus.Cleaning || await db.Bookings.AnyAsync(x=>x.RoomId==id && x.Status==BookingStates.CheckedIn))return Conflict(new{message="Phòng không ở trạng thái chờ dọn hoặc vẫn có khách."});
            room.Status=RoomStatus.Available;await db.SaveChangesAsync();await tx.CommitAsync();return Ok(ApiSupport.RoomView(room));
        }catch(Exception ex) when(ApiSupport.Busy(ex)){return Conflict(new{message="Phòng đang cập nhật. Hãy thử lại."});}
    }
}

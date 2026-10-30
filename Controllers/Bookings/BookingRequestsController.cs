using System.Data;
using System.Security.Claims;
using HotelManagementAPI.Data;
using HotelManagementAPI.DTOs;
using HotelManagementAPI.Models;
using HotelManagementAPI.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
namespace HotelManagementAPI.Controllers;

[ApiController,Route("api/BookingRequests")]
public sealed class BookingRequestsController(HotelDbContext db,HotelWorkflow workflow, BookingHolds holds) : ControllerBase
{
    [HttpPost("{bookingId:int}"),Authorize(Roles=Roles.Customer)]
    public async Task<IActionResult> Create(int bookingId,GuestBookingRequest request)
    {
        try{
            await using var tx=await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            var accountId=int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
            var customerId=await db.CustomerAccounts.Where(x=>x.Id==accountId).Select(x=>x.CustomerId).FirstAsync();
            var b=await db.Bookings.FirstOrDefaultAsync(x=>x.Id==bookingId && x.CustomerId==customerId);
            if(b is null)return NotFound();
            if(await holds.TryExpire(b)){await db.SaveChangesAsync();await tx.CommitAsync();return Conflict(new {message=BookingHolds.ExpiredMessage});}
            if(b.Status!=BookingStates.Reserved)return Conflict(new{message="Chỉ booking chưa nhận phòng mới gửi yêu cầu hủy/đổi."});
            if(await db.BookingRequests.AnyAsync(x=>x.BookingId==bookingId && x.Status=="Pending"))return Conflict(new{message="Booking đang có yêu cầu chờ xử lý."});
            if(request.Type=="Change" && (!request.CheckInDate.HasValue || !request.CheckOutDate.HasValue || request.CheckInDate.Value.Date<workflow.Now.Date || request.CheckOutDate.Value.Date<=request.CheckInDate.Value.Date))
                return BadRequest(new{message="Hãy nhập ngày nhận/trả phòng hợp lệ."});
            var roomId=request.RoomId??b.RoomId;
            if(request.Type=="Change" && !await db.Rooms.AnyAsync(x=>x.Id==roomId && x.Capacity>=(b.GuestCount??1)))return BadRequest(new{message="Phòng không tồn tại hoặc không đủ sức chứa."});
            var r=new BookingRequest{BookingId=bookingId,BookingRevision=b.Revision,Type=request.Type,Reason=request.Reason.Trim(),CreatedAt=workflow.Now,
                RoomId=request.Type=="Change"?roomId:null,CheckInDate=request.Type=="Change"?request.CheckInDate!.Value.Date:null,CheckOutDate=request.Type=="Change"?request.CheckOutDate!.Value.Date:null};
            db.BookingRequests.Add(r);await db.SaveChangesAsync();await tx.CommitAsync();return StatusCode(201,View(r));
        }catch(Exception ex) when(ApiSupport.Busy(ex) || ex is DbUpdateException update && ApiSupport.Unique(update))
        {return Conflict(new{message="Yêu cầu vừa được cập nhật. Hãy tải lại."});}
    }
    [HttpGet("mine"),Authorize(Roles=Roles.Customer)]
    public async Task<IActionResult> Mine([FromQuery] PageQuery query)
    {
        var accountId=int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
        var customerId=await db.CustomerAccounts.Where(x=>x.Id==accountId).Select(x=>x.CustomerId).FirstAsync();
        return await Page(db.BookingRequests.AsNoTracking().Where(x=>x.Booking.CustomerId==customerId),query);
    }
    [HttpGet,Authorize(Roles=Roles.Staff)]
    public Task<IActionResult> List([FromQuery] PageQuery query,[FromQuery] string? status)
        => Page(db.BookingRequests.AsNoTracking().Where(x=>status==null || x.Status==status),query);
    private async Task<IActionResult> Page(IQueryable<BookingRequest> rows,PageQuery query)
    {
        var count=await rows.CountAsync();var skip=(long)(query.PageNumber-1)*query.PageSize;
        var result=skip>=count?new List<BookingRequest>():await rows.Include(x=>x.Booking).ThenInclude(x=>x.Customer).OrderByDescending(x=>x.Id).Skip((int)skip).Take(query.PageSize).ToListAsync();
        return Ok(ApiSupport.Page(result.Select(View).ToList(),count,query.PageNumber,query.PageSize));
    }
    [HttpPost("{id:int}/resolve"),Authorize(Roles=Roles.Staff)]
    public async Task<IActionResult> Resolve(int id,ResolveBookingRequest request)
    {
        try{
            await using var tx=await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            var r=await db.BookingRequests.FirstOrDefaultAsync(x=>x.Id==id);
            if(r is null)return NotFound();if(r.Status!="Pending")return Conflict(new{message="Yêu cầu đã được xử lý."});
            var b=await ApiSupport.FullBookings(db).FirstAsync(x=>x.Id==r.BookingId);
            if(await holds.TryExpire(b)){await db.SaveChangesAsync();await tx.CommitAsync();return Conflict(new {message=BookingHolds.ExpiredMessage});}
            if(request.Approve==true){
                if(b.Revision!=r.BookingRevision)throw new WorkflowConflict("Booking đã thay đổi từ lúc gửi yêu cầu. Hãy từ chối và đề nghị khách gửi lại.");
                if(r.Type=="Cancel")await workflow.Cancel(b,r.Id);
                else await workflow.Amend(b,new AmendBooking{RoomId=r.RoomId!.Value,CheckInDate=r.CheckInDate,CheckOutDate=r.CheckOutDate});
            }
            r.Status=request.Approve==true?"Approved":"Rejected";r.StaffNote=request.Note?.Trim();r.ResolvedAt=workflow.Now;r.ResolvedBy=User.Identity?.Name;
            await db.SaveChangesAsync();await tx.CommitAsync();return Ok(View(r));
        }catch(WorkflowConflict ex){return Conflict(new{message=ex.Message});}
        catch(Exception ex) when(ApiSupport.Busy(ex)){return Conflict(new{message="Yêu cầu đang được cập nhật. Hãy thử lại."});}
    }
    private static object View(BookingRequest r)=>new{r.Id,r.BookingId,customerName=r.Booking?.Customer?.FullName,r.Type,r.Status,r.Reason,r.RoomId,r.CheckInDate,r.CheckOutDate,r.StaffNote,r.CreatedAt,r.ResolvedAt,r.ResolvedBy};
}

using System.Text.Json;
using HotelManagementAPI.Data;
using HotelManagementAPI.DTOs;
using HotelManagementAPI.Models;
using Microsoft.EntityFrameworkCore;
namespace HotelManagementAPI.Services;

public sealed class WorkflowConflict(string message) : Exception(message);
public sealed class HotelWorkflow(HotelDbContext db, TimeProvider clock)
{
    public DateTime Now => clock.GetLocalNow().DateTime;
    public static decimal Gross(Booking b) => b.Status==BookingStates.Cancelled ? 0 : b.Detail.RoomTotal+b.ServiceUsages.Sum(x=>x.Total);
    public static decimal Paid(Booking b) => b.Payments.Sum(x=>x.Type=="Refund" ? -x.Amount : x.Amount);
    public static object Balance(Booking b) => new { total=Gross(b),paid=Paid(b),due=Math.Max(0,Gross(b)-Paid(b)),refundDue=Math.Max(0,Paid(b)-Gross(b)) };
    private static decimal Amount(decimal unit,int nights)
    {
        var total=unit*nights;
        if(total>9999999999999999.99m) throw new WorkflowConflict("Tiền phòng vượt giới hạn.");
        return total;
    }
    public void CloseRoomSegment(Booking b, DateTime end, bool final)
    {
        var start=(b.CurrentRoomSince ?? b.ActualCheckInAt ?? b.CheckInDate).Date;
        var nights=Math.Max(final && b.RoomCharges.Sum(x=>x.Nights)==0 ? 1 : 0,(end.Date-start).Days);
        b.RoomCharges.Add(new RoomCharge { RoomNumber=b.Room.RoomNumber,StartDate=start,EndDate=end.Date,
            Nights=nights,UnitPrice=b.Detail.RoomPricePerNight,Total=Amount(b.Detail.RoomPricePerNight,nights) });
    }
    public void Quote(Booking b,DateTime end)
    {
        var start=(b.CurrentRoomSince ?? b.ActualCheckInAt ?? b.CheckInDate).Date;
        var nights=Math.Max(0,(end.Date-start).Days);
        b.Detail.Nights=b.RoomCharges.Sum(x=>x.Nights)+nights;
        b.Detail.RoomTotal=b.RoomCharges.Sum(x=>x.Total)+Amount(b.Detail.RoomPricePerNight,nights);
        if(b.Detail.RoomTotal>9999999999999999.99m) throw new WorkflowConflict("Tiền phòng vượt giới hạn.");
    }
    public async Task Amend(Booking b, AmendBooking change)
    {
        if(b.Status is not (BookingStates.Reserved or BookingStates.CheckedIn)) throw new WorkflowConflict("Booking đã kết thúc.");
        var start=change.CheckInDate!.Value.Date;var end=change.CheckOutDate!.Value.Date;
        var staying=b.Status==BookingStates.CheckedIn;
        if(end<=start || end<=Now.Date || (!staying && start<Now.Date)) throw new WorkflowConflict("Ngày lưu trú không hợp lệ.");
        if(staying && start!=b.CheckInDate.Date) throw new WorkflowConflict("Không thể đổi ngày nhận của khách đang ở.");
        var target=await db.Rooms.FirstOrDefaultAsync(x=>x.Id==change.RoomId) ?? throw new WorkflowConflict("Phòng không tồn tại.");
        var move=target.Id!=b.RoomId;
        if(target.Capacity<(b.GuestCount??1)) throw new WorkflowConflict("Phòng không đủ sức chứa.");
        if(target.Status==RoomStatus.Maintenance || (target.Status==RoomStatus.Cleaning && (staying || start<=Now.Date)) ||
            (staying && move && target.Status!=RoomStatus.Available)) throw new WorkflowConflict("Phòng chưa sẵn sàng.");
        var occupied=await db.Bookings.AnyAsync(x=>x.RoomId==target.Id && x.Status==BookingStates.CheckedIn && x.Id!=b.Id);
        if(target.Status==RoomStatus.Occupied && !occupied && !(staying && !move)) throw new WorkflowConflict("Trạng thái phòng không khả dụng.");
        var overlapStart=staying?Now.Date:start;
        if(await BookingHolds.Blocking(db, clock.GetUtcNow().UtcDateTime).AnyAsync(x=>x.Id!=b.Id && x.RoomId==target.Id &&
            ((x.Status==BookingStates.CheckedIn && x.CheckOutDate<=Now.Date) || (x.CheckInDate<end && overlapStart<x.CheckOutDate))))
            throw new WorkflowConflict("Phòng có lịch đặt trùng hoặc khách quá hạn chưa trả phòng.");
        if(staying && move)
        {
            CloseRoomSegment(b,Now,false);
            b.Room.Status=RoomStatus.Cleaning;target.Status=RoomStatus.Occupied;
            b.CurrentRoomSince=Now.Date;
        }
        if(move) b.Detail.RoomPricePerNight=target.Price;
        b.Room=target;b.RoomId=target.Id;b.CheckInDate=start;b.CheckOutDate=end;b.Revision++;
        Quote(b,end);
    }
    public async Task Cancel(Booking b,int? exceptRequest=null)
    {
        if(b.Status!=BookingStates.Reserved) throw new WorkflowConflict("Chỉ booking đã đặt mới được hủy.");
        b.Status=BookingStates.Cancelled;b.Revision++;
        foreach(var r in await db.BookingRequests.Where(x=>x.BookingId==b.Id && x.Status=="Pending").ToListAsync())
            if(r.Id!=exceptRequest){r.Status="Rejected";r.StaffNote="Booking đã hủy.";r.ResolvedAt=Now;}
    }
    public void IssueInvoice(Booking b)
    {
        var number=$"AN-{b.Id:D8}";
        var rooms=b.RoomCharges.Select(x=>new {x.RoomNumber,x.StartDate,x.EndDate,x.Nights,x.UnitPrice,x.Total}).ToList();
        if(rooms.Count==0) rooms.Add(new {b.Room.RoomNumber,StartDate=b.CheckInDate,EndDate=b.CheckOutDate,Nights=b.Detail.Nights,UnitPrice=b.Detail.RoomPricePerNight,Total=b.Detail.RoomTotal});
        var snapshot=new {number,bookingId=b.Id,customerName=b.Customer.FullName,phone=b.Customer.Phone,
            checkIn=b.ActualCheckInAt,checkOut=b.ActualCheckOutAt,rooms,
            services=b.ServiceUsages.Select(x=>new {name=x.ServiceName,x.Quantity,x.UnitPrice,x.Total}),
            roomTotal=b.Detail.RoomTotal,serviceTotal=b.ServiceUsages.Sum(x=>x.Total),total=Gross(b)};
        db.BookingInvoices.Add(new BookingInvoice { BookingId=b.Id,Number=number,IssuedAt=Now,
            Snapshot=JsonSerializer.Serialize(snapshot,new JsonSerializerOptions(JsonSerializerDefaults.Web)) });
    }
}

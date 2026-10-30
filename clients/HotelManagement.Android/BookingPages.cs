using Android.Widget;
using Android.Views;
using HotelManagement.Client;
namespace HotelManagement.Android;

public sealed partial class MainActivity
{
    private async Task SearchPage()
    {
        Page("Kỳ nghỉ dành cho bạn","rooms");var version=generation;var ct=screen.Token;
        var cfg=await api.Configuration(ct);var options=await api.GuestOptions(ct);if(version!=generation)return;
        maxGuests=Math.Clamp(options.MaxGuests,1,100);guests=Math.Clamp(guests,1,maxGuests);
        if(checkIn<cfg.Today){checkIn=cfg.Today;checkOut=checkIn.AddDays(1);}
        if(checkOut<=checkIn)checkOut=checkIn.AddDays(1);
        var search=Card();search.AddView(Text("Tìm một không gian an yên",20,true));
        DateButton(search,"Nhận phòng",checkIn,d=>checkIn=d);DateButton(search,"Trả phòng",checkOut,d=>checkOut=d);
        search.AddView(Text("Số khách trong một phòng",13,true));
        var count=new NumberPicker(this){MinValue=1,MaxValue=maxGuests,Value=guests,WrapSelectorWheel=false};search.AddView(count);
        var results=new LinearLayout(this){Orientation=Orientation.Vertical};
        async Task Find()
        {
            guests=count.Value;if(checkIn<cfg.Today||checkOut<=checkIn)throw new ApiException("Chọn ngày từ hôm nay của khách sạn và ngày trả sau ngày nhận.");
            results.RemoveAllViews();var rows=await api.Available(checkIn,checkOut,guests,ct);if(version!=generation)return;
            results.AddView(Text($"{rows.Count} phòng phù hợp · {checkIn:dd/MM} – {checkOut:dd/MM}",16,true));
            if(rows.Count==0)results.AddView(Text("Chưa có phòng trống cho lựa chọn này. Hãy thử ngày hoặc số khách khác."));
            foreach(var room in rows)
            {
                var card=new LinearLayout(this){Orientation=Orientation.Vertical};card.SetPadding(Dp(15),Dp(12),Dp(15),Dp(15));card.SetBackgroundColor(global::Android.Graphics.Color.White);
                results.AddView(card,new LinearLayout.LayoutParams(-1,-2){BottomMargin=Dp(14)});
                var cover=Image(card,150);_=Guard(()=>LoadImage(cover,new Uri(api.BaseAddress,room.CoverUrl),ct));
                card.AddView(Text(room.RoomTypeName,12));card.AddView(Text("Phòng "+room.RoomNumber,22,true));card.AddView(Text(Presentation.Money(room.Price)+" / đêm",18,true));card.AddView(Text("Tối đa "+room.Capacity+" khách"));
                if(!string.IsNullOrWhiteSpace(room.Description))card.AddView(Text(room.Description,14));
                Button(card,"Chọn phòng này",()=>{if(!api.IsCustomer){pendingRoom=room;LoginPage();return Task.CompletedTask;}return ReservePage(room);});
            }
        }
        Button(search,"Tìm phòng",Find);content.AddView(results);await Find();
    }
    private async Task ReservePage(Room room)
    {
        if(!SignedIn())return;Page("Xác nhận đặt phòng","rooms");var profile=api.Session!.Account!;var box=Card();
        box.AddView(Text("Phòng "+room.RoomNumber,24,true));box.AddView(Text(room.RoomTypeName));box.AddView(Text($"{checkIn:dd/MM/yyyy} → {checkOut:dd/MM/yyyy} · {guests} khách"));
        box.AddView(Text(Presentation.Money(room.Price*(checkOut.DayNumber-checkIn.DayNumber)),23,true));box.AddView(Text(profile.FullName+"\n"+profile.Phone+"\n"+profile.Email));
        box.AddView(Text("Giữ chỗ 30 phút nếu chưa nhận tiền. Hết hạn booking tự hủy và mở lại phòng.",14));var note=Input(box,"Ghi chú (không bắt buộc)",multiline:true);note.SetFilters([new global::Android.Text.InputFilterLengthFilter(500)]);
        bool uncertain=false;global::Android.Widget.Button? submit=null;
        submit=Button(box,"Giữ chỗ & thanh toán",async()=>
        {
            if(uncertain)throw new ApiException("Kết quả trước đó chưa rõ. Hãy mở Booking để kiểm tra, không gửi lại ngay.");
            if(!await Confirm("Giữ phòng "+room.RoomNumber,$"Đặt {checkIn:dd/MM} – {checkOut:dd/MM}, {guests} khách, dự kiến {Presentation.Money(room.Price*(checkOut.DayNumber-checkIn.DayNumber))}?"))return;
            try{var created=await api.CreateGuestBooking(new(room.Id,guests,checkIn,checkOut,profile.FullName,profile.Phone,profile.Email,note.Text),screen.Token);await PaymentPage(created.Id);}
            catch(ApiException ex)when(ex.OutcomeUncertain){uncertain=true;submit!.Text="Chưa rõ kết quả — kiểm tra Booking";throw;}
        });
        Button(box,"Kiểm tra booking của tôi",()=>MyBookings(),true);await Task.CompletedTask;
    }
    private async Task MyBookings(int page=1)
    {
        if(!SignedIn())return;Page("Booking của tôi","bookings");var version=generation;var data=await api.MyBookings(page,ct:screen.Token);if(version!=generation)return;
        if(data.Items.Count==0)content.AddView(Text("Bạn chưa có booking. Chọn Phòng để tìm kỳ nghỉ phù hợp."));
        foreach(var row in data.Items)
        {
            var b=row.Booking;var box=Card();box.AddView(Text($"#{b.Id} · Phòng {b.RoomNumber}",21,true));box.AddView(Text(Presentation.BookingStatus(b.Status),14,true));box.AddView(Text($"{Presentation.Date(b.CheckInDate)} → {Presentation.Date(b.CheckOutDate)}"));
            box.AddView(Text($"Tổng {Presentation.Money(b.TotalAmount)}\nĐã thanh toán {Presentation.Money(b.PaidAmount)}",16));Button(box,b.Balance>0&&b.Status!="Cancelled"?"Xem chi tiết / Thanh toán":"Xem chi tiết",()=>PaymentPage(b.Id));
        }
        if(page>1)Button(content,"‹ Trang trước",()=>MyBookings(page-1),true);
        content.AddView(Text($"Trang {page}/{Math.Max(1,data.TotalPages)}",13));if(page<data.TotalPages)Button(content,"Trang sau ›",()=>MyBookings(page+1),true);
    }
    private async Task NotificationsPage()
    {
        if(!SignedIn())return;Page("Thông báo","notifications");var version=generation;var feed=await api.Notifications(screen.Token);if(version!=generation)return;
        Notice(feed.UnreadCount+" thông báo chưa đọc");if(feed.Items.Count==0)content.AddView(Text("Chưa có thông báo. Hạn thanh toán, khoản tiền đã nhận và kết quả yêu cầu sẽ xuất hiện tại đây."));
        foreach(var n in feed.Items){var box=Card();box.AddView(Text((n.IsRead?"":"● ")+n.Title,17,true));box.AddView(Text(n.Message,14));Button(box,"Xem booking #"+n.BookingId,async()=>{await api.ReadNotification(n.Id,screen.Token);await PaymentPage(n.BookingId);},true);}
        Button(content,"Tải lại thông báo",NotificationsPage,true);
    }
}

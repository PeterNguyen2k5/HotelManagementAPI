using Android.Content;
using Android.Widget;
using HotelManagement.Client;
namespace HotelManagement.Android;

public sealed partial class MainActivity
{
    private async Task PaymentPage(int id)
    {
        if(!SignedIn())return;Page("Booking #"+id,"bookings");var version=generation;var ct=screen.Token;
        var info=await api.BookingInfo(id,ct);BankConfiguration bank;
        try{bank=await api.Bank(ct);}catch(ApiException){bank=new(false,"","","","",null,false,null);Notice("Chưa tải được cấu hình chuyển khoản. Vui lòng tải lại hoặc liên hệ lễ tân.");}
        if(version!=generation)return;
        var box=Card();box.AddView(Text("Phòng "+info.RoomNumber,23,true));box.AddView(Text(info.RoomTypeName));box.AddView(Text($"{Presentation.Date(info.CheckInDate)} → {Presentation.Date(info.CheckOutDate)}"));
        var state=Text(Presentation.BookingStatus(info.Status),16,true);box.AddView(state);
        var balance=Text($"Đã nhận {Presentation.Money(info.Balance.Paid)} · Còn {Presentation.Money(info.Balance.Due)}",18,true);box.AddView(balance);
        var countdown=Text("",16,true);box.AddView(countdown);var clock=new HoldClock();clock.Synchronize(info.PaymentDueAtUtc,info.ServerTimeUtc);
        var receipt=Text("",14);box.AddView(receipt);
        var payment=Card();payment.AddView(Text("Thanh toán chuyển khoản",20,true));
        var selector=new Spinner(this);var labels=new[]{"Thanh toán toàn bộ","Đặt cọc 30%","Đặt cọc 50%"};selector.Adapter=new ArrayAdapter<string>(this,global::Android.Resource.Layout.SimpleSpinnerDropDownItem,labels);payment.AddView(selector);
        var amount=Text("",22,true);payment.AddView(amount);var image=Image(payment,270);var qrError=Text("",14);payment.AddView(qrError);
        var account=Text("",15,true);account.SetTextIsSelectable(true);payment.AddView(account);var percent=100;var qrGeneration=0;CancellationTokenSource? qrLifetime=null;decimal due=info.Balance.Due;string status=info.Status;bool awaiting=info.AwaitingPayment;
        bool CanPay()=>status!="Cancelled"&&due>0&&(!awaiting||clock.Remaining>TimeSpan.Zero);
        async Task DrawQr()
        {
            var render=++qrGeneration;qrLifetime?.Cancel();qrLifetime?.Dispose();qrLifetime=CancellationTokenSource.CreateLinkedTokenSource(ct);var qrToken=qrLifetime.Token;qrError.Text="";
            if(!CanPay()){image.Visibility=global::Android.Views.ViewStates.Gone;amount.Text=status=="Cancelled"?"Booking đã hủy":due<=0?"Đã thanh toán đủ":"Hết thời gian giữ chỗ";account.Text="";return;}
            if(!bank.BankConfigured){image.Visibility=global::Android.Views.ViewStates.Gone;amount.Text="Chuyển khoản chưa khả dụng";account.Text="Khách sạn chưa cấu hình tài khoản nhận tiền. Vui lòng liên hệ lễ tân.";return;}
            var value=PaymentRules.Deposit(due,percent);amount.Text=Presentation.Money(value);image.Visibility=global::Android.Views.ViewStates.Visible;
            account.Text=$"{bank.BankName}\nTài khoản nhận: {bank.AccountNumber}\nChủ tài khoản: {bank.AccountName}\nNội dung: ANNHIEN {id}";
            qrError.Text="Đang tải QR…";
            try{await LoadImage(image,PaymentRules.Qr(bank,id,value),qrToken);if(render==qrGeneration&&!qrToken.IsCancellationRequested)qrError.Text="Quét QR bằng ứng dụng ngân hàng. Chỉ server mới xác nhận đã nhận tiền.";}
            catch(OperationCanceledException){}
            catch(Exception e){if(render==qrGeneration&&!ct.IsCancellationRequested){image.Visibility=global::Android.Views.ViewStates.Gone;qrError.Text=e.Message;}}
        }
        selector.ItemSelected+=async(_,a)=>{percent=a.Position switch{1=>30,2=>50,_=>100};await Guard(DrawQr);};
        Button(payment,"Tải lại mã QR",DrawQr,true);
        Button(payment,"Sao chép nội dung chuyển khoản",()=>{var clipboard=(ClipboardManager)GetSystemService(ClipboardService)!;clipboard.PrimaryClip=ClipData.NewPlainText("Nội dung chuyển khoản","ANNHIEN "+id);Toast.MakeText(this,"Đã sao chép ANNHIEN "+id,ToastLength.Short)?.Show();return Task.CompletedTask;},true);
        var actions=Card();bool canCancel=info.CanCancelHold,canRequest=info.CanRequestCancellation,pending=info.HasPendingRequest;
        var cancel=Button(actions,"Hủy giữ chỗ",async()=>{if(await Confirm("Hủy booking #"+id,"Hủy giữ chỗ chưa thanh toán và mở lại phòng? Nếu vừa chuyển khoản, hãy kiểm tra tiền trước.")){await api.CancelHold(id,ct);await PaymentPage(id);}},true);cancel.Enabled=canCancel;
        var requestCancel=Button(actions,"Yêu cầu hủy / đổi lịch",()=>RequestPage(info),true);requestCancel.Enabled=canRequest&&!pending;
        var directId=Guid.NewGuid().ToString("D");
        var direct=Button(actions,"Chọn thanh toán tại khách sạn",async()=>{if(!await Confirm("Trả tại khách sạn","Lựa chọn này không xác nhận đã thu tiền và không gia hạn giữ chỗ 30 phút."))return;await api.ChoosePayAtHotel(id,directId,ct);Notice("Đã ghi nhận lựa chọn trả tại quầy. Tiền đã thu vẫn theo lịch sử thực tế.");},true);
        var history=Card();
        void DrawHistory(PublicBooking booking)
        {history.RemoveAllViews();history.AddView(Text("Lịch sử thanh toán",18,true));if(booking.Payments.Count==0)history.AddView(Text("Chưa có khoản thanh toán được ghi nhận."));foreach(var p in booking.Payments)history.AddView(Text($"{p.Type} · {p.Method} · {Presentation.Money(p.Amount)}\n{p.Reference}",14));}
        DrawHistory(info);
        async Task Refresh()
        {
            var s=await api.PaymentStatus(id,ct);if(version!=generation)return;
            var previousDue=due;due=s.Remaining;status=s.Status;awaiting=s.AwaitingPayment;clock.Synchronize(s.PaymentDueAtUtc,s.ServerTimeUtc);
            state.Text=Presentation.BookingStatus(status);balance.Text=$"Đã nhận {Presentation.Money(s.Paid)} · Còn {Presentation.Money(due)}";
            canCancel=s.CanCancelHold;canRequest=s.CanRequestCancellation;pending=s.HasPendingRequest;cancel.Enabled=canCancel;requestCancel.Enabled=canRequest&&!pending;direct.Enabled=CanPay();
            if(s.LatestPayment is { } p)receipt.Text=$"Khoản gần nhất: {Presentation.Money(p.Amount)} · {p.Method}\n{p.Reference}";
            if(s.Paid>info.Balance.Paid)Notice("Đã ghi nhận khoản thanh toán mới. Vui lòng kiểm tra số dư và lịch sử.");
            if(previousDue!=due){DrawHistory(await api.BookingInfo(id,ct));if(version!=generation)return;}
            if(!CanPay()||previousDue!=due)await DrawQr();
        }
        Button(actions,"Tôi đã chuyển — kiểm tra trạng thái",Refresh);Button(actions,"Về booking của tôi",()=>MyBookings(),true);
        await DrawQr();direct.Enabled=CanPay();await Support();
        _=Poll();
        async Task Poll()
        {
            int tick=0;
            try{while(!ct.IsCancellationRequested){await Task.Delay(1000,ct);if(!foreground)continue;countdown.Text=awaiting?"Còn "+clock.Text+" để thanh toán":info.PaymentDueAtUtc.HasValue?(due<=0||info.Balance.Paid>0?"Đã nhận tiền — booking được giữ":"Đã kết thúc giữ chỗ"):"Booking không có hạn tự hủy";
                if(awaiting&&clock.Remaining<=TimeSpan.Zero){cancel.Enabled=false;direct.Enabled=false;image.Visibility=global::Android.Views.ViewStates.Gone;amount.Text="Đã hết hạn. Đang kiểm tra trạng thái server…";}
                if(++tick%10==0)await Refresh();}}
            catch(OperationCanceledException){}
            catch(Exception e){if(!ct.IsCancellationRequested)Notice("Chưa tải được cập nhật: "+e.Message+" Bấm kiểm tra để thử lại.");}
        }
    }
    private Task RequestPage(PublicBooking info)
    {
        Page("Yêu cầu booking #"+info.Id,"bookings");var box=Card();box.AddView(Text("Lễ tân sẽ xem xét yêu cầu. Gửi yêu cầu không tự hủy booking hoặc hoàn tiền.",15));
        var selector=new Spinner(this){Adapter=new ArrayAdapter<string>(this,global::Android.Resource.Layout.SimpleSpinnerDropDownItem,new[]{"Hủy booking","Đổi ngày lưu trú"})};box.AddView(selector);
        var start=DateOnly.FromDateTime(info.CheckInDate);var end=DateOnly.FromDateTime(info.CheckOutDate);DateButton(box,"Ngày nhận mới",start,d=>start=d);DateButton(box,"Ngày trả mới",end,d=>end=d);
        var reason=Input(box,"Lý do yêu cầu",multiline:true);reason.SetFilters([new global::Android.Text.InputFilterLengthFilter(500)]);
        bool uncertain=false;
        Button(box,"Gửi yêu cầu",async()=>{if(uncertain)throw new ApiException("Hãy tải lại booking để kiểm tra yêu cầu trước đó.");if(string.IsNullOrWhiteSpace(reason.Text))throw new ApiException("Hãy nhập lý do.");var change=selector.SelectedItemPosition==1;if(change&&end<=start)throw new ApiException("Ngày trả phải sau ngày nhận.");
            try{await api.RequestChange(info.Id,new(change?"Change":"Cancel",reason.Text.Trim(),change?info.RoomId:null,change?start:null,change?end:null),screen.Token);await PaymentPage(info.Id);Notice("Đã gửi yêu cầu. Lễ tân sẽ phản hồi trong mục Thông báo.");}catch(ApiException e)when(e.OutcomeUncertain){uncertain=true;throw;}});
        Button(box,"Quay lại booking",()=>PaymentPage(info.Id),true);return Task.CompletedTask;
    }
}

using HotelManagement.Client;
namespace HotelManagement.WinForms;

internal sealed class NoteForm:Form
{
    private readonly TextBox input=new(){Multiline=true,Width=380,Height=120,MaxLength=500};
    public string Value=>input.Text.Trim();
    public NoteForm(string title,string label)
    {Text=title;ClientSize=new(450,260);StartPosition=FormStartPosition.CenterParent;Font=new("Segoe UI",10);var p=Ui.Stack();Controls.Add(p);p.Controls.Add(Ui.Label(label));p.Controls.Add(input);var ok=Ui.Button("Xác nhận");ok.Click+=(_,_)=>{DialogResult=DialogResult.OK;Close();};p.Controls.Add(ok);}
}
internal sealed class CustomerForm:Form
{
    public CustomerForm(HotelApiClient api)
    {
        Text="Thêm khách hàng";ClientSize=new(460,470);StartPosition=FormStartPosition.CenterParent;Font=new("Segoe UI",10);var p=Ui.Stack();Controls.Add(p);
        var name=Ui.Input();var phone=Ui.Input();var email=Ui.Input();var address=Ui.Input();
        foreach(var field in new[]{("Họ và tên",name),("Điện thoại",phone),("Email",email),("Địa chỉ",address)}){p.Controls.Add(Ui.Label(field.Item1));p.Controls.Add(field.Item2);}
        var save=Ui.Button("Thêm khách");p.Controls.Add(save);save.Click+=async(_,_)=>{save.Enabled=false;try{if(string.IsNullOrWhiteSpace(name.Text))throw new ApiException("Hãy nhập tên khách.");await api.AddCustomer(new(name.Text.Trim(),phone.Text.Trim(),string.IsNullOrWhiteSpace(email.Text)?null:email.Text.Trim(),address.Text.Trim()));if(!IsDisposed){DialogResult=DialogResult.OK;Close();}}catch(Exception e){if(!IsDisposed)Ui.Error(this,e);}finally{if(!save.IsDisposed)save.Enabled=true;}};
    }
}
internal sealed class CreateBookingForm:Form
{
    public CreateBookingForm(HotelApiClient api)
    {
        Text="Đặt phòng tại quầy";ClientSize=new(510,650);MinimumSize=new(470,620);StartPosition=FormStartPosition.CenterParent;Font=new("Segoe UI",10);
        var p=Ui.Stack();Controls.Add(p);p.Controls.Add(Ui.Label("Tạo booking",20,true));
        var customers=new ComboBox{Width=420,DropDownStyle=ComboBoxStyle.DropDownList,DisplayMember="FullName"};
        var rooms=new ComboBox{Width=420,DropDownStyle=ComboBoxStyle.DropDownList,DisplayMember="RoomNumber"};
        var start=new DateTimePicker{Width=205,Format=DateTimePickerFormat.Custom,CustomFormat="dd/MM/yyyy"};
        var end=new DateTimePicker{Width=205,Format=DateTimePickerFormat.Custom,CustomFormat="dd/MM/yyyy",Value=DateTime.Today.AddDays(1)};
        var guests=new NumericUpDown{Width=140,Minimum=1,Maximum=100,Value=1};var note=Ui.Input();note.MaxLength=500;
        p.Controls.Add(Ui.Label("Khách hàng"));p.Controls.Add(customers);p.Controls.Add(Ui.Label("Ngày nhận"));p.Controls.Add(start);p.Controls.Add(Ui.Label("Ngày trả"));p.Controls.Add(end);p.Controls.Add(Ui.Label("Số khách"));p.Controls.Add(guests);
        var find=Ui.Button("Tìm phòng trống");p.Controls.Add(find);p.Controls.Add(Ui.Label("Phòng khả dụng"));p.Controls.Add(rooms);p.Controls.Add(Ui.Label("Ghi chú"));p.Controls.Add(note);
        var quote=Ui.Label("Chọn ngày và tải phòng trống.");p.Controls.Add(quote);var save=Ui.Button("Tạo booking");save.Enabled=false;p.Controls.Add(save);
        DateOnly? searchedStart=null,searchedEnd=null;int searchedGuests=0;bool uncertain=false;
        void InvalidateSearch(){rooms.DataSource=null;save.Enabled=false;quote.Text="Ngày hoặc số khách thay đổi. Hãy tìm phòng lại.";}
        start.ValueChanged+=(_,_)=>InvalidateSearch();end.ValueChanged+=(_,_)=>InvalidateSearch();guests.ValueChanged+=(_,_)=>InvalidateSearch();
        rooms.SelectedIndexChanged+=(_,_)=>{if(rooms.SelectedItem is Room r)quote.Text=Presentation.Money(r.Price)+" / đêm · tối đa "+r.Capacity+" khách";};
        find.Click+=async(_,_)=>{find.Enabled=false;try{var s=DateOnly.FromDateTime(start.Value);var e=DateOnly.FromDateTime(end.Value);if(e<=s)throw new ApiException("Ngày trả phải sau ngày nhận.");var available=await api.Available(s,e,(int)guests.Value);if(IsDisposed)return;rooms.DataSource=available;searchedStart=s;searchedEnd=e;searchedGuests=(int)guests.Value;save.Enabled=available.Count>0&&!uncertain;if(available.Count==0)quote.Text="Không có phòng phù hợp.";}catch(Exception ex){if(!IsDisposed)Ui.Error(this,ex);}finally{if(!find.IsDisposed)find.Enabled=true;}};
        save.Click+=async(_,_)=>{save.Enabled=false;try{if(customers.SelectedItem is not Customer c||rooms.SelectedItem is not Room r||searchedStart is null||searchedEnd is null)throw new ApiException("Hãy chọn khách và tìm phòng trước.");if(!Ui.Confirm(this,$"Tạo booking cho {c.FullName}, phòng {r.RoomNumber}, {searchedStart:dd/MM/yyyy} – {searchedEnd:dd/MM/yyyy}?"))return;await api.CreateStaffBooking(new(c.Id,r.Id,searchedGuests,searchedStart.Value,searchedEnd.Value,note.Text.Trim()));if(!IsDisposed){DialogResult=DialogResult.OK;Close();}}catch(Exception e){if(e is ApiException{OutcomeUncertain:true})uncertain=true;if(!IsDisposed)Ui.Error(this,e);}finally{if(!save.IsDisposed)save.Enabled=!uncertain&&rooms.SelectedItem is Room;}};
        Shown+=async(_,_)=>{try{var cfg=await api.Configuration();var list=await api.Customers();if(IsDisposed)return;start.MinDate=cfg.Today.ToDateTime(TimeOnly.MinValue);start.Value=start.MinDate;end.MinDate=start.MinDate.AddDays(1);end.Value=end.MinDate;customers.DataSource=list;}catch(Exception e){if(!IsDisposed)Ui.Error(this,e);}};
    }
}
internal sealed class BookingDetailForm:Form
{
    public BookingDetailForm(HotelApiClient api,Booking booking)
    {
        Text="Booking #"+booking.Id;ClientSize=new(900,580);StartPosition=FormStartPosition.CenterParent;Font=new("Segoe UI",10);BackColor=Ui.Paper;
        var title=Ui.Label($"#{booking.Id} · Phòng {booking.RoomNumber} · {booking.CustomerName}",19,true);title.Dock=DockStyle.Top;title.Padding=new Padding(15);
        var summary=new Label{Dock=DockStyle.Top,Height=55,Padding=new Padding(20,10,20,8)};var grid=Ui.Grid();var bar=new FlowLayoutPanel{Dock=DockStyle.Bottom,Height=65,Padding=new Padding(15)};
        var pay=Ui.Button("Ghi nhận thu / hoàn tiền");bar.Controls.Add(pay);Controls.Add(grid);Controls.Add(summary);Controls.Add(title);Controls.Add(bar);
        async Task LoadPayments(){var data=await api.Payments(booking.Id);if(IsDisposed)return;summary.Text=$"{Presentation.BookingStatus(booking.Status)} · Tổng {Presentation.Money(data.Balance.Total)} · Đã thu {Presentation.Money(data.Balance.Paid)} · Còn thu {Presentation.Money(data.Balance.Due)} · Cần hoàn {Presentation.Money(data.Balance.RefundDue)}";grid.DataSource=data.Items.Select(x=>new{Mã=x.Id,Loại=x.Type,Phương_thức=x.Method,Số_tiền=Presentation.Money(x.Amount),Tham_chiếu=x.Reference,Người_ghi=x.RecordedBy}).ToList();}
        Shown+=async(_,_)=>{try{await LoadPayments();}catch(Exception e){if(!IsDisposed)Ui.Error(this,e);}};
        pay.Click+=async(_,_)=>{pay.Enabled=false;try{using var form=new PaymentForm(api,booking.Id);if(form.ShowDialog(this)==DialogResult.OK)await LoadPayments();}catch(Exception e){if(!IsDisposed)Ui.Error(this,e);}finally{if(!pay.IsDisposed)pay.Enabled=true;}};
    }
}
internal sealed class PaymentForm:Form
{
    public PaymentForm(HotelApiClient api,int bookingId)
    {
        Text="Ghi nhận thanh toán #"+bookingId;ClientSize=new(520,570);StartPosition=FormStartPosition.CenterParent;Font=new("Segoe UI",10);var p=Ui.Stack();Controls.Add(p);
        var caption=Ui.Label("Chỉ ghi nhận khoản tiền đã thực nhận/hoàn. Ứng dụng không tự chuyển tiền.");caption.MaximumSize=new(450,0);p.Controls.Add(caption);
        var type=new ComboBox{Width=400,DropDownStyle=ComboBoxStyle.DropDownList,DataSource=new[]{"Payment","Deposit","Refund"}};
        var method=new ComboBox{Width=400,DropDownStyle=ComboBoxStyle.DropDownList,DataSource=new[]{"Cash","Transfer"}};
        var amount=new NumericUpDown{Width=400,Minimum=0.01m,Maximum=1000000000000m,DecimalPlaces=2,ThousandsSeparator=true};
        var reference=Ui.Input();reference.Width=400;reference.MaxLength=200;
        var account=Ui.Input();account.Width=400;var bankId=Ui.Input();bankId.Width=400;
        foreach(var field in new (string,Control)[]{("Loại: Payment / Deposit / Refund",type),("Phương thức: Cash / Transfer",method),("Số tiền (đ)",amount),("Mã giao dịch ngân hàng / ghi chú",reference),("Ngân hàng chi hoàn (chỉ Refund Transfer)",bankId),("Tài khoản khách sạn đã chi hoàn",account)}){p.Controls.Add(Ui.Label(field.Item1));p.Controls.Add(field.Item2);}
        var save=Ui.Button("Ghi nhận khoản tiền");p.Controls.Add(save);BankConfiguration? bank=null;PaymentCreate? operation=null;
        Shown+=async(_,_)=>{try{var result=await api.Bank();var history=await api.Payments(bookingId);if(IsDisposed)return;bank=result;bankId.Text=result.BankId;account.Text=result.WebhookAccountNumber??result.AccountNumber;amount.Value=Math.Clamp(history.Balance.Due,amount.Minimum,amount.Maximum);}catch(Exception e){if(!IsDisposed)Ui.Error(this,e);}};
        save.Click+=async(_,_)=>
        {
            save.Enabled=false;try
            {
                if(operation is null)
                {
                    var transfer=method.Text=="Transfer";if(transfer&&string.IsNullOrWhiteSpace(reference.Text))throw new ApiException("Nhập mã giao dịch ngân hàng chính xác, không dùng nội dung chuyển khoản.");if(transfer&&bank?.BankConfigured!=true)throw new ApiException("Chưa tải được tài khoản ngân hàng nhận tiền.");
                    if(!Ui.Confirm(this,$"Ghi nhận {Presentation.Money(amount.Value)} · {method.Text} · {type.Text} cho #{bookingId}?"))return;
                    operation=new(Guid.NewGuid().ToString("D"),type.Text,method.Text,amount.Value,string.IsNullOrWhiteSpace(reference.Text)?null:reference.Text.Trim(),transfer?(type.Text=="Refund"?bankId.Text:bank!.BankId):null,transfer?(type.Text=="Refund"?account.Text:bank!.AccountNumber):null);
                    foreach(var control in new Control[]{type,method,amount,reference,account,bankId})control.Enabled=false;
                }
                await api.RecordPayment(bookingId,operation);if(!IsDisposed){DialogResult=DialogResult.OK;Close();}
            }
            catch(Exception e){if(!IsDisposed)Ui.Error(this,e);}
            finally{if(!save.IsDisposed){save.Enabled=true;save.Text=operation is null?"Ghi nhận khoản tiền":"Kiểm tra / thử lại cùng mã thao tác";}}
        };
    }
}

using HotelManagement.Client;
namespace HotelManagement.WinForms;

internal sealed class MainForm:Form
{
    private readonly HotelApiClient api;
    private readonly DataGridView grid=Ui.Grid();
    private readonly FlowLayoutPanel tools=new(){Dock=DockStyle.Top,Height=58,Padding=new Padding(12),WrapContents=false,AutoScroll=true};
    private readonly Label status=new(){Dock=DockStyle.Bottom,Height=38,Padding=new Padding(18,10,8,6),BackColor=Ui.Paper};
    private readonly TextBox search=new(){Width=190,PlaceholderText="Tìm khách / số điện thoại"};
    private readonly ComboBox filter=new(){Width=160,DropDownStyle=ComboBoxStyle.DropDownList};
    private string view="bookings";private int page=1,totalPages=1;private bool loading;private bool sessionLost;
    private List<Booking> bookings=[];private List<Room> rooms=[];private List<Customer> customers=[];private List<BookingRequest> requests=[];
    public bool ReturnToLogin{get;private set;}
    public MainForm(HotelApiClient api)
    {
        this.api=api;Text="An Nhiên • Nhân viên";ClientSize=new(1250,780);MinimumSize=new(1000,650);StartPosition=FormStartPosition.CenterScreen;Font=new("Segoe UI",10);BackColor=Ui.Paper;
        var header=new Panel{Dock=DockStyle.Top,Height=84,BackColor=Ui.Green};
        header.Controls.Add(new Label{Text="AN NHIÊN  /  LỄ TÂN",ForeColor=Color.White,Font=new("Segoe UI",21,FontStyle.Bold),AutoSize=true,Location=new(24,15)});
        header.Controls.Add(new Label{Text=$"{api.Session!.User!.FullName} · {api.Session.User.Role} · {api.BaseAddress.Host}",ForeColor=Color.Gainsboro,AutoSize=true,Location=new(28,54)});
        var nav=new FlowLayoutPanel{Dock=DockStyle.Left,Width=182,BackColor=Ui.Green,FlowDirection=FlowDirection.TopDown,Padding=new Padding(12,18,12,12)};
        foreach(var item in new[]{("Booking","bookings"),("Phòng","rooms"),("Khách hàng","customers"),("Yêu cầu đổi/hủy","requests")})
        {var button=Ui.Button(item.Item1);button.Width=150;button.Click+=async(_,_)=>{if(loading)return;view=item.Item2;page=1;search.Clear();await LoadData();};nav.Controls.Add(button);}
        nav.Controls.Add(Ui.Button("Đổi mật khẩu",()=>{using var f=new ChangePasswordForm(api);if(f.ShowDialog(this)==DialogResult.OK){ReturnToLogin=true;Close();}}));
        nav.Controls.Add(Ui.Button("Đăng xuất",()=>{api.SignOut();ReturnToLogin=true;Close();}));
        var body=new Panel{Dock=DockStyle.Fill,Padding=new Padding(14)};body.Controls.Add(grid);body.Controls.Add(tools);body.Controls.Add(status);
        Controls.Add(body);Controls.Add(nav);Controls.Add(header);
        api.SessionExpired+=OnSessionExpired;Shown+=async(_,_)=>await LoadData();FormClosed+=(_,_)=>api.SessionExpired-=OnSessionExpired;
    }
    private void OnSessionExpired(){sessionLost=true;if(IsHandleCreated)BeginInvoke((Action)(()=>{MessageBox.Show(this,"Phiên đã hết hạn hoặc tài khoản thay đổi. Vui lòng đăng nhập lại.");ReturnToLogin=true;Close();}));}
    private void ConfigureTools()
    {
        tools.Controls.Clear();tools.Controls.Add(search);var refresh=Ui.Button("Tải lại");refresh.Click+=async(_,_)=>{page=1;await LoadData();};tools.Controls.Add(refresh);
        var prev=Ui.Button("‹ Trước");prev.Enabled=page>1;prev.Click+=async(_,_)=>{page--;await LoadData();};tools.Controls.Add(prev);
        var next=Ui.Button("Sau ›");next.Enabled=page<totalPages;next.Click+=async(_,_)=>{page++;await LoadData();};tools.Controls.Add(next);
        if(view=="bookings")
        {
            tools.Controls.Add(Action("Tạo booking",CreateBooking));tools.Controls.Add(Action("Chi tiết / Thu tiền",ShowBooking));
            tools.Controls.Add(Action("Check-in",()=>BookingAction("check-in")));tools.Controls.Add(Action("Check-out",()=>BookingAction("check-out")));tools.Controls.Add(Action("Hủy",()=>BookingAction("cancel")));
        }
        if(view=="customers")tools.Controls.Add(Action("Thêm khách",AddCustomer));
        if(view=="requests"){tools.Controls.Add(Action("Chấp thuận",()=>Resolve(true)));tools.Controls.Add(Action("Từ chối",()=>Resolve(false)));}
    }
    private Button Action(string name,Func<Task> action)
    {var b=Ui.Button(name);b.Click+=async(_,_)=>{if(loading)return;b.Enabled=false;try{await action();}catch(Exception e){if(!sessionLost)Ui.Error(this,e);}finally{if(!b.IsDisposed)b.Enabled=true;}};return b;}
    private async Task LoadData()
    {
        if(loading||sessionLost)return;loading=true;tools.Enabled=false;status.Text="Đang tải dữ liệu…";
        try
        {
            if(view=="bookings") {var data=await api.Bookings(page,keyword:search.Text);bookings=data.Items;totalPages=data.TotalPages;grid.DataSource=bookings.Select(x=>new{Mã=x.Id,Khách=x.CustomerName,Phòng=x.RoomNumber,Nhận=Presentation.Date(x.CheckInDate),Trả=Presentation.Date(x.CheckOutDate),Trạng_thái=Presentation.BookingStatus(x.Status),Tổng=Presentation.Money(x.TotalAmount),Đã_thu=Presentation.Money(x.PaidAmount),Dư_nợ=Presentation.Money(x.Balance)}).ToList();}
            else if(view=="rooms"){var data=await api.Rooms(page,search.Text);rooms=data.Items;totalPages=data.TotalPages;grid.DataSource=rooms.Select(x=>new{Mã=x.Id,Phòng=x.RoomNumber,Hạng=x.RoomTypeName,Giá_đêm=Presentation.Money(x.Price),Sức_chứa=x.Capacity,Trạng_thái=Presentation.RoomStatus(x.Status)}).ToList();}
            else if(view=="customers"){customers=await api.Customers(search.Text);totalPages=1;grid.DataSource=customers.Select(x=>new{Mã=x.Id,Họ_tên=x.FullName,Điện_thoại=x.Phone,Email=x.Email,Địa_chỉ=x.Address}).ToList();}
            else {var data=await api.Requests(page);requests=data.Items;totalPages=data.TotalPages;grid.DataSource=requests.Select(x=>new{Mã=x.Id,Booking=x.BookingId,Khách=x.CustomerName,Loại=x.Type=="Cancel"?"Hủy":"Đổi phòng",Lý_do=x.Reason,Trạng_thái=x.Status}).ToList();}
            ConfigureTools();status.Text=$"Trang {page}/{Math.Max(1,totalPages)} · Dữ liệu từ server · {DateTime.Now:HH:mm:ss}";
        }
        catch(Exception e){if(!sessionLost){status.Text=e.Message;Ui.Error(this,e);ConfigureTools();}}
        finally{loading=false;if(!tools.IsDisposed)tools.Enabled=true;}
    }
    private int SelectedIndex()=>grid.CurrentRow?.Index is int index&&index>=0?index:throw new ApiException("Hãy chọn một dòng trước.");
    private async Task ShowBooking(){var b=bookings[SelectedIndex()];using var form=new BookingDetailForm(api,b);form.ShowDialog(this);await LoadData();}
    private async Task BookingAction(string action)
    {
        var b=bookings[SelectedIndex()];var title=action switch{"cancel"=>"Hủy booking", "check-in"=>"Nhận phòng",_=>"Trả phòng"};
        if(!Ui.Confirm(this,$"{title} #{b.Id} · phòng {b.RoomNumber}?"+(action=="cancel"&&b.PaidAmount>0?"\nBooking đã thu tiền. Hủy không tự chuyển tiền hoàn cho khách.":"")))return;
        await api.BookingAction(b.Id,action);await LoadData();
    }
    private async Task CreateBooking(){using var form=new CreateBookingForm(api);if(form.ShowDialog(this)==DialogResult.OK)await LoadData();}
    private async Task AddCustomer(){using var form=new CustomerForm(api);if(form.ShowDialog(this)==DialogResult.OK)await LoadData();}
    private async Task Resolve(bool approve)
    {
        var r=requests[SelectedIndex()];using var note=new NoteForm("Phản hồi yêu cầu #"+r.Id,"Ghi chú cho khách");if(note.ShowDialog(this)!=DialogResult.OK)return;
        if(!Ui.Confirm(this,$"{(approve?"Chấp thuận":"Từ chối")} yêu cầu {r.Type} booking #{r.BookingId}?"))return;
        await api.Resolve(r.Id,approve,note.Value);await LoadData();
    }
}

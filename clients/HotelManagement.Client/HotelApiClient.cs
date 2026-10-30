using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
namespace HotelManagement.Client;

public sealed class ApiException(string message,int status=0,bool uncertain=false):Exception(message)
{
    public int StatusCode {get;}=status;
    public bool OutcomeUncertain {get;}=uncertain;
}

public sealed class HotelApiClient:IDisposable
{
    public const string ProductionUrl="https://hotelmanagementapi-nw4d.onrender.com/";
    private readonly HttpClient http;
    private static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web);
    public Session? Session {get;private set;}
    public Uri BaseAddress=>http.BaseAddress!;
    public bool IsStaff=>Session?.User?.Role is "Admin" or "Receptionist";
    public bool IsCustomer=>Session?.Account is not null;
    public event Action? SessionExpired;
    public HotelApiClient(string url=ProductionUrl,HttpMessageHandler? handler=null,bool allowAndroidEmulatorHttp=false)
    {
        if(!Uri.TryCreate(url,UriKind.Absolute,out var uri)||!string.IsNullOrEmpty(uri.UserInfo)||!string.IsNullOrEmpty(uri.Query)||!string.IsNullOrEmpty(uri.Fragment)||uri.AbsolutePath!="/"||
            uri.Scheme!="https"&&!(uri.Scheme=="http"&&(uri.IsLoopback||allowAndroidEmulatorHttp&&uri.Host=="10.0.2.2")))throw new ArgumentException("Nhập địa chỉ gốc HTTPS của API (HTTP chỉ dùng trên localhost).");
        http=new HttpClient(handler??new HttpClientHandler{AllowAutoRedirect=false}){BaseAddress=uri,Timeout=TimeSpan.FromSeconds(35)};
    }
    public void SignOut(){Session=null;}
    public async Task<Session> Login(string username,string password,bool staff,CancellationToken ct=default)
    {
        SignOut();ValidatePassword(password);
        var result=await Send<Session>(HttpMethod.Post,staff?"/api/Auth/login":"/api/CustomerAuth/login",new Credentials(username.Trim(),password),false,ct);
        if(string.IsNullOrWhiteSpace(result.Token)||result.Expires<=DateTimeOffset.UtcNow||staff&&result.User?.Role is not ("Admin" or "Receptionist")||!staff&&result.Account is null)throw new ApiException("Tài khoản không đúng ứng dụng hoặc phiên đăng nhập không hợp lệ.");
        Session=result;return result;
    }
    public async Task Register(object request,CancellationToken ct=default)
    {Session=await Send<Session>(HttpMethod.Post,"/api/CustomerAuth/register",request,false,ct);}
    public static void ValidatePassword(string value){if(Encoding.UTF8.GetByteCount(value)>72)throw new ApiException("Mật khẩu tối đa 72 byte UTF-8.");}
    public Task<HotelConfiguration> Configuration(CancellationToken ct=default)=>Get<HotelConfiguration>("/api/HotelConfiguration",false,ct);
    public Task<GuestOptions> GuestOptions(CancellationToken ct=default)=>Get<GuestOptions>("/api/Bookings/guest-options",false,ct);
    public Task<List<Room>> Available(DateOnly start,DateOnly end,int guests,CancellationToken ct=default)=>Get<List<Room>>($"/api/Bookings/available-rooms?checkInDate={start:yyyy-MM-dd}&checkOutDate={end:yyyy-MM-dd}&guestCount={guests}",false,ct);
    public Task<Page<Room>> Rooms(int page,string keyword="",CancellationToken ct=default)=>Get<Page<Room>>($"/api/Rooms?pageNumber={page}&pageSize=30&keyword={Uri.EscapeDataString(keyword)}",true,ct);
    public Task<Page<Booking>> Bookings(int page,string status="",string keyword="",CancellationToken ct=default)=>Get<Page<Booking>>($"/api/Bookings?pageNumber={page}&pageSize=30&status={Uri.EscapeDataString(status)}&customerKeyword={Uri.EscapeDataString(keyword)}",true,ct);
    public Task<List<Customer>> Customers(string keyword="",CancellationToken ct=default)=>Get<List<Customer>>("/api/Customers?keyword="+Uri.EscapeDataString(keyword),true,ct);
    public Task<Customer> AddCustomer(CustomerSave request,CancellationToken ct=default)=>Send<Customer>(HttpMethod.Post,"/api/Customers",request,true,ct);
    public Task<Booking> CreateStaffBooking(StaffBookingCreate request,CancellationToken ct=default)=>Send<Booking>(HttpMethod.Post,"/api/Bookings",request,true,ct);
    public Task<CreatedBooking> CreateGuestBooking(GuestBookingCreate request,CancellationToken ct=default)=>Send<CreatedBooking>(HttpMethod.Post,"/api/Bookings/public",request,true,ct);
    public Task<Booking> BookingAction(int id,string action,CancellationToken ct=default)
    {if(action is not ("check-in" or "check-out" or "cancel"))throw new ArgumentException("Thao tác không hợp lệ.");return Send<Booking>(HttpMethod.Post,$"/api/Bookings/{id}/{action}",null,true,ct);}
    public Task<PaymentHistory> Payments(int id,CancellationToken ct=default)=>Get<PaymentHistory>($"/api/BookingOperations/{id}/payments",true,ct);
    public Task<Payment> RecordPayment(int id,PaymentCreate request,CancellationToken ct=default)=>Send<Payment>(HttpMethod.Post,$"/api/BookingOperations/{id}/payments",request,true,ct);
    public Task<Page<BookingRequest>> Requests(int page=1,CancellationToken ct=default)=>Get<Page<BookingRequest>>($"/api/BookingRequests?status=Pending&pageNumber={page}&pageSize=30",true,ct);
    public Task<BookingRequest> Resolve(int id,bool approve,string note,CancellationToken ct=default)=>Send<BookingRequest>(HttpMethod.Post,$"/api/BookingRequests/{id}/resolve",new{approve,note},true,ct);
    public Task<Page<PortalItem>> MyBookings(int page=1,string status="",CancellationToken ct=default)=>Get<Page<PortalItem>>($"/api/CustomerPortal/bookings?pageNumber={page}&pageSize=20&status={Uri.EscapeDataString(status)}",true,ct);
    public Task<PublicBooking> BookingInfo(int id,CancellationToken ct=default)=>Get<PublicBooking>($"/api/BookingOperations/{id}/public-info",true,ct);
    public Task<PaymentStatus> PaymentStatus(int id,CancellationToken ct=default)=>Get<PaymentStatus>($"/api/BookingOperations/{id}/payment-status",true,ct);
    public Task<BankConfiguration> Bank(CancellationToken ct=default)=>Get<BankConfiguration>("/api/BookingOperations/bank-config",false,ct);
    public Task<MessageResult> CancelHold(int id,CancellationToken ct=default)=>Send<MessageResult>(HttpMethod.Post,$"/api/BookingOperations/{id}/cancel-hold",null,true,ct);
    public Task ChoosePayAtHotel(int id,string requestId,CancellationToken ct=default)=>Send<object>(HttpMethod.Post,$"/api/BookingOperations/{id}/customer-payment",new{requestId,type="Direct",method="Cash",amount=0},true,ct);
    public Task<BookingRequest> RequestChange(int id,GuestRequest request,CancellationToken ct=default)=>Send<BookingRequest>(HttpMethod.Post,$"/api/BookingRequests/{id}",request,true,ct);
    public Task<NotificationFeed> Notifications(CancellationToken ct=default)=>Get<NotificationFeed>("/api/CustomerNotifications",true,ct);
    public Task ReadNotification(string id,CancellationToken ct=default)=>Send<object>(HttpMethod.Post,"/api/CustomerNotifications/read",new{keys=new[]{id}},true,ct);
    public Task<Contact> Contact(CancellationToken ct=default)=>Get<Contact>("/api/HotelContact",false,ct);
    public Task<MessageResult> ForgotPassword(string email,CancellationToken ct=default)=>Send<MessageResult>(HttpMethod.Post,"/api/CustomerAuth/forgot-password",new{email},false,ct);
    public async Task ChangeStaffPassword(string oldPassword,string newPassword,CancellationToken ct=default)
    {ValidatePassword(oldPassword);ValidatePassword(newPassword);await Send<MessageResult>(HttpMethod.Post,"/api/Auth/change-password",new{oldPassword,newPassword},true,ct);SignOut();}
    private Task<T> Get<T>(string path,bool auth,CancellationToken ct)=>Send<T>(HttpMethod.Get,path,null,auth,ct);
    private async Task<T> Send<T>(HttpMethod method,string path,object? body,bool auth,CancellationToken ct)
    {
        if(!path.StartsWith("/api/",StringComparison.Ordinal)||path.Contains('\\'))throw new ArgumentException("Invalid API path.");
        using var request=new HttpRequestMessage(method,path);
        if(auth){if(Session is null)throw new ApiException("Vui lòng đăng nhập.",401);if(Session.Expires<=DateTimeOffset.UtcNow){Expire();throw new ApiException("Phiên đã hết hạn. Vui lòng đăng nhập lại.",401);}request.Headers.Authorization=new AuthenticationHeaderValue("Bearer",Session.Token);}
        if(body is not null)request.Content=JsonContent.Create(body,options:Json);
        try
        {
            using var response=await http.SendAsync(request,ct);
            var text=await response.Content.ReadAsStringAsync(ct);
            if(!response.IsSuccessStatusCode)
            {
                if(response.StatusCode==HttpStatusCode.Unauthorized&&auth)Expire();
                var message=response.StatusCode switch{HttpStatusCode.Unauthorized=>"Phiên đăng nhập không hợp lệ hoặc tài khoản/mật khẩu chưa đúng.",HttpStatusCode.Forbidden=>"Bạn không có quyền thực hiện thao tác này.",HttpStatusCode.TooManyRequests=>"Bạn thao tác quá nhanh. Vui lòng chờ rồi thử lại.",_=>"Không thực hiện được yêu cầu. Vui lòng thử lại."};
                try{using var doc=JsonDocument.Parse(text);var r=doc.RootElement;if(r.TryGetProperty("message",out var m)&&m.ValueKind==JsonValueKind.String)message=m.GetString()!;else if(r.TryGetProperty("errors",out var errors)){var first=errors.EnumerateObject().SelectMany(x=>x.Value.EnumerateArray()).FirstOrDefault();if(first.ValueKind==JsonValueKind.String)message=first.GetString()!;}}catch(JsonException){}
                throw new ApiException(message,(int)response.StatusCode);
            }
            if(response.StatusCode==HttpStatusCode.NoContent||string.IsNullOrWhiteSpace(text))return default!;
            try{return JsonSerializer.Deserialize<T>(text,Json)??throw new ApiException("Dữ liệu phản hồi trống.");}catch(JsonException){throw new ApiException("Dữ liệu từ server không đúng định dạng.");}
        }
        catch(OperationCanceledException)when(!ct.IsCancellationRequested){throw new ApiException(method==HttpMethod.Get?"Server phản hồi chậm. Hãy thử tải lại.":"Chưa xác định kết quả do quá thời gian chờ. Hãy tải lại lịch sử trước khi gửi lại.",uncertain:method!=HttpMethod.Get);}
        catch(HttpRequestException){throw new ApiException(method==HttpMethod.Get?"Không kết nối được server. Kiểm tra mạng rồi tải lại.":"Mất kết nối: chưa xác định thao tác đã được lưu chưa. Kiểm tra lịch sử trước khi thử lại.",uncertain:method!=HttpMethod.Get);}
    }
    private void Expire(){Session=null;SessionExpired?.Invoke();}
    public void Dispose(){SignOut();http.Dispose();}
}

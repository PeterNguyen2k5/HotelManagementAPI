using System.Net;
using System.Text;
using System.Text.Json;
using HotelManagement.Client;

int checks=0;
void Check(bool condition,string reason){if(!condition)throw new Exception(reason);checks++;}
async Task Error(Func<Task> action,int status){try{await action();throw new Exception("Expected API error "+status);}catch(ApiException e){Check(e.StatusCode==status,e.Message);}}
Check(PaymentRules.Deposit(20000,30)==20000,"Deposit must not exceed remaining balance");
Check(PaymentRules.Deposit(10000,50)==10000,"Small booking deposit cap");
Check(PaymentRules.Deposit(0,30)==0,"Settled booking cannot request a deposit");
Check(PaymentRules.Deposit(-5,30)==0,"No payment on a refund balance");
Check(PaymentRules.Deposit(500000,30)==150000,"30% amount");
Check(PaymentRules.Deposit(500000,50)==250000,"50% amount");
Check(Presentation.Money(10000).Contains("10.000"),"Vietnamese currency");
Check(Presentation.Money(0.01m).Contains("0,01"),"Money precision");
var bank=new BankConfiguration(true,"BIDV","Fixture bank","FIXTUREVA001","FIXTURE ONLY",null,true,"00000000001");
var qr=PaymentRules.Qr(bank,24,10000).ToString();Check(qr.Contains("BIDV-FIXTUREVA001")&&!qr.Contains(bank.WebhookAccountNumber!),"QR must use VA, never settlement account");
Check(qr.Contains("amount=10000")&&Uri.UnescapeDataString(qr).Contains("ANNHIEN 24"),"QR amount and booking");
var clock=new HoldClock();clock.Synchronize(DateTimeOffset.UtcNow.AddSeconds(2),DateTimeOffset.UtcNow);await Task.Delay(50);Check(clock.Remaining.TotalSeconds<2&&clock.Remaining.TotalSeconds>0,"Monotonic server deadline");
clock.Synchronize(DateTimeOffset.UtcNow.AddMinutes(-1),DateTimeOffset.UtcNow);Check(clock.Remaining==TimeSpan.Zero,"Expired hold remains zero");
try{HotelApiClient.ValidatePassword(new string('é',37));throw new Exception("Password should fail UTF8 limit");}catch(ApiException){checks++;}
foreach(var url in new[]{"http://example.com/","https://user:password@example.com/","https://example.com/?key=x","https://example.com/path/","javascript:alert(1)"}){try{using var c=new HotelApiClient(url);throw new Exception("Unsafe URL accepted");}catch(ArgumentException){checks++;}}
var fake=new Fake();using(var c=new HotelApiClient("https://fixture.test/",fake))
{
 await c.Login("staff","fixture",true);Check(fake.Requests[0].Auth is null,"Login must not send a previous bearer token");
 await c.Rooms(1);Check(fake.Requests[^1].Auth=="Bearer fixture-token","Authenticated endpoint sends JWT");
 await c.Configuration();Check(fake.Requests[^1].Auth is null,"Public endpoint must not send JWT");
 fake.Reject=true;int expired=0;c.SessionExpired+=()=>expired++;await Error(()=>c.Rooms(1),401);Check(c.Session is null&&expired==1,"401 clears native client session");
}
Console.WriteLine($"PASS: {checks} native client transport/payment/security checks.");

if(args.Length>0)
{
    var baseUrl=args[0];if(!Uri.TryCreate(baseUrl,UriKind.Absolute,out var local)||!local.IsLoopback)throw new Exception("Integration checks accept localhost fixture only");
    using var admin=new HotelApiClient(baseUrl);await admin.Login("admin",Environment.GetEnvironmentVariable("HOTEL_FIXTURE_ADMIN_PASSWORD")??throw new Exception("Fixture password missing"),true);
    using var guest=new HotelApiClient(baseUrl);await guest.Register(new{username="nativeguest",password="Native-fixture-123!",fullName="Native guest fixture",phone="0901234567",email="native@example.test"});
    await guest.Login("nativeguest","Native-fixture-123!",false);Check(guest.IsCustomer&&!guest.IsStaff,"Customer role");
    var hotel=await admin.Configuration();var options=await guest.GuestOptions();Check(options.MaxGuests>=2,"Capacity metadata");
    var rooms=await guest.Available(hotel.Today,hotel.Today.AddDays(1),1);Check(rooms.Count>=3,"Temporary fixture rooms");
    var customer=await admin.AddCustomer(new("Native staff customer","0901234568",null,null));
    var staffBooking=await admin.CreateStaffBooking(new(customer.Id,rooms[0].Id,1,hotel.Today,hotel.Today.AddDays(1),"Disposable native client checks"));
    var cash=new PaymentCreate(Guid.NewGuid().ToString("D"),"Payment","Cash",staffBooking.TotalAmount,"Fixture cash");var paid=await admin.RecordPayment(staffBooking.Id,cash);Check((await admin.RecordPayment(staffBooking.Id,cash)).Id==paid.Id,"Payment operation UUID retry");
    Check((await admin.Payments(staffBooking.Id)).Balance.Due==0,"Payment DTO mapping");
    Check((await admin.BookingAction(staffBooking.Id,"check-in")).Status=="CheckedIn","Staff check-in");Check((await admin.BookingAction(staffBooking.Id,"check-out")).Status=="CheckedOut","Staff check-out");
    var reserved=await guest.CreateGuestBooking(new(rooms[1].Id,1,hotel.Today.AddDays(1),hotel.Today.AddDays(2),"Native guest fixture","0901234567","native@example.test","Disposable native checks"));
    Check(reserved.PaymentDueAtUtc.HasValue,"Server hold deadline");Check((await guest.BookingInfo(reserved.Id)).RoomId==rooms[1].Id,"Booking details DTO");
    Check((await guest.PaymentStatus(reserved.Id)).Remaining==reserved.TotalAmount,"Payment status mapping");
    await guest.ChoosePayAtHotel(reserved.Id,Guid.NewGuid().ToString("D"));Check((await guest.PaymentStatus(reserved.Id)).Paid==0,"Pay at hotel is not a receipt");
    await guest.CancelHold(reserved.Id);Check((await guest.BookingInfo(reserved.Id)).Status=="Cancelled","Customer cancellation");
    var second=await guest.CreateGuestBooking(new(rooms[2].Id,1,hotel.Today.AddDays(1),hotel.Today.AddDays(2),"Native guest fixture","0901234567",null,"Fixture request"));
    var request=await guest.RequestChange(second.Id,new("Cancel","Fixture changed plans"));Check((await admin.Requests()).Items.Any(r=>r.Id==request.Id),"Staff pending requests");
    await admin.Resolve(request.Id,false,"Fixture rejection");var notices=await guest.Notifications();Check(notices.Items.Any(n=>n.Kind=="request"&&n.BookingId==second.Id),"Request result notifications");
    var first=notices.Items.First();await guest.ReadNotification(first.Id);Check((await guest.Notifications()).Items.First(n=>n.Id==first.Id).IsRead,"Read receipt persists");
    await Error(()=>guest.Payments(staffBooking.Id),403);await Error(()=>guest.BookingInfo(staffBooking.Id),404);await Error(()=>guest.Available(hotel.Today.AddDays(-1),hotel.Today,1),400);
    Check((await admin.Bookings(1)).TotalCount>=3,"Staff pagination");Check((await guest.MyBookings()).Items.Count>=2,"Customer portal pagination");Check((await admin.Customers()).Any(c=>c.Id==customer.Id),"Customer search");
    Console.WriteLine($"PASS: {checks} total checks including native client calls against a disposable real ASP.NET Core server.");
}

sealed class Fake:HttpMessageHandler
{
    public readonly List<(string Path,string? Auth)> Requests=[];public bool Reject;
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken ct)
    {
        var path=request.RequestUri!.AbsolutePath;Requests.Add((path,request.Headers.Authorization?.ToString()));
        object body;var status=HttpStatusCode.OK;
        if(path=="/api/Auth/login")body=new{token="fixture-token",expires=DateTimeOffset.UtcNow.AddHours(1),user=new{id=1,username="staff",fullName="Fixture",role="Receptionist",mustChangePassword=false}};
        else if(Reject){status=HttpStatusCode.Unauthorized;body=new{message="Fixture revoked session"};}
        else if(path=="/api/Rooms")body=new{totalCount=0,pageNumber=1,pageSize=30,totalPages=0,items=Array.Empty<Room>()};
        else body=new{timeZone="Asia/Ho_Chi_Minh",today="2026-10-30"};
        return Task.FromResult(new HttpResponseMessage(status){Content=new StringContent(JsonSerializer.Serialize(body),Encoding.UTF8,"application/json")});
    }
}

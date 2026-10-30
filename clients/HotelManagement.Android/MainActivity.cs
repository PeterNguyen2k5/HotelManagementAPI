using Android.App;
using Android.Content;
using Android.Graphics;
using Android.Graphics.Drawables;
using Android.OS;
using Android.Text;
using Android.Views;
using Android.Widget;
using HotelManagement.Client;
using AColor=Android.Graphics.Color;
using AButton=Android.Widget.Button;
using AUri=Android.Net.Uri;
namespace HotelManagement.Android;

[Activity(Label="An Nhiên",MainLauncher=true,Exported=true,Theme="@style/HotelTheme",ConfigurationChanges=global::Android.Content.PM.ConfigChanges.Orientation|global::Android.Content.PM.ConfigChanges.ScreenSize)]
public sealed partial class MainActivity:Activity
{
    private HotelApiClient api=null!;
    private LinearLayout content=null!;
    private TextView message=null!;
    private CancellationTokenSource screen=new();
    private int generation;private bool foreground;private Room? pendingRoom;
    private DateOnly checkIn,checkOut;private int guests=2;private int maxGuests=2;
    private static readonly AColor Green=AColor.Rgb(20,57,47),Gold=AColor.Rgb(178,132,54),Paper=AColor.Rgb(245,246,242),Ink=AColor.Rgb(35,49,46);
    private static readonly HttpClient images=new(){Timeout=TimeSpan.FromSeconds(20)};
    protected override void OnCreate(Bundle? state)
    {
        base.OnCreate(state);
        var url=HotelApiClient.ProductionUrl;
#if DEBUG
        url=Intent?.GetStringExtra("api_url")??url;
        api=new HotelApiClient(url,allowAndroidEmulatorHttp:true);
#else
        api=new HotelApiClient(url);
#endif
        api.SessionExpired+=Expired;_=Guard(SearchPage);
    }
    protected override void OnResume(){base.OnResume();foreground=true;}
    protected override void OnPause(){foreground=false;base.OnPause();}
    protected override void OnDestroy(){screen.Cancel();screen.Dispose();api.SessionExpired-=Expired;api.Dispose();base.OnDestroy();}
    private void Expired()=>RunOnUiThread(()=>{Toast.MakeText(this,"Phiên hết hạn. Vui lòng đăng nhập lại.",ToastLength.Long)?.Show();LoginPage();});
    private int Dp(float value)=>(int)(value*(Resources?.DisplayMetrics?.Density??1));
    private void Page(string title,string tab)
    {
        screen.Cancel();screen.Dispose();screen=new();generation++;
        var root=new LinearLayout(this){Orientation=Orientation.Vertical};root.SetBackgroundColor(Paper);root.SetOnApplyWindowInsetsListener(new Insets());
        var header=new LinearLayout(this){Orientation=Orientation.Vertical};header.SetPadding(Dp(20),Dp(16),Dp(20),Dp(14));header.SetBackgroundColor(Green);
        var brand=Text("AN NHIÊN  ·  HOTEL & RESORT",12,true);brand.SetTextColor(Gold);header.AddView(brand);var heading=Text(title,25,true);heading.SetTextColor(AColor.White);header.AddView(heading);root.AddView(header);
        message=Text("",13);message.Visibility=ViewStates.Gone;message.SetPadding(Dp(18),Dp(8),Dp(18),Dp(8));root.AddView(message);
        var scroll=new ScrollView(this){FillViewport=true};content=new LinearLayout(this){Orientation=Orientation.Vertical};content.SetPadding(Dp(16),Dp(12),Dp(16),Dp(22));scroll.AddView(content);root.AddView(scroll,new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MatchParent,0,1));
        var nav=new LinearLayout(this){Orientation=Orientation.Horizontal};nav.SetBackgroundColor(AColor.White);
        foreach(var item in new[]{("Phòng","rooms"),("Booking","bookings"),("Thông báo","notifications"),("Tài khoản","account")})
        {
            var b=new AButton(this){Text=item.Item1,TextSize=11};b.SetAllCaps(false);b.SetTextColor(item.Item2==tab?Gold:Green);b.SetBackgroundColor(AColor.White);
            b.Click+=async(_,_)=>await Guard(item.Item2 switch{"rooms"=>SearchPage,"bookings"=>()=>MyBookings(),"notifications"=>NotificationsPage,_=>AccountPage});nav.AddView(b,new LinearLayout.LayoutParams(0,Dp(56),1));
        }
        root.AddView(nav);SetContentView(root);
    }
    private sealed class Insets:Java.Lang.Object,View.IOnApplyWindowInsetsListener
    {
        public WindowInsets OnApplyWindowInsets(View? v,WindowInsets? insets)
        {
            if(insets is null)return null!;
            if(OperatingSystem.IsAndroidVersionAtLeast(30)){var bars=insets.GetInsets(WindowInsets.Type.SystemBars());v?.SetPadding(bars.Left,bars.Top,bars.Right,bars.Bottom);}
#pragma warning disable CS0618 // Android 8–10 compatibility, before GetInsets existed.
            else v?.SetPadding(insets.SystemWindowInsetLeft,insets.SystemWindowInsetTop,insets.SystemWindowInsetRight,insets.SystemWindowInsetBottom);
#pragma warning restore CS0618
            return insets;
        }
    }
    private TextView Text(string text,int size=15,bool bold=false)
    {var t=new TextView(this){Text=text,TextSize=size};t.SetTextColor(Ink);t.SetPadding(0,Dp(3),0,Dp(5));if(bold)t.SetTypeface(null,TypefaceStyle.Bold);return t;}
    private LinearLayout Card()
    {
        var box=new LinearLayout(this){Orientation=Orientation.Vertical};box.SetPadding(Dp(17),Dp(13),Dp(17),Dp(13));
        var background=new GradientDrawable();background.SetColor(AColor.White);background.SetCornerRadius(Dp(14));background.SetStroke(Dp(1),AColor.Rgb(222,231,224));box.Background=background;
        content.AddView(box,new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MatchParent,ViewGroup.LayoutParams.WrapContent){BottomMargin=Dp(13)});return box;
    }
    private EditText Input(LinearLayout host,string label,bool password=false,bool multiline=false,string value="")
    {
        host.AddView(Text(label,13,true));var input=new EditText(this){Text=value,TextSize=15,InputType=password?InputTypes.ClassText|InputTypes.TextVariationPassword:multiline?InputTypes.ClassText|InputTypes.TextFlagMultiLine:InputTypes.ClassText};
        if(!multiline)input.SetSingleLine(true);host.AddView(input,new LinearLayout.LayoutParams(-1,-2){BottomMargin=Dp(9)});return input;
    }
    private AButton Button(LinearLayout host,string text,Func<Task> action,bool secondary=false)
    {
        var button=new AButton(this){Text=text,TextSize=14};button.SetAllCaps(false);button.SetTextColor(secondary?Green:AColor.White);button.BackgroundTintList=global::Android.Content.Res.ColorStateList.ValueOf(secondary?AColor.Rgb(232,239,232):Green);
        button.Click+=async(_,_)=>{button.Enabled=false;await Guard(action);if(button.Handle!=IntPtr.Zero)button.Enabled=true;};host.AddView(button,new LinearLayout.LayoutParams(-1,Dp(50)){TopMargin=Dp(5)});return button;
    }
    private async Task Guard(Func<Task> action)
    {try{await action();}catch(OperationCanceledException){}catch(Exception ex){if(!IsFinishing&&!IsDestroyed){message.Text=ex.Message;message.Visibility=ViewStates.Visible;message.SetTextColor(AColor.Rgb(155,48,28));}}}
    private Task<bool> Confirm(string title,string text)
    {var result=new TaskCompletionSource<bool>();new AlertDialog.Builder(this)!.SetTitle(title)!.SetMessage(text)!.SetPositiveButton("Xác nhận",(_,_)=>result.TrySetResult(true))!.SetNegativeButton("Quay lại",(_,_)=>result.TrySetResult(false))!.SetOnCancelListener(new CancelDialog(()=>result.TrySetResult(false)))!.Show();return result.Task;}
    private sealed class CancelDialog(Action action):Java.Lang.Object,IDialogInterfaceOnCancelListener{public void OnCancel(IDialogInterface? dialog)=>action();}
    private bool SignedIn(){if(api.IsCustomer)return true;LoginPage();return false;}
    private void Notice(string text){message.Text=text;message.Visibility=ViewStates.Visible;message.SetTextColor(Green);}
    private async Task LoadImage(ImageView image,Uri url,CancellationToken ct)
    {
        try
        {
            using var response=await images.GetAsync(url,HttpCompletionOption.ResponseHeadersRead,ct);response.EnsureSuccessStatusCode();
            if(response.Content.Headers.ContentLength>6*1024*1024)throw new IOException("Ảnh quá lớn.");
            using var data=new MemoryStream();await using var source=await response.Content.ReadAsStreamAsync(ct);var buffer=new byte[16384];int count;
            while((count=await source.ReadAsync(buffer,ct))>0){if(data.Length+count>6*1024*1024)throw new IOException("Ảnh quá lớn.");data.Write(buffer,0,count);}
            var bytes=data.ToArray();var bounds=new BitmapFactory.Options{InJustDecodeBounds=true};await BitmapFactory.DecodeByteArrayAsync(bytes,0,bytes.Length,bounds);
            var sample=1;while(bounds.OutWidth/sample>1400||bounds.OutHeight/sample>1400)sample*=2;
            var bitmap=await BitmapFactory.DecodeByteArrayAsync(bytes,0,bytes.Length,new BitmapFactory.Options{InSampleSize=sample});if(ct.IsCancellationRequested)return;
            if(bitmap is null)throw new IOException("Ảnh không hợp lệ.");image.SetImageBitmap(bitmap);image.ContentDescription="Ảnh đã tải";
        }
        catch(OperationCanceledException){}
        catch{if(!ct.IsCancellationRequested){image.ContentDescription="Không tải được ảnh";throw new ApiException("Không tải được ảnh/QR. Vui lòng thử lại, hoặc dùng thông tin chuyển khoản bên dưới.");}}
    }
    private ImageView Image(LinearLayout host,int height)
    {var image=new ImageView(this);image.SetScaleType(ImageView.ScaleType.FitCenter);host.AddView(image,new LinearLayout.LayoutParams(-1,Dp(height)));return image;}
    private AButton DateButton(LinearLayout host,string label,DateOnly initial,Action<DateOnly> changed)
    {
        var selected=initial;AButton? button=null;button=Button(host,$"{label}: {selected:dd/MM/yyyy}",()=>{new DatePickerDialog(this,(_,a)=>{selected=DateOnly.FromDateTime(a.Date);button!.Text=$"{label}: {selected:dd/MM/yyyy}";changed(selected);},selected.Year,selected.Month-1,selected.Day).Show();return Task.CompletedTask;},true);return button;
    }
    private void LoginPage()
    {
        Page("Chào mừng trở lại","account");var box=Card();box.AddView(Text("Đăng nhập để giữ phòng, thanh toán và theo dõi kỳ nghỉ.",16));
        var user=Input(box,"Tên đăng nhập");var password=Input(box,"Mật khẩu",true);
        Button(box,"Đăng nhập",async()=>{await api.Login(user.Text??"",password.Text??"",false,screen.Token);password.Text="";var target=pendingRoom;pendingRoom=null;if(target is not null)await ReservePage(target);else await MyBookings();});
        Button(box,"Tạo tài khoản",()=>{RegisterPage();return Task.CompletedTask;},true);Button(box,"Quên mật khẩu",()=>{ForgotPage();return Task.CompletedTask;},true);
        box.AddView(Text("API: "+api.BaseAddress.Host,12));
    }
    private void RegisterPage()
    {
        Page("Tạo tài khoản","account");var box=Card();var full=Input(box,"Họ và tên");var phone=Input(box,"Số điện thoại");var email=Input(box,"Email");email.InputType=InputTypes.ClassText|InputTypes.TextVariationEmailAddress;var user=Input(box,"Tên đăng nhập");var password=Input(box,"Mật khẩu (8 ký tự trở lên)",true);
        Button(box,"Đăng ký",async()=>{HotelApiClient.ValidatePassword(password.Text??"");await api.Register(new{username=user.Text?.Trim(),password=password.Text,fullName=full.Text?.Trim(),phone=phone.Text?.Trim(),email=email.Text?.Trim()},screen.Token);password.Text="";await MyBookings();});
        Button(box,"Đã có tài khoản? Đăng nhập",()=>{LoginPage();return Task.CompletedTask;},true);
    }
    private void ForgotPage()
    {Page("Khôi phục mật khẩu","account");var box=Card();var email=Input(box,"Email đã đăng ký");Button(box,"Gửi liên kết khôi phục",async()=>{var r=await api.ForgotPassword(email.Text?.Trim()??"",screen.Token);Notice(r.Message);});Button(box,"Về đăng nhập",()=>{LoginPage();return Task.CompletedTask;},true);}
    private async Task AccountPage()
    {
        if(!SignedIn())return;Page("Tài khoản của tôi","account");var profile=api.Session!.Account!;var box=Card();box.AddView(Text(profile.FullName,22,true));box.AddView(Text(profile.Username));box.AddView(Text(profile.Email));box.AddView(Text(profile.Phone));
        Button(box,"Đặt phòng của tôi",()=>MyBookings());Button(box,"Đăng xuất",()=>{api.SignOut();pendingRoom=null;LoginPage();return Task.CompletedTask;},true);await Support();
    }
    private async Task Support()
    {
        var version=generation;var contact=await api.Contact(screen.Token);if(version!=generation)return;var box=Card();box.AddView(Text("Hỗ trợ từ lễ tân",18,true));
        if(!string.IsNullOrWhiteSpace(contact.PhoneUrl))Button(box,"Gọi: "+contact.Phone,()=>{StartActivity(new Intent(Intent.ActionDial,AUri.Parse(contact.PhoneUrl)));return Task.CompletedTask;},true);
        if(!string.IsNullOrWhiteSpace(contact.EmailUrl))Button(box,"Email: "+contact.Email,()=>{StartActivity(new Intent(Intent.ActionSendto,AUri.Parse(contact.EmailUrl)));return Task.CompletedTask;},true);
    }
}

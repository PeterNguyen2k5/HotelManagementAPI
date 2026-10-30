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

[Activity(Label="An Nhiên",MainLauncher=true,Exported=true,Theme="@style/HotelTheme",ScreenOrientation=global::Android.Content.PM.ScreenOrientation.SensorPortrait,ConfigurationChanges=global::Android.Content.PM.ConfigChanges.Orientation|global::Android.Content.PM.ConfigChanges.ScreenSize)]
public sealed partial class MainActivity:Activity
{
    private HotelApiClient api=null!;
    private LinearLayout content=null!;
    private TextView message=null!;
    private CancellationTokenSource screen=new();
    private int generation;private bool foreground;private Room? pendingRoom;
    private DateOnly checkIn,checkOut;private int guests=2;private int maxGuests=2;
    private static readonly AColor Green=AColor.Rgb(18,55,45),Gold=AColor.Rgb(178,132,54),Paper=AColor.Rgb(247,245,239),Ink=AColor.Rgb(35,49,46),Muted=AColor.Rgb(112,128,120),Line=AColor.Rgb(225,230,222);
    private static readonly HttpClient images=new(){Timeout=TimeSpan.FromSeconds(20)};
    protected override void OnCreate(Bundle? state)
    {
        base.OnCreate(state);
        Window?.SetSoftInputMode(SoftInput.AdjustResize);
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
        var outer=new FrameLayout(this);outer.SetBackgroundColor(Paper);outer.SetOnApplyWindowInsetsListener(new Insets());
        var root=new LinearLayout(this){Orientation=Orientation.Vertical};root.SetBackgroundColor(Paper);
        var width=Math.Min(Resources?.DisplayMetrics?.WidthPixels??Dp(420),Dp(480));
        outer.AddView(root,new FrameLayout.LayoutParams(width,-1,GravityFlags.CenterHorizontal));
        root.AddView(BrandHeader());
        message=Text("",13);message.Visibility=ViewStates.Gone;message.SetPadding(Dp(20),Dp(10),Dp(20),Dp(10));root.AddView(message);
        var scroll=new ScrollView(this){FillViewport=true,VerticalScrollBarEnabled=false};
        content=new LinearLayout(this){Orientation=Orientation.Vertical};content.SetPadding(Dp(20),Dp(4),Dp(20),Dp(24));
        if(tab!="rooms"||title!="Kỳ nghỉ dành cho bạn")content.AddView(Heading(title,28));
        scroll.AddView(content);root.AddView(scroll,new LinearLayout.LayoutParams(-1,0,1));
        root.AddView(BottomNavigation(tab));SetContentView(outer);
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
    {var t=new TextView(this){Text=text,TextSize=size};t.SetTextColor(Ink);t.SetPadding(0,Dp(3),0,Dp(5));t.SetLineSpacing(Dp(2),1.05f);if(bold)t.SetTypeface(Typeface.Create("sans-serif-medium",TypefaceStyle.Normal),TypefaceStyle.Normal);return t;}
    private LinearLayout Card()
    {
        var box=new LinearLayout(this){Orientation=Orientation.Vertical};box.SetPadding(Dp(18),Dp(16),Dp(18),Dp(18));box.Background=Surface(AColor.White,20,Line);
        content.AddView(box,new LinearLayout.LayoutParams(-1,-2){BottomMargin=Dp(16),TopMargin=Dp(4)});return box;
    }
    private EditText Input(LinearLayout host,string label,bool password=false,bool multiline=false,string value="")
    {
        host.AddView(Text(label,12,true));
        var row=new LinearLayout(this){Orientation=Orientation.Horizontal};row.SetGravity(GravityFlags.CenterVertical);row.Background=Surface(AColor.Rgb(250,251,248),12,Line);row.SetPadding(Dp(12),0,Dp(4),0);
        var input=new EditText(this){Text=value,TextSize=15,InputType=multiline?InputTypes.ClassText|InputTypes.TextFlagMultiLine:InputTypes.ClassText};
        input.SetTextColor(Ink);input.SetHintTextColor(Muted);input.SetPadding(0,Dp(12),Dp(6),Dp(12));input.Background=null;input.Hint=password?"Nhập mật khẩu":"Nhập "+label.ToLowerInvariant();
        if(!multiline)input.SetSingleLine(true);else{input.SetMinLines(3);input.Gravity=GravityFlags.Top;}
        input.SetTypeface(Typeface.Create("sans-serif",TypefaceStyle.Normal),TypefaceStyle.Normal);
        // SetSingleLine installs its own transformation. Apply masking AFTER it.
        if(password){input.InputType=InputTypes.ClassText|InputTypes.TextVariationPassword;input.TransformationMethod=global::Android.Text.Method.PasswordTransformationMethod.Instance;input.ImeOptions=(global::Android.Views.InputMethods.ImeAction)((int)global::Android.Views.InputMethods.ImeAction.Done|(int)global::Android.Views.InputMethods.ImeFlags.NoExtractUi);input.SaveEnabled=false;}
        row.AddView(input,new LinearLayout.LayoutParams(0,-2,1));
        if(password){var shown=false;var toggle=new AButton(this){Text="Hiện",TextSize=12,ContentDescription="Hiện mật khẩu"};toggle.SetAllCaps(false);toggle.SetTextColor(Green);toggle.Background=Surface(AColor.Transparent,10);toggle.SetPadding(0,0,0,0);toggle.SetMinWidth(0);toggle.SetMinimumWidth(0);toggle.Click+=(_,_)=>{shown=!shown;input.TransformationMethod=shown?null:global::Android.Text.Method.PasswordTransformationMethod.Instance;toggle.Text=shown?"Ẩn":"Hiện";toggle.ContentDescription=shown?"Ẩn mật khẩu":"Hiện mật khẩu";input.SetSelection(input.Text?.Length??0);};row.AddView(toggle,new LinearLayout.LayoutParams(Dp(48),Dp(48)));}
        host.AddView(row,new LinearLayout.LayoutParams(-1,-2){BottomMargin=Dp(14)});return input;
    }
    private AButton Button(LinearLayout host,string text,Func<Task> action,bool secondary=false)
    {
        var button=new AButton(this){Text=text,TextSize=14};button.SetAllCaps(false);button.SetTextColor(secondary?Green:AColor.White);button.Background=Surface(secondary?AColor.White:Green,12,secondary?Line:null);button.Elevation=0;button.StateListAnimator=null;button.SetPadding(Dp(10),0,Dp(10),0);
        button.Click+=async(_,_)=>{button.Enabled=false;button.Alpha=.65f;await Guard(action);if(button.Handle!=IntPtr.Zero){button.Enabled=true;button.Alpha=1;}};host.AddView(button,new LinearLayout.LayoutParams(-1,Dp(48)){TopMargin=Dp(8)});return button;
    }
    private async Task Guard(Func<Task> action)
    {try{await action();}catch(OperationCanceledException){}catch(Exception ex){if(!IsFinishing&&!IsDestroyed){message.Text=ex.Message;message.Visibility=ViewStates.Visible;message.SetTextColor(AColor.Rgb(155,48,28));}}}
    private Task<bool> Confirm(string title,string text)
    {var result=new TaskCompletionSource<bool>();new AlertDialog.Builder(this)!.SetTitle(title)!.SetMessage(text)!.SetPositiveButton("Xác nhận",(_,_)=>result.TrySetResult(true))!.SetNegativeButton("Quay lại",(_,_)=>result.TrySetResult(false))!.SetOnCancelListener(new CancelDialog(()=>result.TrySetResult(false)))!.Show();return result.Task;}
    private sealed class CancelDialog(Action action):Java.Lang.Object,IDialogInterfaceOnCancelListener{public void OnCancel(IDialogInterface? dialog)=>action();}
    private bool SignedIn(){if(api.IsCustomer)return true;LoginPage();return false;}
    private void Notice(string text){message.Text=text;message.Visibility=ViewStates.Visible;message.SetTextColor(Green);}
    private async Task LoadImage(ImageView image,Uri url,CancellationToken ct,bool isQr=false)
    {
        try
        {
            using var response=await images.GetAsync(url,HttpCompletionOption.ResponseHeadersRead,ct);response.EnsureSuccessStatusCode();
            if(response.Content.Headers.ContentLength>6*1024*1024)throw new IOException("Ảnh quá lớn.");
            using var data=new MemoryStream();await using var source=await response.Content.ReadAsStreamAsync(ct);var buffer=new byte[16384];int count;
            while((count=await source.ReadAsync(buffer,ct))>0){if(data.Length+count>6*1024*1024)throw new IOException("Ảnh quá lớn.");data.Write(buffer,0,count);}
            var bytes=data.ToArray();var media=response.Content.Headers.ContentType?.MediaType;
            if(media=="image/svg+xml")
            {
                if(isQr)throw new IOException("Định dạng QR không được hỗ trợ.");
                var xml=System.Text.Encoding.UTF8.GetString(bytes);
                using(var reader=System.Xml.XmlReader.Create(new StringReader(xml),new System.Xml.XmlReaderSettings{DtdProcessing=System.Xml.DtdProcessing.Prohibit,XmlResolver=null,MaxCharactersInDocument=6*1024*1024})){while(reader.Read()){} }
                using var svg=Com.Caverock.Androidsvg.SVG.GetFromString(xml)??throw new IOException("SVG không hợp lệ.");using var picture=svg.RenderToPicture(900,600)??throw new IOException("Không đọc được ảnh SVG.");
                var rendered=Bitmap.CreateBitmap(900,600,Bitmap.Config.Argb8888!)!;using(var canvas=new Canvas(rendered)){canvas.DrawColor(AColor.White);canvas.DrawPicture(picture!);}
                ct.ThrowIfCancellationRequested();image.SetImageBitmap(rendered);image.ContentDescription="Hình minh họa phòng, chưa có ảnh thực tế";return;
            }
            var bounds=new BitmapFactory.Options{InJustDecodeBounds=true};await BitmapFactory.DecodeByteArrayAsync(bytes,0,bytes.Length,bounds);
            var sample=1;while(bounds.OutWidth/sample>1400||bounds.OutHeight/sample>1400)sample*=2;
            var bitmap=await BitmapFactory.DecodeByteArrayAsync(bytes,0,bytes.Length,new BitmapFactory.Options{InSampleSize=sample});if(ct.IsCancellationRequested)return;
            if(bitmap is null)throw new IOException("Ảnh không hợp lệ.");image.SetImageBitmap(bitmap);image.ContentDescription="Ảnh đã tải";
        }
        catch(OperationCanceledException){}
        catch{if(!ct.IsCancellationRequested){image.ContentDescription=isQr?"Không tải được mã QR":"Không tải được ảnh phòng";throw new ApiException(isQr?"Không tải được mã QR. Bấm tải lại hoặc dùng thông tin chuyển khoản bên dưới.":"Chưa tải được ảnh phòng. Hãy thử lại.");}}
    }
    private ImageView Image(LinearLayout host,int height)
    {var image=new ImageView(this);image.SetScaleType(ImageView.ScaleType.FitCenter);host.AddView(image,new LinearLayout.LayoutParams(-1,Dp(height)));return image;}
    private AButton DateButton(LinearLayout host,string label,DateOnly initial,Action<DateOnly> changed)
    {
        var selected=initial;AButton? button=null;button=Button(host,$"{label}\n{selected:dd/MM/yyyy}",()=>{new DatePickerDialog(this,(_,a)=>{selected=DateOnly.FromDateTime(a.Date);button!.Text=$"{label}\n{selected:dd/MM/yyyy}";changed(selected);},selected.Year,selected.Month-1,selected.Day).Show();return Task.CompletedTask;},true);button.TextSize=12;button.LayoutParameters!.Height=Dp(62);button.Gravity=GravityFlags.Center;return button;
    }
    private void LoginPage()
    {
        Page("Chào mừng trở lại","account");var intro=Text("Một tài khoản, trọn vẹn kỳ nghỉ.\nĐăng nhập để đặt phòng và theo dõi thanh toán.",14);intro.SetTextColor(Muted);content.AddView(intro);var box=Card();
        var user=Input(box,"Tên đăng nhập");var password=Input(box,"Mật khẩu",true);
        Button(box,"Đăng nhập",async()=>{await api.Login(user.Text??"",password.Text??"",false,screen.Token);password.Text="";var target=pendingRoom;pendingRoom=null;if(target is not null)await ReservePage(target);else await MyBookings();});
        Button(box,"Tạo tài khoản",()=>{RegisterPage();return Task.CompletedTask;},true);Button(box,"Quên mật khẩu",()=>{ForgotPage();return Task.CompletedTask;},true);
        var privacy=Text("Thông tin đăng nhập được bảo vệ khi kết nối với khách sạn.",12);privacy.SetTextColor(Muted);privacy.Gravity=GravityFlags.Center;content.AddView(privacy);
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

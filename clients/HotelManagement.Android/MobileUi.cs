using Android.Content;
using Android.Graphics;
using Android.Graphics.Drawables;
using Android.Views;
using Android.Widget;
using AColor=Android.Graphics.Color;
using AButton=Android.Widget.Button;

namespace HotelManagement.Android;

public sealed partial class MainActivity
{
    private GradientDrawable Surface(AColor color,int radius,AColor? stroke=null)
    {
        var background=new GradientDrawable();background.SetColor(color);background.SetCornerRadius(Dp(radius));
        if(stroke.HasValue)background.SetStroke(Dp(1),stroke.Value);return background;
    }
    private TextView Heading(string title,int size=25)
    {
        var view=Text(title,size);view.SetTextColor(Green);view.Typeface=Typeface.Create("serif",TypefaceStyle.Normal);
        view.SetPadding(0,Dp(8),0,Dp(12));return view;
    }
    private View BrandHeader()
    {
        var header=new LinearLayout(this){Orientation=Orientation.Horizontal};header.SetGravity(GravityFlags.CenterVertical);header.SetPadding(Dp(20),Dp(12),Dp(20),Dp(12));
        var badge=Text("A",23);badge.Gravity=GravityFlags.Center;badge.SetTextColor(AColor.White);badge.Typeface=Typeface.Create("serif",TypefaceStyle.Normal);badge.Background=Surface(Gold,12);header.AddView(badge,new LinearLayout.LayoutParams(Dp(38),Dp(42)));
        var names=new LinearLayout(this){Orientation=Orientation.Vertical};names.SetPadding(Dp(11),0,0,0);var brand=Text("An Nhiên",23);brand.SetTextColor(Green);brand.Typeface=Typeface.Create("serif",TypefaceStyle.Normal);brand.SetPadding(0,0,0,0);names.AddView(brand);var caption=Text("H O T E L  &  R E S O R T",8,true);caption.SetTextColor(Muted);caption.SetPadding(0,0,0,0);names.AddView(caption);header.AddView(names,new LinearLayout.LayoutParams(0,-2,1));
        var bell=new NavIcon(this,"notifications",Green);bell.ContentDescription="Mở thông báo";bell.Background=Surface(AColor.White,20,Line);bell.Click+=async(_,_)=>await Guard(NotificationsPage);header.AddView(bell,new LinearLayout.LayoutParams(Dp(42),Dp(42)));return header;
    }
    private View BottomNavigation(string selected)
    {
        var container=new LinearLayout(this){Orientation=Orientation.Vertical};container.SetBackgroundColor(AColor.White);var divider=new View(this);divider.SetBackgroundColor(Line);container.AddView(divider,new LinearLayout.LayoutParams(-1,Dp(1)));
        var nav=new LinearLayout(this){Orientation=Orientation.Horizontal};nav.SetPadding(Dp(8),Dp(6),Dp(8),Dp(4));
        foreach(var item in new[]{("Khám phá","rooms"),("Đặt phòng","bookings"),("Thông báo","notifications"),("Tài khoản","account")})
        {
            var active=item.Item2==selected;var cell=new LinearLayout(this){Orientation=Orientation.Vertical,Clickable=true,Focusable=true,ContentDescription=item.Item1};cell.SetGravity(GravityFlags.Center);
            var icon=new NavIcon(this,item.Item2,active?Green:Muted);icon.Background=Surface(active?AColor.Rgb(232,238,226):AColor.Transparent,14);cell.AddView(icon,new LinearLayout.LayoutParams(Dp(52),Dp(30)));
            var label=Text(item.Item1,10,active);label.SetTextColor(active?Green:Muted);label.Gravity=GravityFlags.Center;label.SetPadding(0,Dp(4),0,0);cell.AddView(label);
            cell.Click+=async(_,_)=>await Guard(item.Item2 switch{"rooms"=>SearchPage,"bookings"=>()=>MyBookings(),"notifications"=>NotificationsPage,_=>AccountPage});nav.AddView(cell,new LinearLayout.LayoutParams(0,Dp(56),1));
        }
        container.AddView(nav);return container;
    }
    private void Hero()
    {
        var hero=new FrameLayout(this){Background=Surface(Green,24),ClipToOutline=true};
        var photo=new ImageView(this){ContentDescription="Không gian biển của An Nhiên"};photo.SetImageResource(Resource.Drawable.hotel_hero);photo.SetScaleType(ImageView.ScaleType.CenterCrop);hero.AddView(photo,new FrameLayout.LayoutParams(-1,-1));
        var shade=new View(this){Background=new GradientDrawable(GradientDrawable.Orientation.TopBottom,new[]{AColor.Argb(12,10,35,28).ToArgb(),AColor.Argb(222,10,35,28).ToArgb()})};hero.AddView(shade,new FrameLayout.LayoutParams(-1,-1));
        var copy=new LinearLayout(this){Orientation=Orientation.Vertical};copy.SetPadding(Dp(22),Dp(18),Dp(18),Dp(22));
        var eyebrow=Text("NƠI BÌNH YÊN CHẠM VÀO BIỂN CẢ",9,true);eyebrow.SetTextColor(AColor.Rgb(242,213,157));copy.AddView(eyebrow);
        var title=Heading("Chạm đến\nđiều đáng nhớ",32);title.SetTextColor(AColor.White);title.SetPadding(0,Dp(5),0,Dp(8));copy.AddView(title);
        var subtitle=Text("Kỳ nghỉ riêng tư, trải nghiệm trọn vẹn.",12);subtitle.SetTextColor(AColor.Rgb(236,239,225));copy.AddView(subtitle);hero.AddView(copy,new FrameLayout.LayoutParams(-1,-2,GravityFlags.Bottom));
        content.AddView(hero,new LinearLayout.LayoutParams(-1,Dp(248)){BottomMargin=Dp(14)});
    }
    private void GuestSelector(LinearLayout host)
    {
        var row=new LinearLayout(this){Orientation=Orientation.Horizontal};row.SetGravity(GravityFlags.CenterVertical);row.SetPadding(0,Dp(10),0,Dp(4));
        var labels=new LinearLayout(this){Orientation=Orientation.Vertical};labels.AddView(Text("Số khách",13,true));var hint=Text("Trong một phòng",11);hint.SetTextColor(Muted);labels.AddView(hint);row.AddView(labels,new LinearLayout.LayoutParams(0,-2,1));
        var amount=Text(guests.ToString(),17,true);amount.Gravity=GravityFlags.Center;amount.ContentDescription="Số khách đã chọn";
        AButton Counter(string symbol,string description)
        {var b=new AButton(this){Text=symbol,TextSize=22,ContentDescription=description};b.SetTextColor(Green);b.SetAllCaps(false);b.SetPadding(0,0,0,0);b.SetMinWidth(0);b.SetMinHeight(0);b.Background=Surface(AColor.Rgb(241,245,237),12,Line);b.StateListAnimator=null;return b;}
        var minus=Counter("−","Giảm số khách");var plus=Counter("+","Tăng số khách");
        void Draw(){amount.Text=guests.ToString();minus.Enabled=guests>1;plus.Enabled=guests<maxGuests;minus.Alpha=minus.Enabled?1:.35f;plus.Alpha=plus.Enabled?1:.35f;}
        minus.Click+=(_,_)=>{guests=Math.Max(1,guests-1);Draw();};plus.Click+=(_,_)=>{guests=Math.Min(maxGuests,guests+1);Draw();};
        row.AddView(minus,new LinearLayout.LayoutParams(Dp(44),Dp(44)));row.AddView(amount,new LinearLayout.LayoutParams(Dp(42),Dp(44)));row.AddView(plus,new LinearLayout.LayoutParams(Dp(44),Dp(44)));host.AddView(row);Draw();
    }
    private async Task RoomCover(ImageView image,TextView caption,Uri url,CancellationToken token)
    {
        caption.Text="Đang tải ảnh…";
        try{await LoadImage(image,url,token);if(!token.IsCancellationRequested)caption.Text=image.ContentDescription?.StartsWith("Hình minh họa")==true?"Hình minh họa · Chưa có ảnh thực tế":"Không gian phòng";}
        catch(OperationCanceledException){}
        catch{if(!token.IsCancellationRequested)caption.Text="Chưa tải được ảnh · Chạm ảnh để thử lại";}
        image.Click+=async(_,_)=>{try{await LoadImage(image,url,token);caption.Text=image.ContentDescription?.StartsWith("Hình minh họa")==true?"Hình minh họa · Chưa có ảnh thực tế":"Không gian phòng";}catch(OperationCanceledException){}catch{if(!token.IsCancellationRequested)caption.Text="Chưa tải được ảnh · Chạm ảnh để thử lại";}};
    }
    private sealed class NavIcon(Context context,string kind,AColor color):View(context)
    {
        protected override void OnDraw(Canvas canvas)
        {
            base.OnDraw(canvas);using var paint=new Paint(PaintFlags.AntiAlias){Color=color,StrokeWidth=1.8f,StrokeCap=Paint.Cap.Round,StrokeJoin=Paint.Join.Round};paint.SetStyle(Paint.Style.Stroke);
            canvas.Save();var scale=Math.Min(Width,Height)/32f;canvas.Translate((Width-24*scale)/2,(Height-24*scale)/2);canvas.Scale(scale,scale);
            if(kind=="rooms"){canvas.DrawRoundRect(3,8,21,19,2,2,paint);canvas.DrawLine(3,14,21,14,paint);canvas.DrawLine(7,8,7,14,paint);canvas.DrawLine(3,19,3,21,paint);canvas.DrawLine(21,19,21,21,paint);}
            else if(kind=="bookings"){canvas.DrawRoundRect(4,5,20,21,3,3,paint);canvas.DrawLine(4,10,20,10,paint);canvas.DrawLine(8,3,8,7,paint);canvas.DrawLine(16,3,16,7,paint);canvas.DrawLine(8,15,11,18,paint);canvas.DrawLine(11,18,16,13,paint);}
            else if(kind=="notifications"){using var path=new global::Android.Graphics.Path();path.MoveTo(5,17);path.LineTo(7,14);path.LineTo(7,9);path.CubicTo(7,2,17,2,17,9);path.LineTo(17,14);path.LineTo(19,17);path.Close();canvas.DrawPath(path,paint);canvas.DrawArc(9,17,15,22,0,180,false,paint);}
            else{canvas.DrawCircle(12,7,4,paint);canvas.DrawArc(4,13,20,27,180,180,false,paint);}canvas.Restore();
        }
    }
}

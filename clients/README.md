# Ứng dụng Windows và Android

Hai ứng dụng dùng API `https://hotelmanagementapi-nw4d.onrender.com/`, không mở trực tiếp SQLite và không chứa khóa SePay/SMTP. Tài khoản và quyền dùng chung với website. JWT chỉ giữ trong bộ nhớ và bị xóa khi đăng xuất/đóng ứng dụng.

## Cài Android bằng APK

File cài trực tiếp: `../App_Data/clients/Android/AnNhien.apk`. Chép file sang điện thoại Android 8 trở lên (ARM64), mở file và cài ứng dụng **An Nhiên**. Không cần Visual Studio trên điện thoại hoặc máy tính để sử dụng APK. Đăng nhập bằng tài khoản khách hàng đã đăng ký trên website; ứng dụng cần Internet để dùng API Render. Bản hiện tại là bản ký cài thử, chưa phát hành Google Play.

## Mở WinForms trong Visual Studio hiện tại

1. Đóng solution cũ, chọn **File → Open → Project/Solution** và mở `HotelManagement.WinForms.sln` trong thư mục này.
2. Trong Solution Explorer, bấm phải **HotelManagement.WinForms → Set as Startup Project**.
3. Chọn **Build → Rebuild Solution**, sau đó **F5**.

WinForms, thư viện API và chương trình kiểm tra dùng **.NET 8**; bộ SDK chọn từ .NET 9 đã có trên máy. Solution Windows chỉ có ba project này. `HotelManagement.Clients.slnx` cũng là solution Windows tương đương, không tải project Android. Không cần .NET 10 hoặc workload Android để build WinForms.

Bản EXE tự chứa runtime nằm tại `../App_Data/clients/WinForms/AnNhien.Staff.exe`. Đăng nhập bằng tài khoản nhân viên của website; tài khoản khách dùng ứng dụng Android. Để dùng API khác, nhập địa chỉ gốc tại màn hình đăng nhập. HTTP chỉ được chấp nhận cho localhost.

## Android trong Visual Studio 2022

Android dùng **.NET 9 for Android**, có `global.json` riêng chọn SDK **9.0.3xx**, tương thích Visual Studio 2022 **17.14**. Không cần cài Visual Studio 2026. Solution Android là `HotelManagement.Android/HotelManagement.Android.slnx`; solution Windows ở trên vẫn độc lập.

Visual Studio cần hai phần: workload .NET Android trong đúng thư mục SDK, và công cụ Android của IDE. Mở **Visual Studio Installer → Visual Studio 2022 → More → Import configuration**, chọn `visualstudio-android.vsconfig` trong thư mục này để bổ sung công cụ Android. Lưu và đóng IDE trước khi cài. Các công cụ dùng chung có thể vẫn cần dung lượng trên C dù SDK riêng đặt trên F.

Trên máy này SDK riêng nằm trên F. Mở IDE bằng script bên dưới để SDK resolver của Visual Studio tìm đúng nơi có workload Android. Script chỉ đặt biến môi trường cho tiến trình IDE mới, không thay đổi cấu hình SDK toàn máy. Đóng solution Android cũ trước, rồi chọn **HotelManagement.Android → Set as Startup Project**, chọn thiết bị Android và nhấn **F5** sau khi IDE đã có công cụ Android.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\open-android-vs2022.ps1
# Chỉ kiểm tra SDK/workload/IDE, chưa mở Visual Studio:
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\open-android-vs2022.ps1 -CheckOnly
```

Đường dẫn Android SDK và JDK riêng của máy được đặt trong file `HotelManagement.Android.csproj.user` (Git bỏ qua). Nếu build trên máy khác, cấu hình **Tools → Options → Xamarin → Android Settings** theo SDK/JDK của máy đó, hoặc dùng các tham số build ở dưới.

Trên máy hiện tại, SDK Android/.NET/JDK cần thiết đã được cài trên ổ F. Script đọc đường dẫn SDK riêng từ metadata build local trong `obj/client-toolchain/toolchain.json`; không buộc máy khác phải có cùng đường dẫn. Có thể chỉ định `-AndroidDotNetPath`, `-AndroidSdkDirectory`, `-JavaSdkDirectory` khi build trên máy khác.

```powershell
# Từ thư mục gốc project
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-clients.ps1 -Target Windows
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-clients.ps1 -Target Android
```

APK cài thử nằm ở `../App_Data/clients/Android/AnNhien.apk` sau khi chạy script. Đây là bản ký để cài thử, chưa phát hành Google Play. Android hỗ trợ từ Android 8; bản Release dùng HTTPS, không bỏ qua xác thực chứng chỉ. Bản Debug có tùy chọn API máy ảo `10.0.2.2` để kiểm tra database tạm, không áp dụng cho bản Release.

## Chức năng bản đầu

- WinForms: đăng nhập/đổi mật khẩu nhân viên; xem/tìm/phân trang phòng và booking; thêm khách; tạo booking; check-in/check-out/hủy; xem và ghi nhận thu/hoàn tiền; xử lý yêu cầu đổi/hủy.
- Android: đăng nhập/đăng ký/quên mật khẩu; tìm phòng theo ngày và sức chứa; đặt phòng; lịch sử booking; QR theo cấu hình VA, tiền cọc không vượt dư nợ; đồng hồ giữ chỗ theo giờ server; kiểm tra khoản tiền đã nhận; hủy giữ chỗ/gửi yêu cầu; thông báo trong ứng dụng; kênh hỗ trợ.
- Các nghiệp vụ, phân quyền, hết hạn giữ chỗ và xác nhận thanh toán vẫn do server quyết định. Chọn trả tại quầy không xác nhận đã nhận tiền. Thu tiền chỉ ghi nhận chứng từ, không tự chuyển khoản hoàn.
- Phiên bản này chưa có iOS, thông báo đẩy khi ứng dụng đóng, hoặc đầy đủ các màn hình cấu hình/quản trị của website. Giao diện tạo bằng C#; các form có constructor cần API được mở từ chương trình khi chạy.

## Kiểm tra

```powershell
dotnet run --project .\clients\HotelManagement.Client.Checks -c Release
$env:HOTEL_TEST_DLL = (Resolve-Path .\bin\NativeClients\net8.0\HotelManagementAPI.dll).Path
node .\tests\run-native-clients.mjs
```

Harness tích hợp chỉ chạy database và tài khoản giả trên localhost, không dùng dữ liệu production hoặc gửi ngân hàng/SMTP thật. SDK của API gốc vẫn độc lập với hai ứng dụng; source/output trong `clients/` đã được loại khỏi bản build/publish API.

# Cập nhật ASP.NET Core runtime — 28/10/2026

Đã cài **.NET Hosting Bundle 8.0.33** trên Windows cho cả x64 và x86. Trước cập nhật, máy chỉ có ASP.NET Core 8.0.19 trong nhánh 8. Kestrel của server kiểm thử hiện nạp từ thư mục **8.0.33**; project và bản publish cũng yêu cầu cả NETCore/ASP.NET Core tối thiểu 8.0.33.

## Nguồn và xác minh bộ cài

- Metadata: [Microsoft .NET 8 release metadata](https://dotnetcli.blob.core.windows.net/dotnet/release-metadata/8.0/releases.json), latest-release 8.0.33, ngày phát hành 25/10/2026.
- Bộ cài: [Microsoft Hosting Bundle 8.0.33](https://builds.dotnet.microsoft.com/dotnet/aspnetcore/Runtime/8.0.33/dotnet-hosting-8.0.33-win.exe).
- SHA-512 bộ cài khớp metadata chính thức:

```text
0DA4A03349A86A2E028B26F2D0EE705F556E59BF4821FA9432EF9A7B6608E0FCCE225250829C92D58E14E57DA0758CF564B4205D4F7C69A6079658E6EE0DEA1E
```

- Authenticode: **Valid**, signer `CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US`.
- Cài với quyền quản trị, `/install /quiet /norestart`. Exit code **0**, không có yêu cầu khởi động lại Windows; không tự restart máy.
- `dotnet --list-runtimes` của cả `C:/Program Files/dotnet/dotnet.exe` và `C:/Program Files (x86)/dotnet/dotnet.exe` đều liệt kê Microsoft.AspNetCore.App 8.0.33 và Microsoft.NETCore.App 8.0.33.

Microsoft xác nhận CVE-2025-55315 ảnh hưởng ASP.NET Core 8.0.0–8.0.20 và vá CVE này từ 8.0.21. [Advisory chính thức](https://github.com/dotnet/aspnetcore/security/advisories/GHSA-5rrx-jjjq-q2r5). Không thực hiện khai thác lỗ hổng; kết luận bản vá dựa trên thư viện thực tế và phạm vi phiên bản của Microsoft.

## Thay đổi project

`HotelManagementAPI.csproj` đặt `RuntimeFrameworkVersion=8.0.33`; FrameworkReference của Microsoft.AspNetCore.App dùng cùng giá trị để tránh hai mốc bị lệch. Bản framework-dependent vẫn target net8.0, chấp nhận patch 8.0 mới hơn và từ chối máy không có runtime đáp ứng mốc tối thiểu. Không thay phiên bản SDK hoặc nâng major .NET.

Đã kiểm tra runtimeconfig của cả output build và output publish:

```json
"frameworks": [
  { "name": "Microsoft.NETCore.App", "version": "8.0.33" },
  { "name": "Microsoft.AspNetCore.App", "version": "8.0.33" }
]
```

`tests/run-deployment.mjs` hỗ trợ HOTEL_TEST_DLL cho cả tiến trình server và lệnh --healthcheck, để kiểm thử đúng output mới mà không ghi đè DLL đang mở trong Visual Studio.

## Thư viện thực tế đã nạp

Đã khởi chạy ứng dụng trên database/cổng tạm và đọc module tiến trình, gồm Kestrel, HTTP và JSON. Với x86 còn khởi chạy bản publish qua đường dẫn dotnet x86 tường minh, readiness trả Healthy rồi kiểm tra module trước khi dừng và dọn dữ liệu thử.

| Tiến trình | Module thực tế | Phiên bản file |
| --- | --- | --- |
| x64 | `C:/Program Files/dotnet/shared/Microsoft.AspNetCore.App/8.0.33/Microsoft.AspNetCore.Server.Kestrel.Core.dll` | 8.0.3326.52312 |
| x64 | `C:/Program Files/dotnet/shared/Microsoft.AspNetCore.App/8.0.33/Microsoft.AspNetCore.Http.dll` | 8.0.3326.52312 |
| x64 | `C:/Program Files/dotnet/shared/Microsoft.NETCore.App/8.0.33/System.Text.Json.dll` | 8.0.3326.52219 |
| x86, bản publish | `C:/Program Files (x86)/dotnet/shared/Microsoft.AspNetCore.App/8.0.33/Microsoft.AspNetCore.Server.Kestrel.Core.dll` | 8.0.3326.52312 |

Các runtime cũ vẫn còn để giữ tương thích cho ứng dụng khác; project mới được ràng buộc ở mốc 8.0.33. Cài bản mới không thay DLL đã nạp trong một tiến trình đang chạy.

## Kiểm thử

- Restore/build và publish thành công, không có cảnh báo/lỗi build.
- NuGet audit cả dependency gián tiếp: không có package được báo lỗ hổng theo nguồn hiện tại.
- Hồi quy project: **1.625 kiểm tra**, cùng Edge thanh toán.
- Chống trùng chuyển khoản: **235 kiểm tra API/schema**, cùng Edge nhập tay/webhook và liên kết khoản đã thu.
- Đối soát: **116 kiểm tra**, cùng Edge lễ tân.
- Triển khai x64: **49 HTTP checks** cùng healthcheck, proxy tin cậy, HTTPS/HSTS, lịch khách sạn, storage, fault và telemetry.
- Bản publish qua dotnet x86: cùng **49 HTTP checks** triển khai đạt.
- Tổng: **2.074 kiểm tra được đếm**, cùng các kiểm tra giao diện và vận hành bổ sung ở trên. Dữ liệu thử đã được dọn, không gửi SMTP/giao dịch SePay thật.

## Chạy lại trên máy và Docker

Trong Visual Studio, dừng phiên cũ bằng Shift+F5 nếu đang chạy, build lại rồi F5. Khi kiểm tra cuối, không có listener ở cổng 7203; các server thử chỉ dùng cổng tạm. Không cần xóa database hoặc cấu hình lại SMTP/ngân hàng.

Với máy Windows khác, cài Hosting Bundle/runtime .NET 8 đáp ứng mốc mới trước khi chạy. Với Docker, dùng `docker compose build --pull` và tạo lại container để nhận base image mới. Chưa chạy container Linux trong lượt này: máy có Docker CLI nhưng daemon Docker Desktop Linux chưa chạy. Không coi các kiểm tra Windows là bằng chứng container đã được nghiệm thu.

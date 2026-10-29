# Sao lưu và phục hồi đầy đủ — 28/10/2026

## Sử dụng

Sau khi cập nhật mã, dừng debug bằng Shift+F5, Build rồi F5 lại đúng project. Admin vào **Sao lưu & Nhật ký → Tạo bản sao lưu**, sau đó tải file ZIP. Tính năng không cần migration mới. Các file .db cũ vẫn tải được nhưng chỉ chứa database.

Khi ứng dụng chạy, tác vụ kiểm tra mỗi giờ: tạo gói cho ngày mới theo múi giờ khách sạn; thay bản gần nhất nếu thiếu, sai kích thước hoặc kiểm tra nội dung thất bại; dọn bản cũ. Ngay sau mỗi lần tạo thủ công cũng chạy dọn.

| Cấu hình | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `Backup:RetentionDays` | 14 | Giữ bản trong số ngày này, 1–3650 |
| `Backup:MaxBackups` | 30 | Giới hạn số bản, 1–10000 |
| `Backup:ReplicaDirectory` | Không bật | Thư mục tuyệt đối dành riêng cho bản sao thứ hai, ngoài vùng dữ liệu và wwwroot |

Đặt trong appsettings hoặc biến môi trường với dấu `__`, ví dụ `Backup__MaxBackups=30`. Không đặt 0 để tắt dọn; cấu hình sai bị từ chối. Lịch chỉ chạy khi ứng dụng đang chạy, không tạo tác vụ Windows riêng.

Luôn giữ ít nhất gói đầy đủ vừa được xác minh. Bản .db cũ được theo dõi trong database cũng chịu retention. Chỉ quản lý các tên dự trữ `hotel-yyyyMMdd-HHmmss-{guid}.zip/.db`; tệp lạ không bị xóa. Thư mục tạo/kiểm tra và file tạm có tên dự trữ bị bỏ dở quá 24 giờ được dọn ở cả hai vị trí. Khi tạo thất bại, các gói tốt trước đó được giữ. Không áp dụng quota byte; phải dự trù dung lượng cho số bản và dữ liệu ảnh tăng dần.

## Nội dung và bảo vệ

Gói trong `Storage:DataDirectory/App_Data/backups` gồm:

- `hotel.db`: snapshot SQLite bằng Online Backup API, có kiểm tra `PRAGMA quick_check` và schema ứng dụng.
- `App_Data/room-images`: ảnh tải lên, đồng thời kiểm tra mọi ảnh đã xuất bản trong database đều có file.
- `jwt.key`, `data-protection-keys/*.xml`: khóa phiên đăng nhập và dữ liệu bảo vệ như token đặt lại mật khẩu.
- `bank-config.json` nếu đã cấu hình, kể cả khi file nguồn nằm ngoài vùng dữ liệu.
- `recovery-settings.json`: cấu hình đã chọn cho múi giờ, email/SMTP, webhook, giám sát, retention và application discriminator; đường dẫn database/ngân hàng chuyển sang tương đối cho máy mới.
- `manifest.json`: phiên bản, thời điểm UTC, kích thước và SHA-256 từng tệp.

Gói **có thông tin khách, khóa và mật khẩu SMTP/App Password** nếu đã cấu hình. ZIP không mã hóa; SHA-256 phát hiện hỏng dữ liệu, không chứng minh nguồn gửi đáng tin. Chỉ dùng gói từ nguồn tin cậy, bảo vệ ổ đĩa/nơi lưu ngoài máy bằng mã hóa và phân quyền. Không đưa ZIP/recovery-settings vào Git, Docker image hay thư mục web công khai.

Thư mục do ứng dụng quản lý dùng quyền 700/file 600 trên Unix; Windows giới hạn ACL cho tài khoản chạy ứng dụng, SYSTEM và Administrators. Link/junction bị từ chối. API tạo/liệt kê/tải chỉ dành cho Admin và trả `Cache-Control: no-store`. ZIP được kiểm tra trước khi xuất bản bằng đổi tên, file đang tạo không được tải.

Snapshot không đóng gói mã ứng dụng, .NET runtime, ảnh minh họa trong wwwroot, log, email .eml, bản sao cũ, toàn bộ User Secrets, mật khẩu bootstrap hay cấu hình reverse proxy/HTTPS/Docker. Các cấu hình hạ tầng đó cần được giữ riêng. Mật khẩu SMTP đang có hiệu lực được sao vào snapshot, không cần sao nguyên kho User Secrets. `ReplicaDirectory` không mang sang máy phục hồi để tránh ghi vào vị trí cũ.

## Bản sao thứ hai

Chọn thư mục mới hoặc rỗng dành riêng; ứng dụng khởi tạo marker `.hotel-backup-replica`. Những lần sau giữ nguyên marker. Thư mục đã có tệp nhưng chưa có marker bị từ chối trước khi thay đổi quyền hoặc ghi/xóa. Không chọn thư mục gốc ổ đĩa, thư mục cha của project/vùng dữ liệu, hay wwwroot.

Gói được sao sang file tạm, kiểm tra đầy đủ rồi đổi tên. Nơi lưu thứ hai cũng chịu retention; khi mất kết nối, bản cục bộ vẫn được giới hạn, API tạo báo lỗi và tác vụ nền ghi nhận lỗi giám sát. Sau khi nơi lưu trở lại, lần bảo trì/tạo tiếp theo sao lại bản mới nhất và dọn những bản vượt giới hạn. Tệp ngoài mẫu tên quản lý được giữ nguyên.

Thư mục khác trên cùng ổ đĩa không phải bản sao ngoài máy. Muốn chịu được mất máy chủ, mount ổ/NAS được bảo vệ ở máy khác rồi trỏ cấu hình vào thư mục dành riêng trên đó. Có mẫu Docker tùy chọn tại [deploy/README.md](deploy/README.md); chưa kết nối nhà cung cấp lưu trữ thật trong lượt sửa này.

## Xác minh và phục hồi

Dùng bản ứng dụng tương ứng hoặc bản đã kiểm thử tương thích. Lệnh CLI chạy trước khi khởi tạo web server, không mở cổng, không tự tạo tài khoản. Ví dụ PowerShell trong thư mục project sau `dotnet build`:

```powershell
dotnet .\bin\Debug\net8.0\HotelManagementAPI.dll --verify-backup "D:\HotelBackups\hotel-TEN_GOI.zip"
dotnet .\bin\Debug\net8.0\HotelManagementAPI.dll --restore-backup "D:\HotelBackups\hotel-TEN_GOI.zip" --restore-target "D:\HotelData-Restored"
```

Thay tên file/ổ đĩa bằng vị trí thực tế. Thư mục cha của đích phải tồn tại và ghi được; **thư mục đích chưa được tồn tại**. Xác minh cần chỗ trống/ghi được cạnh file ZIP để giải nén tạm; phục hồi cần chỗ trống trong thư mục cha của đích. Không dùng `/tmp` tmpfs nhỏ trong container để chứa toàn bộ dữ liệu. Khi tạo backup cần đủ dung lượng cho snapshot, ZIP và bản giải nén kiểm tra đồng thời, ngoài các gói được giữ. Định dạng hiện giới hạn 100.000 tệp dữ liệu và 20 GiB tổng dữ liệu giải nén mỗi gói.

Exit code 0 và JSON `success:true` nghĩa là kiểm tra thành công; exit code 1 là thất bại. Lệnh phục hồi kiểm tra manifest/hash, SQLite, ảnh, khóa/cấu hình và chỉ đổi tên thư mục staging sang đích sau khi tất cả đạt. Gói hỏng, đường dẫn vượt thư mục, mục trùng, symlink hoặc cấu hình ngoài danh sách cho phép bị từ chối. Không ghi đè database đang chạy; không có nút phục hồi trực tiếp trên website.

Chạy thử vào root mới với cổng riêng trước khi thay dữ liệu thật:

```powershell
dotnet .\bin\Debug\net8.0\HotelManagementAPI.dll --Storage:DataDirectory "D:\HotelData-Restored" --urls "https://localhost:7204"
```

Cấu hình phục hồi thay các mặc định appsettings. User Secrets (Development), biến môi trường và tham số CLI vẫn có ưu tiên cao hơn: bỏ/chỉnh `ConnectionStrings:DefaultConnection` cũ nếu nó đang trỏ vào database nguồn, cùng các đường dẫn/SMTP/URL không phù hợp máy mới. Database và ngân hàng mặc định đọc từ `hotel.db`/`bank-config.json` trong root phục hồi. Kiểm tra `/health/ready`, phòng/booking/khoản thu, ảnh, đăng nhập và luồng đặt lại mật khẩu. Việc giữ application discriminator cùng Data Protection key ring giúp token cũ còn hạn giải mã được dù content root đã đổi.

Sau nghiệm thu, dừng ứng dụng chính rồi đổi cấu hình vùng dữ liệu sang root đã phục hồi; giữ nguyên dữ liệu nguồn cho đến khi xác nhận. Phục hồi về thời điểm cũ cũng đưa trạng thái tài khoản/phiên và các giao dịch về thời điểm đó, vì vậy phải đối soát phần phát sinh sau snapshot trước khi mở phục vụ.

## Kiểm chứng trong project

```powershell
dotnet build
node tests/run-full-backup.mjs
```

Harness dùng server/cổng/database/ảnh/SMTP giả riêng; tạo ZIP, tải qua API, chạy CLI phục hồi sang root khác rồi khởi động server từ dữ liệu phục hồi. Kiểm tra lại giá phòng, khoản thu 25.000đ, ảnh đúng từng byte, múi giờ, cấu hình ngân hàng, JWT gốc và token đặt lại mật khẩu tạo trước sao lưu. Nguồn được thay giá sau snapshot để chứng minh server mới đọc database phục hồi. Có thử dữ liệu hỏng/thiếu/đường dẫn độc hại, retention theo tuổi/số lượng, bản .db cũ, mất file, hỏng ZIP, lỗi bản sao thứ hai và cấu hình thư mục nguy hiểm. Có thể bật `HOTEL_BACKUP_UI=1` với Playwright để kiểm tra tạo/tải ZIP qua Edge.

## Kết quả thực chạy

- Build `BackupReady` và `BackupRetentionVerified`: 0 lỗi, 0 cảnh báo. Cấu hình riêng tránh ghi đè DLL Debug mà Visual Studio có thể đang dùng.
- `run-full-backup.mjs` trên bản cuối: 73 kiểm tra HTTP/CLI/cấu hình, cùng các đối chiếu hash, dữ liệu, file và retention đều đạt. Bao gồm dọn file/thư mục tạm bỏ dở ở cả nơi lưu cục bộ và bản sao thứ hai.
- Edge: màn Admin hiển thị gói đầy đủ, tạo bản mới có retention và tải đúng tên ZIP; không có lỗi JavaScript.
- `run-project-checks.mjs`: 1.625 kiểm tra nghiệp vụ đạt, kèm Edge thanh toán/QR/cọc và thông báo tiền mặt/chuyển khoản.
- `run-deployment.mjs`: 49 kiểm tra HTTP cùng healthcheck, lưu trữ, proxy, múi giờ và giám sát lỗi đạt. `run-api-errors.mjs`: cả Production/Development đạt 21 kiểm tra HTTP + 5 formatter mỗi môi trường; smoke 99 và customer-auth 43 đạt.
- Các server, archive, dữ liệu phục hồi và bí mật giả được dọn sau thử. Không thay dữ liệu thật, dừng phiên Visual Studio, gửi SMTP hoặc nhận giao dịch SePay thật.
- Docker CLI không có trong terminal kiểm thử hiện tại; chưa chạy Compose/container Linux hoặc nơi lưu ngoài máy thật. Mẫu Docker và phân quyền/mount phải được nghiệm thu trên máy triển khai trước khi coi là phương án khôi phục production đã được kiểm chứng.

Tham khảo: [Microsoft — SQLite Online Backup](https://learn.microsoft.com/dotnet/standard/data/sqlite/backup), [Microsoft — Data Protection và application isolation](https://learn.microsoft.com/en-us/aspnet/core/security/data-protection/configuration/overview?view=aspnetcore-8.0).

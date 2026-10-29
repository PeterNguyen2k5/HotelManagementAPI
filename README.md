# HotelManagementAPI

Một project ASP.NET Core 8 chứa cả API và giao diện quản lý khách sạn. Dữ liệu lưu trong SQLite tại `hotel.db` cạnh file project; ứng dụng tự tạo cơ sở dữ liệu và áp dụng EF Core migrations khi chạy lần đầu. Không cần SQL Server hoặc chạy frontend riêng.

## Tạo dữ liệu phòng mẫu trên website mới

Đăng nhập Admin ở `/index.html`, mở **Quản lý phòng → Tạo dữ liệu mẫu** khi danh sách còn trống. Tạo 3 hạng phòng Standard/Deluxe/Family (đều ghi rõ mẫu), 6 phòng M101–M302 có sức chứa, diện tích, giường, tiện nghi và hình SVG minh họa; giá lần lượt 450.000đ, 750.000đ và 1.100.000đ/đêm. Chỉnh lại theo khách sạn thực tế trước khi nhận khách thật. Không tạo tài khoản, hồ sơ khách, booking, khoản thu hay cấu hình ngân hàng giả.

API `POST /api/Administration/demo-rooms` chỉ dành cho Admin, dùng transaction và audit. Nếu đã có bất kỳ phòng nào thì giữ nguyên, không thêm/ghi đè. Retry hoặc nhiều người bấm đồng thời không tạo trùng. Không có tác vụ tự động chèn dữ liệu mẫu khi khởi động và không cần migration mới. Kiểm thử `node tests/run-demo-rooms.mjs`, tùy chọn `HOTEL_DEMO_UI=1` cùng Playwright/Edge. Render không có persistent disk vẫn có thể mất dữ liệu khi restart/redeploy; nút này chỉ tạo mẫu, không thay thế lưu trữ bền vững.

## Sửa ngân hàng webhook, hoàn tiền và tên dịch vụ — 29/10/2026

- Webhook phải có `gateway` được nhận diện và trùng ngân hàng đã cấu hình, cùng đúng tài khoản nhận. So sánh theo bảng alias rõ ràng (MB/MBBank/970422, VCB/Vietcombank/970436...), bỏ qua khác biệt hoa/thường/khoảng trắng. Không dùng tên hiển thị Admin tự nhập để xác nhận ngân hàng. Gateway thiếu, không biết hoặc khác ngân hàng trả **400** trước khi lưu receipt/ghi tiền; ID bị từ chối vẫn dùng được khi nhận payload hợp lệ sau đó. Tên trường theo [SePay webhook](https://developer.sepay.vn/vi/sepay-webhooks/tich-hop-webhook); mã/BIN đối chiếu [danh sách VietQR](https://api.vietqr.io/v2/banks). Ngân hàng chưa có alias phải được bổ sung và kiểm thử trước khi bật tự nhận webhook.
- Refund/Transfer dùng định danh riêng theo ngân hàng, tài khoản khách sạn chi hoàn, mã giao dịch và chiều tiền ra. Cùng chứng từ/cùng booking/số tiền trả lại khoản đã ghi, kể cả UUID mới; khác booking/số tiền trả **409**. Có unique index và transaction, không gộp với định danh tiền vào. Form lễ tân cho xem/chỉnh ngân hàng và tài khoản **chi**, không phải tài khoản khách nhận hoàn. API nhận `bankId`, `bankAccountNumber`; nếu không gửi thì dùng tài khoản cấu hình hiện tại để tương thích client cũ. Vẫn cần cấu hình ngân hàng trước khi ghi chuyển khoản mới. UUID alias được lưu để retry sau lỗi mạng/đổi cấu hình vẫn đọc lại kết quả cũ đúng payload.
- Các khoản Refund/Transfer cũ chưa có định danh tài khoản không bị tự gắn vào ngân hàng hiện tại. Nếu trùng mã tham chiếu cũ, yêu cầu mới bị chặn **409** để đối soát; retry UUID gốc vẫn đọc lại khoản đã ghi. Không tự sửa/gộp tiền đã bị nhập trùng trước bản sửa.
- Lượt dịch vụ mới lưu `ServiceName` cùng giá/số lượng. Lịch sử nhân viên, portal khách, hóa đơn và báo cáo dùng tên đã chốt. Đổi danh mục chỉ ảnh hưởng lượt sử dụng mới; hóa đơn đã phát hành được giữ nguyên.
- Migration `PreserveServiceUsageName` bổ sung cột, ưu tiên tên gốc trong ServiceUsageOperations cho dữ liệu cũ. Với lượt cũ không còn snapshot, chỉ có thể chốt tên danh mục đang có lúc nâng cấp; không tự suy đoán tên đã mất. Không thay tiền/số lượng hoặc viết lại hóa đơn cũ. Các hóa đơn sai tên đã phát hành trước sửa cần xem xét theo chứng từ riêng.

Sao lưu trước khi nâng cấp dữ liệu thật. Trong Visual Studio: **Shift+F5 → Build → F5** để dùng mã mới và áp dụng migration; sau đó tải lại giao diện. Không chỉ Ctrl+Shift+R vì có thay đổi API/schema.

Kiểm thử trên dữ liệu tạm:

```powershell
dotnet build
node tests/run-financial-history-fixes.mjs
node tests/run-project-checks.mjs
node tests/run-transfer-dedup.mjs
node tests/run-payment-uuid.mjs
node tests/run-service-usage-retry.mjs
node tests/run-ambiguous-bank-codes.mjs
node tests/run-bank-reconciliation.mjs
node tests/run-full-backup.mjs
```

Đặt `HOTEL_FINANCIAL_HISTORY_UI=1` cùng đường dẫn Playwright/Edge để thử form hoàn mới, nhập lại cùng chứng từ từ form khác và hóa đơn giữ tên dịch vụ cũ. Các fixture webhook hợp lệ của test hiện cung cấp gateway thật theo ngân hàng thử; các ca gateway sai/thiếu được kiểm tra riêng, không nới validation để phục vụ fixture cũ. Không dùng tài khoản, dữ liệu, SMTP hoặc giao dịch SePay thật trong harness.

Kết quả bản sửa `ThreeFixesVerified`: build 0 lỗi/cảnh báo; EF không phát hiện model chưa có migration; **105 kiểm tra mới** cùng Edge đạt. Hồi quy đạt **1.625** kiểm tra tổng quát, **235** chống trùng chuyển vào, **116** UUID thanh toán, **74** retry dịch vụ, **170** mã booking mơ hồ, **116** đối soát và **72** sao lưu/phục hồi: tổng **2.513 kiểm tra** gồm bộ mới. Đã chạy thêm Edge thanh toán/QR/cọc/tiền mặt với gateway hợp lệ. Migration thử từ schema chưa có ServiceName giữ tổng tiền/số lượt cũ, khôi phục tên gốc từ thao tác và không sửa snapshot hóa đơn. Không dừng tiến trình Visual Studio hoặc chỉnh dữ liệu thật; các thay đổi này hiện ở máy local, chưa commit/push mới.

Triển khai Docker: xem [deploy/README.md](deploy/README.md). Có Dockerfile chạy non-root, Compose/Caddy HTTPS, volume dữ liệu, múi giờ khách sạn cố định, health check và Prometheus/alert rules. Ngoài Development mặc định chuyển nghiệp vụ HTTP sang HTTPS; các harness kiểm thử local tắt redirect rõ ràng trên server tạm. Log ứng dụng dùng JSON với timestamp UTC và trace ID; ngày nghiệp vụ mặc định theo `Asia/Ho_Chi_Minh`.

## Cập nhật bảo mật dependency — 28/10/2026

Đã nâng JwtBearer, EF Core SQLite và EF Core Design từ 8.0.8 lên 8.0.33, giữ target .NET 8. Đồ thị restore hiện dùng:

| Dependency từng báo High | Bản cũ | Bản sau cập nhật |
| --- | --- | --- |
| Microsoft.Extensions.Caching.Memory | 8.0.0 | 8.0.1 |
| SQLitePCLRaw.lib.e_sqlite3 | 2.1.6 | 2.1.13 — native SQLite 3.53.3 |
| System.Text.Json | 8.0.4 | 8.0.6, khai báo trực tiếp để tiếp tục được audit |

`NuGetAuditMode=all` kiểm tra cả dependency gián tiếp; NU1903/NU1904 (High/Critical) làm restore/build thất bại. Kiểm tra lại định kỳ vì dữ liệu advisory có thể thay đổi:

```powershell
dotnet restore HotelManagementAPI.csproj --force-evaluate
dotnet list HotelManagementAPI.csproj package --vulnerable --include-transitive
```

Kết quả ngày 28/10/2026: không có package được NuGet báo lỗ hổng. Build và publish đạt; EF không có thay đổi model cần migration cho cập nhật dependency/runtime. Bản publish có native SQLite cho Windows/Linux; native SQLite đã xác nhận là **3.53.3**. Sau cập nhật Hosting Bundle, đã xác nhận Kestrel/HTTP nạp từ ASP.NET Core **8.0.33**, JSON từ NETCore **8.0.33**; xem [bằng chứng cập nhật runtime](RUNTIME-UPDATE-2026-10-28.md).

Publish có thể dùng DLL trong shared runtime thay vì sao chép DLL NuGet. Project yêu cầu cả **Microsoft.NETCore.App và Microsoft.AspNetCore.App tối thiểu 8.0.33**, cho phép bản vá 8.0 mới hơn; máy hiện tại đã đáp ứng ở cả x64/x86. Kiểm tra máy khác bằng `dotnet --list-runtimes` và cập nhật Hosting Bundle/runtime trước khi chạy nếu thiếu. Cơ chế chọn runtime được mô tả trong [tài liệu .NET](https://learn.microsoft.com/en-us/dotnet/core/versions/selection). Khi nâng Docker, dùng `docker compose build --pull` để lấy base image mới; chưa kiểm thử container Linux vì daemon Docker hiện chưa chạy.

Kiểm thử đạt 1.624 kiểm tra hồi quy API, thêm 404 kiểm tra đối soát/dịch vụ/phiên/mật khẩu/bootstrap và 5 trường hợp từ chối cấu hình bootstrap; giao diện thanh toán Edge đạt. Bản publish với runtime tối thiểu đã qua thêm 232 kiểm tra thanh toán Production/Development và cùng bộ Edge. Các bộ kiểm thử chạy trên dữ liệu tạm, không gửi SMTP hoặc giao dịch ngân hàng thật. Khi mở project trong Visual Studio, dừng phiên chạy cũ bằng **Shift+F5**, build lại rồi **F5** để dùng DLL mới. Ctrl+Shift+R chỉ tải lại giao diện, không thay thư viện trong server đang chạy.

**Đã xử lý cảnh báo runtime ngày 28/10/2026:** Hosting Bundle **8.0.33** từ Microsoft đã được kiểm tra SHA-512/chữ ký số và cài thành công. Hai kiến trúc x64/x86 đều chạy bản publish/server thử với Kestrel 8.0.33; installer không yêu cầu khởi động lại Windows. Build và **2.074 kiểm tra** cùng các bộ Edge đạt. Dừng phiên ứng dụng cũ, build lại rồi chạy bằng **F5** trong Visual Studio để nạp runtime mới; Ctrl+Shift+R chỉ tải lại giao diện. Xem [báo cáo runtime](RUNTIME-UPDATE-2026-10-28.md).

## Chạy bằng Visual Studio

1. Mở `HotelManagementAPI.slnx` hoặc `HotelManagementAPI.csproj`.
2. Với database mới, cấu hình biến môi trường **`BootstrapAdmin__Password`** cho tiến trình chạy ứng dụng: tối thiểu 12 ký tự, tối đa 72 byte UTF-8. Không ghi mật khẩu vào mã nguồn hoặc commit cấu hình chứa mật khẩu. Ứng dụng không cung cấp mật khẩu mặc định, kể cả Development; thiếu/sai cấu hình sẽ dừng khởi động trước khi tạo Admin.
3. Chọn profile **https** và bấm **F5**. Trình duyệt mở giao diện quản trị tại `https://localhost:7203/`.
4. Đăng nhập `admin` bằng mật khẩu khởi tạo đã cấu hình. Màn hình bắt buộc đổi sang mật khẩu khác (tối thiểu 12 ký tự) trước khi dùng nghiệp vụ; đổi xong đăng nhập lại bằng mật khẩu mới.
5. Swagger ở `https://localhost:7203/swagger` khi chạy môi trường Development.

Khi đã có tài khoản nhân viên, `BootstrapAdmin__Password` không ghi đè mật khẩu hiện có và có thể gỡ khỏi cấu hình. Database cũ tự áp dụng migration thêm `Users.MustChangePassword`; Admin còn dùng `admin123` được chuyển sang chế độ bắt buộc đổi mật khẩu, không bị thay hoặc xóa tài khoản. Admin đã có mật khẩu riêng được giữ nguyên. Admin mới do Admin khác tạo cũng phải đổi mật khẩu lần đầu. Trạng thái này được lưu trong database qua các lần khởi động; không thể bỏ qua bằng cách sửa trình duyệt, JWT claim hoặc gọi API quản lý trực tiếp. Phiên chưa đổi mật khẩu chỉ dùng được đăng nhập, xem tài khoản và đổi mật khẩu; các API còn lại trả 403 với mã `PASSWORD_CHANGE_REQUIRED`. Đổi mật khẩu thành công thu hồi các JWT cũ theo cơ chế hiện có.

Ví dụ chạy local bằng PowerShell 7, nhập mật khẩu kín thay vì ghi vào lịch sử lệnh:

```powershell
$env:BootstrapAdmin__Password = Read-Host 'Mật khẩu Admin khởi tạo' -MaskInput
dotnet run --launch-profile https
Remove-Item Env:\BootstrapAdmin__Password
```

Kiểm thử riêng: `dotnet build`, sau đó `node tests/run-admin-bootstrap.mjs`. Thêm `HOTEL_ADMIN_UI=1` để kiểm tra giao diện bằng Playwright (các biến `HOTEL_PLAYWRIGHT_MODULE`/`HOTEL_BROWSER_PATH` dùng như bộ kiểm thử thanh toán). Các harness hồi quy tự cấu hình Admin trên database tạm, thực hiện đổi mật khẩu thật rồi restart server để bắt đầu lại cửa sổ giới hạn đăng nhập; không có chế độ bỏ qua bảo vệ trong ứng dụng.

Giao diện khách theo bản [Figma Make An Nhiên](https://www.figma.com/make/CSed7FJ1WGNTsbZkXRUA6Q/) ở `https://localhost:7203/hotel.html`. Khách có thể chọn ngày và xem phòng trống mà không đăng nhập; gửi đặt phòng bắt buộc đăng nhập tài khoản khách. Khi bấm đặt phòng, hộp đăng nhập/đăng ký mở nếu chưa có phiên; sau khi xác thực, form đặt phòng tiếp tục với phòng, ngày và số khách đã chọn. Dữ liệu được lưu trực tiếp vào SQLite; nhân viên thấy đặt phòng mới trong giao diện quản trị. API đặt phòng trên website giới hạn 5 yêu cầu/phút trên mỗi địa chỉ IP.

Có thể chạy từ terminal bằng `dotnet run --launch-profile https`. Cần .NET 8 SDK. `hotel.db`, `jwt.key` và thư mục `data-protection-keys` được tạo trong thư mục project; giữ chúng khi di chuyển dữ liệu sang máy khác. Không chia sẻ `jwt.key` hoặc cơ sở dữ liệu công khai.

## Chức năng

- **Rooms, RoomTypes:** CRUD, DTO, phân trang/lọc/sắp xếp, trạng thái Trống/Đang thuê/Bảo trì.
- **Customers, Bookings, BookingDetails:** CRUD khách hàng, tìm phòng trống theo ngày, tạo booking, check-in, check-out, hủy booking và tính tiền phòng theo số đêm thực tế. Giá phòng được lưu tại lúc đặt nên không thay đổi khi sửa bảng giá.
- **Ngày tạo booking:** cả Admin/Receptionist và khách chỉ được tạo booking có ngày nhận từ hôm nay trở đi (theo ngày tại máy chủ), ngày trả phải sau ngày nhận. API trả 400 khi nhận phòng trong quá khứ, kể cả lịch lưu trú đã kết thúc hoặc ngày trả vẫn ở tương lai; không ghi booking hay thay đổi trạng thái phòng. Form nhân viên giới hạn ngày chọn và báo lỗi trước khi gửi. Chưa có luồng nhập lịch sử lưu trú riêng. Kiểm thử các mốc ngày nằm trong `tests/smoke.mjs`; chạy an toàn bằng `node tests/run-booking-filters.mjs` sau `dotnet build` để dùng database tạm.
- **Users, Auth:** JWT login, tài khoản Admin/Receptionist, đổi mật khẩu. Admin quản lý tài khoản, loại phòng, phòng, dịch vụ và xem báo cáo. Receptionist quản lý khách, booking và dịch vụ sử dụng.
- **Services, Reports:** CRUD dịch vụ, ghi nhận dịch vụ trên booking đang ở; doanh thu phòng và dịch vụ chỉ được tính sau check-out.
- **Frontend:** giao diện quản trị ở `/` và trang khách ở `/hotel.html`, cùng chạy từ project ASP.NET Core. Màu sắc, bố cục, kiểu chữ và hình ảnh lấy từ thiết kế Figma; số liệu mẫu trong thiết kế được thay bằng dữ liệu API thật. Font và hình ảnh được lưu trong `wwwroot` để dùng khi không có mạng.

Xóa phòng, loại phòng hoặc khách hàng đã có dữ liệu liên quan sẽ bị chặn để giữ lịch sử. Xóa dịch vụ và tài khoản là vô hiệu hóa; dữ liệu lịch sử vẫn được giữ.

## Kiểm thử API

Chạy ứng dụng rồi dùng `node tests/smoke.mjs` để kiểm tra login, phân quyền, CRUD, lọc/phân trang, chọn phòng, booking, check-in/out, đặt phòng từ trang khách, dịch vụ và doanh thu. Script thêm dữ liệu thử vào SQLite đang chạy; nên dùng trên một bản dữ liệu thử riêng.

Sức chứa từng phòng được chỉnh trong Quản lý phòng (mặc định 2 khách cho phòng cũ). Tìm phòng và tạo booking kiểm tra số khách với sức chứa; booking mới lưu GuestCount. Booking trước khi bổ sung tính năng hiển thị “Chưa ghi nhận” số khách. Không thể giảm sức chứa thấp hơn số khách của booking chưa kết thúc.

Admin có thể kích hoạt lại dịch vụ tạm dừng bằng nút Kích hoạt trong danh sách Dịch vụ hoặc POST /api/Services/{id}/activate. Lịch sử sử dụng và đơn giá được giữ nguyên; Receptionist không có quyền kích hoạt.

Báo cáo dịch vụ phổ biến và doanh thu cùng ghi nhận booking đã check-out theo ngày trả phòng thực tế (bao gồm tất cả dịch vụ trên booking đó). Đường dẫn không tồn tại dưới /api trả 404 dạng JSON.

Khách đăng ký/đăng nhập tại /hotel.html. API CustomerAuth/register, CustomerAuth/login; CustomerAuth/me và CustomerAuth/bookings chỉ dành cho tài khoản khách. Mật khẩu tối thiểu 8 ký tự, băm BCrypt; mỗi IP tối đa 5 lần đăng nhập hoặc đăng ký mỗi phút. POST /api/Bookings/public yêu cầu JWT vai trò Customer: thiếu/sai/hết hạn token trả 401, token nhân viên trả 403. Booking luôn liên kết với hồ sơ tài khoản đang đăng nhập; không tạo hồ sơ khách ẩn danh hoặc tin customerId/thông tin liên hệ gửi lên để gán chủ sở hữu. Booking không đăng nhập trước đó không được tự động gán theo email. Tài khoản khách không truy cập được API quản lý; Admin/Receptionist tiếp tục tạo booking qua POST /api/Bookings. Phiên hết hạn khi gửi booking sẽ mở đăng nhập lại và giữ lựa chọn cùng ghi chú, không tự gửi booking.
Kiểm thử tài khoản khách: node tests/customer-auth.mjs trên database thử. Khởi động lại server giữa bộ smoke và bộ customer-auth để bắt đầu cửa sổ giới hạn đăng nhập/đăng ký mới.

Chức năng vận hành: khách gửi yêu cầu hủy/đổi trong Booking của tôi; lễ tân xử lý ở Yêu cầu của khách. Gia hạn/đổi phòng và thu/hoàn tiền nằm trong Chi tiết booking. Đổi phòng giữa kỳ giữ từng chặng giá riêng. Hủy booking không tự chuyển tiền: khoản cần hoàn hiện riêng để ghi nhận Refund sau khi hoàn thực tế. Hóa đơn phát hành sau check-out, mở trang In / Lưu PDF để in hoặc chọn Save as PDF của trình duyệt. Phòng sau check-out/đổi phòng chuyển Chờ dọn, lễ tân xác nhận dọn xong trong mục Dọn phòng. Admin quản lý Sao lưu & Nhật ký. Gói ZIP đầy đủ được tạo mỗi ngày, kiểm tra mỗi giờ; tự dọn theo số ngày/số bản. Chỉ Admin tải qua API. Xem [sao lưu và phục hồi](BACKUP-RESTORE-2026-10-28.md) để cấu hình và phục hồi vào thư mục mới. Nhật ký không chứa mật khẩu/token.

Kiểm thử vận hành: node tests/operations.mjs trên database thử. Khởi động lại server giữa từng bộ smoke, customer-auth và operations vì các bộ kiểm thử cố ý dùng giới hạn đăng nhập/đăng ký. Hóa đơn giữ nguyên dữ liệu phòng/dịch vụ khi phát hành; số đã thu/còn nợ cập nhật theo giao dịch. Booking lịch sử chưa có chứng từ thu tiền sẽ hiển thị đã thu 0; chỉ bổ sung giao dịch khi có căn cứ thực tế. Giá phòng theo đêm thực tế, toàn bộ lượt lưu trú tối thiểu 1 đêm; các lần chuyển phòng trong cùng ngày không tính thêm đêm cho phòng cũ.

Giá phòng và dịch vụ phải không âm, trong giới hạn hiện có và có tối đa 2 chữ số thập phân. API tạo/cập nhật trả HTTP 400 kèm lỗi ở trường Price nếu gửi 100.999; không tự làm tròn hoặc cắt số. Giá 100, 100.9, 100.99 và 100.9900 (cùng giá trị 100.99) được chấp nhận. Giao diện hiển thị tối đa 2 chữ số thập phân. Quy tắc này không thay đổi dữ liệu cũ. Kiểm thử trên database thử: node tests/price-precision.mjs với HOTEL_URL trỏ đến server thử riêng.

Xóa dịch vụ đã sử dụng và check-out cùng bảo vệ bước đọc/kiểm tra/ghi bằng transaction Serializable. Nếu check-out hoàn tất trước, dịch vụ không thể bị xóa; nếu xóa hoàn tất trước, hóa đơn không tính dịch vụ đó. Khi SQLite bận/khóa, API xóa trả HTTP 409 để tải lại dữ liệu. Kiểm thử đồng thời chỉ trên database riêng: đặt HOTEL_URL và HOTEL_TEST_ISOLATED=1, rồi chạy node tests/service-checkout-concurrency.mjs. HOTEL_TEST_DB tùy chọn là đường dẫn database thử để kiểm tra khóa ghi (server thử cần Default Timeout=1).

Thêm dịch vụ qua `POST /api/Services/usage` bắt buộc có `requestId` là UUID dạng chuẩn 36 ký tự, khác UUID rỗng, cùng `bookingId`, `serviceId`, `quantity`. Lần đầu ghi thành công trả 201; thử lại cùng UUID và nội dung trả 200 với cùng lượt dịch vụ/đơn giá/thời gian/tên dịch vụ ban đầu. Dùng UUID cũ cho booking, dịch vụ hoặc số lượng khác trả 409. Khóa UUID được chuẩn hóa chữ thường để biến thể chữ hoa không tạo khoản mới. Thiếu/sai UUID trả 400.

Mỗi lần mở form **Thêm dịch vụ** sinh một UUID; giữ nguyên UUID khi bấm lưu lại trong cùng form sau lỗi mạng. Mở form mới là thao tác mới với UUID khác, kể cả cùng dịch vụ và số lượng. Backend giữ khóa trong `ServiceUsageOperations` với unique primary key và transaction. Khóa vẫn tồn tại sau khi xóa lượt dịch vụ: gửi lại thao tác đã xóa trả 409 thay vì tạo lại khoản đã bỏ. Retry của lượt còn tồn tại sau check-out chỉ đọc lại kết quả, không sửa hóa đơn hoặc tạo thêm dịch vụ. Thay đổi giá/tên hoặc tạm dừng dịch vụ không làm thay đổi kết quả của thao tác đã thành công.

Migration `AddServiceUsageIdempotency` thêm bảng lưu thao tác, giữ nguyên các lượt dùng dịch vụ và hóa đơn cũ. API client cũ cần bổ sung requestId; giao diện trong project đã được cập nhật phiên bản asset. Sau nâng cấp, dừng/chạy lại ứng dụng và tải lại trang. Không tự suy diễn requestId hoặc gộp các lượt dịch vụ lịch sử vì các lượt giống nhau có thể là những lần sử dụng riêng biệt.

Kiểm thử riêng: `node tests/run-service-usage-retry.mjs`. Có thể đặt `HOTEL_SERVICE_RETRY_UI=1` cùng cấu hình Playwright/Edge để thử mất phản hồi sau khi server đã ghi thành công và gửi lại form. Harness dùng database tạm, kiểm tra cả xử lý đồng thời, xóa, restart, đổi giá và nâng schema. Hồi quy chung: `node tests/run-project-checks.mjs`.

JWT nhân viên được ràng buộc với mật khẩu và `SessionVersion` bằng mã HMAC; JWT/API không trả PasswordHash hoặc SessionVersion. Đổi mật khẩu vẫn thu hồi mọi JWT đã cấp. Khóa/mở khóa bằng cập nhật nhân viên, vô hiệu hóa bằng DELETE và thay đổi vai trò làm tăng SessionVersion; khôi phục quyền hoặc mở khóa không làm JWT cũ sống lại. Cập nhật họ tên/email đơn thuần không thu hồi phiên. Thay đổi tài khoản, kiểm tra Admin hiện tại và cập nhật phiên bản nằm trong một transaction Serializable để tránh ghi đè khi xử lý đồng thời; lỗi lưu sẽ rollback cả phiên bản. Không tự đổi mật khẩu khi khóa/mở khóa.

Migration `AddStaffSessionVersion` thêm cột mặc định 0, giữ nguyên tài khoản/mật khẩu và tự áp dụng khi chạy lại ứng dụng. Định dạng HMAC phiên nhân viên chuyển sang v2 nên tất cả phiên nhân viên từ bản cũ cần đăng nhập lại một lần sau nâng cấp. Phiên khách hàng dùng cơ chế riêng, không bị thu hồi bởi thay đổi này.

Kiểm thử: `node tests/run-staff-session-lifecycle.mjs` tạo database riêng, thử khóa/mở qua PUT/DELETE, đổi quyền/đổi lại, lưu qua restart, xử lý đồng thời, rollback, không ảnh hưởng tài khoản khác và nâng schema cũ. Đặt `HOTEL_STAFF_SESSION_UI=1` cùng cấu hình Playwright/Edge để kiểm tra trình duyệt xóa JWT cũ và yêu cầu đăng nhập mới. Hồi quy đổi mật khẩu/JWT vẫn nằm trong `node tests/run-project-checks.mjs`. Nếu phiên Visual Studio đang giữ DLL, dùng build cấu hình riêng và `HOTEL_TEST_DLL` như hướng dẫn kiểm thử đối soát.

## Hồ sơ và khôi phục tài khoản khách

- Tại `/hotel.html`, sau đăng nhập chọn **Hồ sơ** để sửa họ tên, điện thoại, email, CCCD/hộ chiếu và địa chỉ. Đổi email yêu cầu mật khẩu hiện tại; email được đồng bộ giữa tài khoản và hồ sơ khách. Username, vai trò và liên kết khách hàng không thể đổi qua API này.
- Trong **Khách hàng → Sửa**, Admin/Receptionist đổi email sẽ cập nhật đồng thời hồ sơ và tài khoản khách liên kết (kể cả tài khoản tạm ngưng), chuẩn hóa email về chữ thường/bỏ khoảng trắng đầu cuối. Email đã có tài khoản khác trả 409; email trống cho khách có tài khoản trả 400; toàn bộ thay đổi hồ sơ được hủy nếu cập nhật thất bại. Khách chưa có tài khoản vẫn được để trống email và không tự tạo tài khoản khi lưu. Quên mật khẩu dùng email mới; liên kết khôi phục gửi đến email cũ mất hiệu lực sau khi đổi. Phiên đăng nhập hiện tại và mật khẩu không đổi. Không cần migration; hồ sơ bị lệch từ trước được đồng bộ theo email nhân viên nhập khi lưu lại, không tự sửa hàng loạt dữ liệu cũ.
- **Đổi mật khẩu** nằm trong Hồ sơ. Mật khẩu mới tối thiểu 8 ký tự và tối đa 72 byte UTF-8. Đổi/đặt lại mật khẩu thu hồi mọi JWT khách đã cấp trước đó và mọi liên kết khôi phục cũ. JWT khách từ bản trước cũng cần đăng nhập lại một lần.
- **Quên mật khẩu?** nằm trên hộp đăng nhập. Liên kết có hạn 30 phút và dùng một lần; API trả cùng thông báo cho email có/không có tài khoản đang hoạt động. Có giới hạn 5 yêu cầu/phút/IP riêng cho gửi liên kết, đặt lại và đổi mật khẩu.
- API: `PUT /api/CustomerAuth/me`, `POST /api/CustomerAuth/change-password`, `POST /api/CustomerAuth/forgot-password`, `POST /api/CustomerAuth/reset-password`.

### Email thử trên máy

Khi chạy profile `https` trong môi trường **Development**, mặc định email được ghi thành file `.eml` tại **App_Data/mail/** bên cạnh project. Mở file bằng ứng dụng đọc email để dùng liên kết. Đây là email thử, không gửi đến hộp thư thật. Thư mục không nằm trong wwwroot và được bỏ qua trong Git. Chỉ giữ các file này trên máy phát triển vì chúng chứa liên kết khôi phục có hạn dùng.

Liên kết mặc định mở `https://localhost:7203/hotel.html`. Nếu chạy cổng khác, đặt biến môi trường `CustomerEmail__PublicBaseUrl` theo địa chỉ ứng dụng. Liên kết dùng fragment `#resetToken=...` để không gửi token trong URL của yêu cầu HTTP; giao diện xóa fragment khỏi thanh địa chỉ ngay khi mở form. Token không được ghi vào nhật ký hay trả qua API. Không cần migration cho tính năng này; giữ data-protection-keys để liên kết còn hiệu lực sau restart.

### Giới hạn mật khẩu nhân viên

Các API `/api/Users`, `/api/Auth/register`, `/api/Auth/login` và `/api/Auth/change-password` kiểm tra mật khẩu tối đa **72 byte UTF-8** trước khi hash hoặc xác minh BCrypt. Giới hạn áp dụng cả mật khẩu hiện tại và mật khẩu mới; vượt giới hạn trả HTTP 400 kèm lỗi ở trường tương ứng, không tạo tài khoản hoặc thay đổi mật khẩu. Mật khẩu có dấu/emoji có thể chiếm nhiều byte mỗi ký tự. Không tự cắt, bỏ khoảng trắng hoặc chuẩn hóa mật khẩu. Bootstrap Admin dùng cùng giới hạn byte và vẫn yêu cầu tối thiểu 12 ký tự; quy tắc bắt buộc đổi mật khẩu lần đầu giữ nguyên.

Giao diện tạo nhân viên, đăng nhập, đổi mật khẩu và đổi lần đầu kiểm tra UTF-8 trước khi gửi yêu cầu. Khi nâng cấp, tài khoản cũ không bị tự đổi mật khẩu. Mật khẩu đã tạo bằng bản cũ vượt 72 byte sẽ bị từ chối thay vì tiếp tục chấp nhận các hậu tố khác nhau; cần đặt lại thông tin đăng nhập qua quy trình hỗ trợ tài khoản.

Kiểm thử: `node tests/run-staff-password-length.mjs` dùng database riêng, bao phủ cả hai API tạo nhân viên, giới hạn 72 byte với ASCII/tiếng Việt/emoji, đăng nhập bằng hậu tố khác nhau, mật khẩu cũ/mới vượt giới hạn và thu hồi JWT khi đổi mật khẩu. Đặt `HOTEL_STAFF_PASSWORD_UI=1` cùng `HOTEL_PLAYWRIGHT_MODULE`/`HOTEL_BROWSER_PATH` để kiểm tra thêm giao diện bằng Edge. Không dùng tài khoản thật.

### Cấu hình SMTP khi cần email thật

Trên máy local, nhập App Password Gmail bằng ô ẩn và lưu cấu hình vào **.NET User Secrets**:

```powershell
cd C:\Users\Admin\Downloads\HotelManagementAPI
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\configure-smtp-local.ps1 -SenderEmail "GMAIL_DA_TAO_APP_PASSWORD"
dotnet run --launch-profile http
```

Thay `GMAIL_DA_TAO_APP_PASSWORD` bằng địa chỉ Gmail sở hữu App Password. Script hỏi mật khẩu bằng `Read-Host -AsSecureString`, nhận 16 ký tự (tự bỏ khoảng trắng), lưu SMTP Gmail/587, email gửi và URL `http://localhost:5057`. Có thể đổi URL bằng `-PublicBaseUrl "https://localhost:7203"` rồi chạy profile `https`. Mật khẩu đi vào `dotnet user-secrets` qua stdin, không nằm trong command line hoặc file project; các secret khác được giữ lại. Script chỉ cấu hình, không tự gửi email.

User Secrets được app tự đọc trong **Development**, lưu ngoài project tại `%APPDATA%\Microsoft\UserSecrets\<UserSecretsId>\secrets.json`. File này không được mã hóa; chỉ dùng trên máy phát triển và bảo vệ tài khoản Windows theo [hướng dẫn Microsoft](https://learn.microsoft.com/aspnet/core/security/app-secrets?tabs=windows). Không cần lưu lại sau mỗi lần mở PowerShell. Biến môi trường và tham số chạy vẫn có độ ưu tiên cao hơn: nếu đã làm theo cách `$env:CustomerEmail__...` trước đó, xóa các biến này hoặc mở PowerShell mới trước khi chạy app. Script cảnh báo tên biến đang ghi đè mà không in giá trị.

Để thử thư thật, vào `http://localhost:5057/hotel.html`, dùng tài khoản khách thử có email bạn đọc được, chọn **Quên mật khẩu** và kiểm tra Inbox/Spam. Thông báo API chung không chứng minh email đã đến. Để đổi App Password, chạy lại script. Để bỏ mật khẩu đã lưu:

```powershell
dotnet user-secrets remove "CustomerEmail:Smtp:Password" --project .\HotelManagementAPI.csproj
```

Cấu hình bằng biến môi trường, không đưa thông tin đăng nhập vào mã nguồn:

| Biến | Nội dung |
| --- | --- |
| `CustomerEmail__Mode` | `Smtp` |
| `CustomerEmail__PublicBaseUrl` | URL HTTPS công khai của ứng dụng |
| `CustomerEmail__From` | Địa chỉ người gửi |
| `CustomerEmail__Smtp__Host` | Máy chủ SMTP |
| `CustomerEmail__Smtp__Port` | Cổng SMTP STARTTLS; mặc định 587 |
| `CustomerEmail__Smtp__Username` | Tài khoản SMTP nếu máy chủ yêu cầu |
| `CustomerEmail__Smtp__Password` | Mật khẩu SMTP nếu máy chủ yêu cầu |

SMTP luôn bật TLS. Chế độ Pickup chỉ được phép trong Development. Khi Production chưa cấu hình SMTP/URL, API quên mật khẩu trả 503; không thông báo đã gửi email thật. Nếu SMTP gặp lỗi trong lúc gửi, nhật ký chỉ ghi cảnh báo chung, không ghi email/token/mật khẩu.
### Kiểm thử tự động tài khoản khách

Chạy `dotnet build`, sau đó `node tests/run-customer-account-tools.mjs`. Harness tự khởi động server ở cổng tạm, dùng database/email/data-protection keys riêng trong thư mục tạm rồi dọn sau khi kiểm thử. Không trỏ vào hotel.db thật. Nó kiểm tra cập nhật hồ sơ, đổi email có xác nhận mật khẩu, đổi/quên/reset mật khẩu, email thử, giới hạn yêu cầu và các bộ hồi quy customer-auth, smoke, staff-token-revocation; tự restart server thử giữa các cửa sổ rate limit. Pickup bị chặn trong Production cũng được kiểm tra. Gửi SMTP thật cần cấu hình và kiểm tra riêng với nhà cung cấp email của bạn.
## Kiểm thử đồng thời trạng thái phòng và check-in

API PATCH `/api/Rooms/{id}/trang-thai` dùng transaction Serializable từ trước khi đọc trạng thái phòng và booking đến khi lưu xong. Nếu đổi sang Bảo trì/Chờ dọn trước, check-in bị chặn; nếu check-in trước, API không được ghi đè trạng thái Đang thuê. SQLite bận/khóa trả HTTP 409 để tải lại. Quy tắc xác nhận dọn xong trong Dọn phòng được giữ nguyên.

Sau `dotnet build`, chạy `node tests/run-room-status-concurrency.mjs`. Harness tự tạo server và database tạm, chạy 32 cặp yêu cầu đồng thời, kiểm tra hai thứ tự xử lý, phân quyền, dữ liệu không hợp lệ, xung đột khóa và bộ smoke; sau đó dừng server và dọn dữ liệu thử. Không dùng hotel.db thật. Cần Node.js có node:sqlite để kiểm tra khóa ghi.
## Lỗi API và mã hỗ trợ

Middleware xử lý lỗi chạy trước static files, rate limiting, xác thực và controller trong cả Development/Production. Lỗi ngoài dự kiến trả HTTP 500 với JSON gồm `message`, `statusCode`, `traceId`; không trả stack trace, đường dẫn máy chủ, câu SQL, thông tin đăng nhập hoặc nội dung exception. Lỗi SQLite bận chưa được controller xử lý trả 409. Yêu cầu bị client hủy không bị báo thành lỗi máy chủ. Nếu response đã bắt đầu gửi, middleware không cố ghi lại JSON lên dữ liệu đang truyền.

Các phản hồi API chưa có nội dung lỗi (401/403/404...) được bổ sung cùng định dạng; thông báo lỗi nghiệp vụ và `errors` theo trường vẫn được giữ. API luôn có header `X-Trace-Id`; các phản hồi lỗi đặt `Cache-Control: no-store`. Validation 400 và rate limit 429 có statusCode/traceId, vẫn giữ Retry-After khi có. Giao diện quản trị, khách và hóa đơn dùng chung bộ đọc thông báo lỗi, hiển thị mã hỗ trợ khi lỗi 5xx và thông báo dễ hiểu khi mất kết nối hoặc nhận HTML từ proxy.

Nhật ký của middleware ghi loại exception, vị trí stack và traceId để tra cứu, không ghi nội dung exception, request body, Authorization hoặc query string. Đây là xử lý lỗi trong yêu cầu HTTP; lỗi cấu hình/migration trước khi ứng dụng khởi động vẫn cần xử lý tại máy chủ.
Kiểm thử: chạy `dotnet build`, rồi `node tests/run-api-errors.mjs`. Harness tạo server/database/log riêng trong thư mục tạm, cài điều kiện lỗi filesystem trước khi server thử khởi động để kiểm tra phản hồi 500 thật trên API sao lưu, kiểm tra mã hỗ trợ trong log, khóa SQLite, lỗi 400/401/403/404/409/429 và bộ smoke/customer-auth. Chạy cả Development và Production; không thêm endpoint gây lỗi vào ứng dụng. Thư mục thử được dọn sau khi dừng server, không dùng dữ liệu thật. Các lỗi HTTP gửi trước khi vào ứng dụng (ví dụ máy chủ/proxy từ chối kết nối) được giao diện xử lý bằng thông báo dự phòng.
## Chuông thông báo nhân viên

Admin và Receptionist có chuông hiển thị tổng số công việc hiện tại: yêu cầu hủy/đổi Pending, khách quá ngày trả nhưng chưa check-out, khách nhận hôm nay chưa check-in, khách đang ở có ngày trả hôm nay, phòng Cleaning. Số trên chuông là tổng công việc, không phải số tin chưa đọc; một booking có thể đồng thời cần xử lý yêu cầu và nhận phòng. Nhóm không có công việc không hiển thị. Không lưu thêm dữ liệu và không cần migration.

GET `/api/Notifications` chỉ cho nhân viên, không trả thông tin khách cá nhân; tự tính từ SQLite theo ngày tại máy chủ. Bấm nhóm mở Yêu cầu của khách/Dọn phòng hoặc danh sách booking có bộ lọc Attention=arrivals/departures/overdue. API và danh sách dùng cùng quy tắc lọc. Các nhóm chỉ giảm sau khi xử lý thực tế. Giao diện tải lại khi mở, đổi màn hình, mỗi 30 giây khi trang hiển thị và khi quay lại tab; có nút Làm mới/Thử lại khi lỗi. Dữ liệu đã tải được giữ cùng thời điểm cập nhật nếu kết nối lỗi. Đăng xuất xóa bộ nhớ thông báo để không hiển thị sang tài khoản khác. Chuông là bảng công việc trong ứng dụng, không gửi push/email.
Kiểm thử chuông: `dotnet build` rồi `node tests/run-notifications.mjs`. Harness dùng server/database tạm, kiểm tra đủ 5 nhóm, quyền Admin/Receptionist, khách bị chặn, bộ lọc booking khớp số thông báo, giảm số sau khi xử lý và bộ smoke. Ngày trả quá hạn được tạo trực tiếp chỉ trong database thử để kiểm tra mốc ngày; không có API thay đổi thời gian hệ thống.
## Tìm kiếm danh sách booking

GET `/api/Bookings` bổ sung `CustomerKeyword` (tên/SĐT/email/CCCD, tối đa 200 ký tự), `RoomNumber` (một phần số phòng, tối đa 10 ký tự), `FromDate`, `ToDate`. Điều kiện kết hợp bằng AND cùng Status, Attention, CustomerId, RoomId và phân trang hiện có. Từ khóa %/_ được coi là ký tự thường, không phải wildcard. SQLite LIKE không phân biệt hoa/thường ASCII; không tự bỏ dấu tiếng Việt.

Ngày được chuẩn hóa về ngày lịch; khoảng ngày tìm các đêm lưu trú dự kiến giao với [FromDate, ToDate đến hết ngày]. Booking trả phòng đúng đầu FromDate không được tính; booking nhận phòng trong ngày ToDate được tính. Có thể nhập một mốc hoặc cùng một ngày. Đây là ngày lưu trú dự kiến trên booking, không phải ngày tạo hoặc ngày check-out thực tế. ToDate trước FromDate hoặc bằng 9999-12-31 bị từ chối 400. Không thay đổi cách đặt phòng/tính tiền.

Giao diện Đặt phòng có nhãn cho từng trường, nút Tìm booking/Xóa bộ lọc, kiểm tra khoảng ngày, giữ điều kiện qua phân trang và đặt lại trang 1 khi tìm. Bộ lọc từ chuông vẫn hoạt động và có thể kết hợp với tên/số phòng/ngày. Không cần migration.
Kiểm thử: sau `dotnet build`, chạy `node tests/run-booking-filters.mjs`. Mỗi bộ dùng database tạm riêng để kiểm tra tìm tên/SĐT/email/CCCD, ký tự %/_ theo nghĩa đen, khoảng lưu trú và mốc checkout, điều kiện kết hợp, phân trang, quyền truy cập; chạy hồi quy notifications và smoke. Không dùng hotel.db thật.
## Ảnh, chi tiết và tiện nghi phòng

Trang khách `/hotel.html` có nút **Xem chi tiết** trên từng phòng và có thể bấm tên phòng để mở thư viện ảnh. Khách xem ảnh lớn/ảnh thu nhỏ, chuyển bằng nút hoặc phím trái/phải, xem mô tả, diện tích, giường, sức chứa và tiện nghi; **Đặt phòng này** giữ ngày và số khách đang chọn. Khi lỗi có nút Thử lại. Không điền sẵn tiện nghi chưa được xác nhận.

Admin vào **Quản lý phòng → Ảnh & tiện nghi** để nhập mô tả chi tiết (4000 ký tự), diện tích 1–1000 m², giường (100 ký tự), tối đa 30 tiện nghi (80 ký tự/mục), tải tối đa 10 ảnh JPG/PNG/WebP, mỗi ảnh tối đa 5 MB. Có thể chọn ảnh bìa và bỏ ảnh khỏi danh sách. Tải xong cần bấm **Lưu thông tin** để xuất bản. API kiểm tra chữ ký định dạng, tự đặt tên file và không chấp nhận URL ngoài/đường dẫn tùy ý/ảnh của phòng khác. Receptionist và khách không được sửa hoặc tải ảnh.

Phòng chưa có ảnh thực tế dùng các hình minh họa cục bộ trong wwwroot/images/room-illustrations và ghi rõ **Hình minh họa**. Đây không phải ảnh thật; bạn sẽ tải ảnh thật và nhập tiện nghi sau theo lựa chọn của mình. Không thay đổi file ảnh và dữ liệu phòng/booking có sẵn. Trường email tùy chọn trong form đặt phòng được gửi null khi để trống.

Dữ liệu lưu ở bảng mới RoomPresentations. Migration AddRoomPresentation chỉ tạo bảng và khóa ngoại, tự áp dụng khi chạy lại project. Không sửa hoặc xóa bản ghi phòng, khách và booking cũ. GET `/api/RoomPresentation/{roomId}` và `/cover` công khai thông tin phòng; PUT cùng đường dẫn và POST `/{roomId}/images` chỉ dành cho Admin. Ảnh được lưu ở **App_Data/room-images/{roomId}/**, phục vụ qua endpoint ảnh với tên ngẫu nhiên và Content-Type phù hợp; không nằm trong wwwroot, không cho upload SVG/executable.

**Di chuyển/sao lưu ảnh:** gói ZIP đầy đủ hiện chứa cả database, App_Data/room-images, khóa và cấu hình vận hành; các bản .db cũ chỉ chứa SQLite. Xem [quy trình phục hồi](BACKUP-RESTORE-2026-10-28.md). Bỏ ảnh khỏi gallery hoặc xóa phòng không tự xóa file ảnh vật lý; file chưa xuất bản/không còn tham chiếu chỉ dọn sau khi xác minh.

Kiểm thử sau `dotnet build`: `node tests/run-room-presentation.mjs`. Harness tạo server/database tạm, kiểm tra dữ liệu công khai, quyền Admin/Receptionist/Customer, upload/giới hạn/dữ liệu không hợp lệ, gallery/ảnh bìa, cập nhật phòng và nghiệp vụ booking, sau đó chạy hồi quy customer-auth và smoke. Đã thử nâng cấp từ schema trước tính năng với dữ liệu giả bằng HOTEL_TEST_LEGACY_SQL trỏ tới SQL migration cũ; không dùng database thật. Ảnh và database thử được dọn sau khi dừng server.
## Hiệu ứng sóng biển Three.js

Trang khách `/hotel.html` giữ thiết kế, bố cục, font và ảnh nền trước khi thêm Three.js; chỉ thêm sóng biển 3D nhẹ trong vùng biển của ảnh. Lớp sóng được giới hạn bằng mask, không phủ màu phẳng lên toàn bộ đầu trang; đã bỏ các hạt sáng nổi. Hiệu ứng áp dụng các skill threejs-fundamentals, threejs-shaders, threejs-performance từ https://github.com/CloudAI-X/threejs-skills. Ba skill được cài ở thư mục Codex skills của máy và có thể dùng từ các lượt tiếp theo. Đây là hướng dẫn lập trình; code chạy trong website là Three.js 0.186.1 MIT chính thức, đã xác minh SHA-512 và đóng gói/thu nhỏ chỉ các export cần dùng bằng esbuild 0.25.12. Bundle cục bộ khoảng 520 KiB tại `wwwroot/vendor/three-0.186.1/`; xem LICENSE và SOURCE.md.

- Nút **Sóng biển 3D** bật/tắt, lưu lựa chọn trong localStorage (`hotel.hero3d`). Người dùng có thể tắt bất cứ lúc nào.
- Mặc định không bật khi thiết bị yêu cầu giảm chuyển động hoặc tiết kiệm dữ liệu; người dùng vẫn có thể chủ động bật. Không tải bundle Three.js nếu hiệu ứng đang tắt mặc định.
- Renderer WebGL2 alpha trong canvas trang trí không nhận pointer và không chặn form/người đọc màn hình. Ảnh nền, giao diện và các luồng API giữ cơ chế hiện có. Có phản ứng chuột rất nhẹ, không cần thao tác trên điện thoại.
- Tối đa khoảng 30 lần vẽ/giây, một draw call, không tải model/texture ngoài hoặc shadow/postprocessing. Giới hạn pixel ratio 1.5 trên desktop, 1 trên điện thoại; giảm số đỉnh khi khởi tạo trên điện thoại.
- Tạm dừng animation khi cuộn khỏi hero hoặc ẩn tab. Khi tắt hoặc rời trang, dừng loop, hủy listeners/observer/Timer, giải phóng geometry/material/renderer và WebGL context; hỗ trợ quay lại bằng bfcache.
- Nếu không có WebGL2, mất context hoặc module/shader lỗi, chuyển về ảnh nền với thông báo điều khiển; tìm phòng, tài khoản, gallery và đặt phòng vẫn hoạt động. Thư viện nằm trong project, không cần mạng/CDN khi người dùng mở trang. Không dùng hiệu ứng trong cổng quản trị.

Đã kiểm tra trực tiếp bằng Edge/Playwright trên server/database tạm: animation thực sự phát lệnh vẽ WebGL, bật/tắt và lưu lựa chọn, pause khi offscreen/ẩn tab, reduced-motion không tải renderer, fallback không WebGL/mất context, bố cục 320/390/768/1440 px và luồng đăng ký khách → xem chi tiết ảnh → đặt phòng. Không sửa database thật. Kiểm tra khi dùng thực tế tại `https://localhost:7203/hotel.html`; Ctrl+F5 để tải assets mới. Lỗi pattern tên đăng nhập của trình duyệt mới được sửa bằng escape dấu gạch ngang; thêm favicon local để không phát sinh yêu cầu favicon.ico thiếu.

## Cập nhật trực tiếp ngày 27/10/2026

Toàn bộ mã tính năng hiện nằm trong chính project này. Không cần giải nén ZIP hay lấy mã từ thư mục .codex.

Đã bổ sung/khôi phục các bản cập nhật: đăng nhập khách bắt buộc trước khi đặt phòng; hồ sơ khách và đổi/quên/đặt lại mật khẩu; thu hồi JWT cũ; giới hạn giá hai chữ số thập phân; transaction cho trạng thái phòng và xóa dịch vụ; JSON lỗi tập trung; menu tài khoản nhân viên; chuông thông báo; tìm booking theo khách/phòng/ngày; dashboard đủ Chờ dọn; báo cáo responsive; tìm phòng có lỗi/Thử lại; chi tiết phòng, nhiều ảnh và tiện nghi. Sóng biển 3D nhẹ được giữ cùng thiết kế/ảnh nền ban đầu.

### Thanh toán QR/tại quầy của project

- Khi sổ thanh toán có khoản thu mới, trang thanh toán báo **“Đã ghi nhận khoản thanh toán mới”**. Hộp thoại dùng loại giao dịch (Đặt cọc/Thanh toán) và phương thức thực tế (Tiền mặt tại quầy/Chuyển khoản ngân hàng); không suy diễn rằng mọi khoản tăng số đã thu đều là SePay xác nhận. Khoản chuyển khoản do lễ tân nhập và khoản qua webhook dùng cùng thông báo trung tính vì API hiện không cung cấp nguồn xác nhận riêng. Chọn trả tại khách sạn chỉ báo đã ghi nhận lựa chọn, số tiền đã thu vẫn 0. Kiểm thử Edge bao gồm khoản thu Cash/Transfer, cả Deposit/Payment, webhook và chọn trả tại quầy.
- Cọc 30%/50% giữ mức tối thiểu 50.000đ nhưng luôn giới hạn bởi số còn phải trả; còn nợ 20.000đ thì cọc tối đa 20.000đ. Cọc tùy chỉnh dùng cùng giới hạn, điều chỉnh về khoảng hợp lệ khi rời ô nhập; nhãn mức cọc, thông tin chuyển khoản, số tiền sao chép và QR dùng cùng số tiền. Không làm tròn số tiền QR vượt dư nợ có phần thập phân. Booking không còn khoản phải thu không tạo QR hoặc cho ghi nhận lựa chọn thanh toán thêm. Khoản cọc cũ không tự mở bảng thành công; chỉ khoản thu mới cập nhật số còn phải trả và thông báo thành công.
- Chuyển khoản chỉ mở khi Admin đã lưu đủ ngân hàng, số tài khoản và tên chủ tài khoản thực tế trong **Quản lý thanh toán → Cấu hình QR & Ngân hàng**. API `bank-config` trả `bankConfigured`; khi chưa cấu hình, cấu hình thiếu hoặc còn nguyên tài khoản mẫu cũ, không trả thông tin nhận tiền/QR và webhook trả 503. Form Admin không điền sẵn tài khoản mẫu. Khách vẫn chọn thanh toán tại khách sạn được; lựa chọn này ghi nhận số tiền đã thu là 0.
- Nếu không tải được cấu hình ngân hàng, trang thanh toán tạm khóa chuyển khoản và giữ lựa chọn thanh toán tại khách sạn. Nếu VietQR hoặc ảnh QR tùy chỉnh lỗi/quá 15 giây, trang hiển thị thông báo cùng nút **Thử tải lại mã QR**, giữ thông tin ngân hàng đã cấu hình để chuyển khoản thủ công; không tạo hình minh họa giả mã QR.
- Kiểm thử API: `dotnet build`, sau đó đặt `HOTEL_PAYMENT_ONLY=1` và chạy `node tests/run-project-checks.mjs`. Có thể thêm `HOTEL_PAYMENT_UI=1` để chạy kiểm thử trình duyệt bằng Playwright/Chromium đã cài (tùy chọn `HOTEL_PLAYWRIGHT_MODULE` trỏ đến thư mục package Playwright, `HOTEL_BROWSER_PATH` trỏ đến Chrome/Edge). Harness dùng dữ liệu tạm; ảnh QR trong kiểm thử được chặn/mô phỏng, không gọi ngân hàng hay VietQR thật.
- Giữ chuyển tới payment.html sau khi tạo booking, liên kết thanh toán trong lịch sử khách, màn quản lý giao dịch và cấu hình ngân hàng.
- Thông tin/trạng thái thanh toán yêu cầu đăng nhập và kiểm tra chủ booking. Admin/Receptionist tiếp tục thao tác theo quyền nhân viên.
- Chọn trả tại quầy ghi số tiền đã thu là 0. Khách không thể tự khai đã chuyển tiền để ghi có; chuyển khoản được ghi nhận qua webhook đã xác thực hoặc lễ tân.
- API công khai không trả khóa SePay. Nhập khóa mới trong Cấu hình QR & Ngân hàng; để trống giữ khóa cũ. Chọn API Key ở cấu hình bảo mật webhook SePay; server kiểm tra Authorization: Apikey theo cùng khóa. Có thể đặt Payments__SepayWebhookKey qua môi trường. Không sử dụng API token truy vấn dịch vụ SePay làm khóa webhook.
- Webhook chỉ ghi khoản thu khi `transferType` là `in`; `out` được trả 200 và bỏ qua, không tạo khoản thu hoặc hoàn tiền. So sánh không phân biệt chữ hoa/thường, nhưng không tự bỏ khoảng trắng. Thiếu trường, `null`, chuỗi rỗng, sai kiểu JSON hoặc giá trị khác trả 400, không thay đổi số dư và không đánh dấu ID giao dịch đã xử lý. Kiểm tra loại giao dịch thực hiện trước nhận diện booking và chống ghi trùng. Payload hợp lệ vẫn cần đúng khóa xác thực, tài khoản nhận và các điều kiện booking/số tiền.

Kiểm thử riêng thanh toán: trong PowerShell đặt `$env:HOTEL_PAYMENT_ONLY="1"` rồi chạy `node tests/run-project-checks.mjs`. Bộ kiểm tra Production/Development bao gồm các loại giao dịch lỗi, giao dịch tiền ra, số dư trước/sau, gửi lại giao dịch và biến thể chữ hoa/thường. Dữ liệu/database riêng, không gọi SePay thật.

### Đối soát chuyển khoản SePay

- Admin và lễ tân mở **Đối soát chuyển khoản** ở menu hoặc từ Quản lý thanh toán. Mặc định hiển thị giao dịch chờ đối soát; có tìm kiếm, lọc trạng thái, phân trang và chi tiết nội dung/ngân hàng/tham chiếu/số tiền.
- Mọi giao dịch tiền vào hợp lệ, đúng khóa và tài khoản nhận được lưu vào `BankTransfers` trong cùng transaction với khoản thu nếu khớp. Webhook chỉ trả `200 success: true` sau khi lưu thành công. Phản hồi có `transferId` và `status`: **Pending** là đã nhận/lưu chờ kiểm tra, **Matched** là đã gắn booking, **Closed** là đã xử lý riêng. Không diễn giải `success` là booking đã được thanh toán.
- Mã booking được nhận diện riêng trong `content`, `description`, `code`, rồi loại trùng theo ID. Có nhiều ID khác nhau (kể cả một ID chưa tồn tại) thì lưu **Pending / AmbiguousBookingCode**, không gợi ý mã đầu tiên và không tự tạo/liên kết khoản thu. Một ID lặp ở nhiều trường, khác chữ hoa/thường hoặc có số 0 ở đầu vẫn là cùng một booking. Không ghép tiền tố ở cuối trường này với số ở trường khác. Mã bằng 0 hoặc vượt giới hạn int được giữ **Pending / InvalidBookingCode**.
- Giao dịch nhiều mã cần xử lý qua **Đối soát chuyển khoản → Gắn booking → Kiểm tra booking** và nhập căn cứ xác minh. Form thu tiền thủ công không tự gắn một receipt đang có nội dung mơ hồ. Sau khi lễ tân đã đối soát, gửi lại webhook chỉ đọc kết quả đã xử lý, không ghi tiền thêm.
- Giao dịch chưa có khoản thu liên kết mà không có mã booking, không tìm thấy booking, booking hủy/đã trả đủ hoặc vượt dư nợ được lưu **Pending**, kèm lý do; không tự cộng tiền, chia khoản chuyển hoặc tự hoàn tiền. Các trường hợp này được acknowledge 200 để tránh SePay gửi lại một giao dịch đã lưu bền vững. Nếu có định danh ngân hàng khớp chính xác khoản lễ tân đã thu, có thể liên kết khoản đó mà không cộng tiền, kể cả booking đã trả đủ.
- Lễ tân bấm **Gắn booking**, nhập mã, bấm **Kiểm tra booking** để xem khách/phòng/dư nợ và các khoản đã thu, chọn **Ghi khoản chuyển mới** hoặc **Liên kết khoản #...**, rồi nhập căn cứ đối soát. Backend kiểm tra lại khi lưu. Ghi khoản mới vẫn phải thỏa trạng thái và dư nợ; liên kết khoản đã thu chỉ cập nhật đối soát, không thu thêm và cho phép booking đã thanh toán đủ/hủy nếu khoản cũ khớp. Thao tác lưu người xử lý, thời gian, ghi chú và audit.
- **Đóng đối soát** dành cho khoản đã xử lý riêng, bắt buộc ghi chú/căn cứ. Đây là ghi nhận kết quả, không gửi lệnh hoàn tiền ngân hàng và không tạo khoản Refund cho booking. Giao dịch vẫn tra được ở trạng thái Đã xử lý riêng.
- ID SePay có unique index, đồng thời khoản thu dùng RequestId `sepay-<id>` duy nhất. Gửi lại cùng giao dịch trả lại kết quả đang có; Pending không tự được gắn lại trên lần retry. Cùng ID nhưng số tiền/nội dung/nhận diện giao dịch thay đổi trả 409, không ghi đè giao dịch gốc. Khóa webhook/Authorization và toàn bộ request headers không được lưu. Khi nhận lại giao dịch đã có khoản thu từ bản cũ, hệ thống liên kết khoản thu tương ứng nếu khớp thay vì thu lần nữa; không tự dựng lại những webhook cũ chưa từng được lưu.
- Migration `AddBankTransferReconciliation` bổ sung bảng/index, giữ nguyên dữ liệu booking và thanh toán. Dừng/chạy lại ứng dụng sau khi build để migration tự áp dụng. Sao lưu dữ liệu trước khi nâng cấp môi trường thật.

Kiểm thử: `node tests/run-bank-reconciliation.mjs` kiểm tra phân quyền, lưu qua restart, gắn/đóng đối soát, trùng ID, số tiền thập phân, xử lý đồng thời, dư nợ và nâng schema có khoản thu cũ. Đặt `HOTEL_RECONCILIATION_UI=1` cùng cấu hình Playwright/Edge để kiểm tra giao diện lễ tân. Harness dùng database tạm. Nếu Visual Studio đang giữ DLL, build riêng bằng `dotnet build HotelManagementAPI.csproj -c Reconciliation /p:UseAppHost=false` rồi đặt `HOTEL_TEST_DLL` đến DLL trong `bin/Reconciliation/net8.0` khi chạy test; không cần dừng phiên đang làm việc để kiểm thử.

Kiểm thử nhiều mã: `node tests/run-ambiguous-bank-codes.mjs`; đặt `HOTEL_AMBIGUOUS_CODES_UI=1` cùng cấu hình Playwright/Edge để kiểm tra cảnh báo và thao tác chọn booking thứ hai. Bao phủ ba trường, thứ tự mã, lặp cùng ID, ID không tồn tại/vượt giới hạn, gửi lại/đồng thời, restart, nhận diện khoản thu thủ công và dữ liệu cũ. Bản sửa này không cần migration mới. Receipt cũ đang Pending cũng được hiển thị cảnh báo và bỏ gợi ý mã đầu tiên; bản ghi đã Matched giữ lịch sử, không tự chuyển/hoàn tiền khi chưa biết booking đúng từ chứng từ.
- Mô phỏng chỉ cho Admin khi môi trường Development và kết nối loopback. Khách, Receptionist, Production không chạy được; nút bị ẩn khi không đủ quyền.
- Giữ vị trí bank-config.json cạnh DLL như bản cũ; Payments__BankConfigFile cho phép chọn nơi lưu khác. Các file bank-config.json được bỏ qua trong Git.

### Chống ghi trùng giữa lễ tân và webhook — 28/10/2026

- Khoản thu Transfer mới yêu cầu đã cấu hình tài khoản nhận. Lễ tân nhập **mã giao dịch ngân hàng chính xác**, không nhập nội dung chuyển khoản hoặc dùng ghi chú chung làm mã. SePay gửi mã này trong `referenceCode`; `code` là mã thanh toán, không được dùng thay thế khi thiếu mã ngân hàng. Xem [payload chính thức SePay](https://docs.sepay.vn/tich-hop-webhooks.html).
- Chống trùng theo ngân hàng, tài khoản nhận và mã tham chiếu (bỏ khoảng trắng đầu/cuối, chuẩn hóa chữ hoa/thường). Mỗi khoản thu chỉ chiếm một định danh ngân hàng; transaction và unique index bảo vệ cả khi nhân viên/webhook chạy đồng thời. Hai giao dịch cùng số tiền nhưng có mã khác nhau vẫn được ghi riêng. Khác ngân hàng/tài khoản cũng được tách riêng.
- Nhập tay 25.000đ rồi webhook đến muộn với cùng định danh và số tiền: liên kết lại khoản thu, tổng vẫn **25.000đ**. Webhook ghi trước rồi lễ tân nhập cùng giao dịch cũng đọc lại khoản đã có. Giao dịch đã có nhưng khác số tiền/booking, nhiều receipt cùng mã, hoặc thông tin cũ chưa đủ nhận diện sẽ bị chặn ghi thêm hoặc giữ **Pending** để đối soát.
- Mỗi thao tác nhập chuyển khoản giữ RequestId và fingerprint nội dung qua `BankPaymentOperations`, kể cả khi trả lại payment đã được webhook tạo. Thử lại đúng nội dung đọc lại kết quả; dùng cùng RequestId cho nội dung khác trả 409. Form giữ ID qua lần thử lại và kiểm tra tài khoản ngân hàng chưa đổi từ lúc mở form.
- Với cảnh báo **Có thể đã thu**, bấm Kiểm tra booking rồi chọn đúng khoản Transfer đã thu để liên kết; số tiền, booking và liên kết trước đó được kiểm tra ở server. Nếu chứng từ xác nhận đây thực sự là giao dịch mới, chọn Ghi khoản chuyển mới và xác nhận **đây là khoản mới chưa được thu**. Không tự ghép dữ liệu cũ chỉ vì số tiền bằng nhau. Các khoản Refund/tiền ra vẫn đi theo quy trình hoàn tiền riêng.
- Migration `AddBankPaymentReferenceIdentity` thêm metadata/index, `AddBankPaymentOperations` thêm bảng thao tác. Dữ liệu cũ giữ nguyên số tiền; metadata cũ để trống để yêu cầu xác minh khi cần. Không tự xóa hoặc điều chỉnh khoản tiền có thể đã bị ghi trùng trước bản sửa. Sao lưu trước khi nâng cấp; dừng/chạy lại ứng dụng để áp dụng migration.

Kiểm thử: `node tests/run-transfer-dedup.mjs` dùng server/database tạm, kiểm tra hai thứ tự nhận, gửi lại, xung đột, đồng thời, phạm vi ngân hàng/tài khoản, hoàn tiền và nâng schema có khoản thu cũ. Đặt `HOTEL_TRANSFER_DEDUP_UI=1` cùng cấu hình Playwright/Edge để kiểm tra form thu tiền và liên kết khoản đã trả đủ. Không gọi ngân hàng/SePay/SMTP thật.

### UUID thanh toán không phân biệt chữ hoa/thường — 28/10/2026

- UUID của thao tác thu/hoàn tiền và lựa chọn trả tại quầy được chuẩn hóa về GUID dạng D chữ thường **trước khi lookup và lưu**. `abcdefab-1234-4567-89ab-abcdefabcdef` và bản viết hoa là cùng một thao tác; thử lại đúng nội dung trả lại payment cũ, không tăng/giảm tiền lần nữa.
- Lookup kiểm tra cả `BookingPayments` và `BankPaymentOperations`. Điều này bảo vệ cả UUID của thao tác nhập tay đã đọc lại khoản thu do webhook tạo. Cùng UUID nhưng đổi booking, số tiền, loại, phương thức hoặc nội dung đã gắn với thao tác trả **409**. UUID mới vẫn là thao tác mới; giao dịch SePay giữ namespace `sepay-<id>` riêng.
- Khóa cũ dạng D được tìm không phân biệt hoa/thường; khóa cũ 32 chữ số có khoảng trắng được nhận diện theo giá trị GUID. Không sửa RequestId cũ hoặc số tiền trong database. Nếu lịch sử đã có nhiều hàng cùng GUID, hoặc UUID ở bảng thao tác và bảng thanh toán trỏ đến khoản khác nhau, API trả **409 yêu cầu đối soát**, không tự chọn/ghép/xóa khoản thu. Các khoản đã bị tính trùng trước bản sửa cần xác minh chứng từ riêng.
- Lookup, kiểm tra nội dung và ghi đều ở trong transaction Serializable. Khóa mới được ghi theo cùng một dạng chuẩn, nên các unique index hiện có cũng chặn cuộc đua giữa yêu cầu viết hoa/thường. Bản sửa không cần migration mới.

Kiểm thử: `node tests/run-payment-uuid.mjs`, tùy chọn `HOTEL_PAYMENT_UUID_UI=1` cùng cấu hình Playwright/Edge. **116 kiểm tra riêng** đạt, gồm Cash/Transfer, hoàn một phần tiền, Direct, gửi lại/đồng thời/restart, webhook alias và dữ liệu cũ xung đột. Edge kiểm chứng mất response sau khi gửi UUID viết hoa đã commit rồi thử lại từ cùng form bằng UUID viết thường: vẫn chỉ một khoản 25.000đ. Hồi quy **2.146 kiểm tra** cùng các bộ Edge thanh toán/đối soát/nhiều mã cũng đạt; tổng **2.262 kiểm tra** được đếm. Dùng dữ liệu/server tạm, không gọi SMTP hoặc ngân hàng thật.

### Chạy và kiểm tra

Mở HotelManagementAPI.csproj trong thư mục này, dừng/chạy lại project với profile https, sau đó Ctrl+F5 trên trình duyệt. Trang khách: https://localhost:7203/hotel.html. JWT cũ cần đăng nhập lại. Ứng dụng tự áp dụng migration thêm bảng RoomPresentations khi bạn chạy; không cần xóa/tạo lại database.

Đã build thành công với 0 lỗi, 0 cảnh báo. Hơn 1.500 kiểm tra API/formatter và kiểm tra Edge cho đăng nhập/đăng ký, gallery, đặt phòng sang thanh toán, hồ sơ/lịch sử, menu tài khoản, thông báo, lọc booking, QR/demo Admin local, sóng 3D, tìm phòng lỗi/Thử lại và báo cáo 320/390/768/1440 px đều đạt trên dữ liệu tạm. Đã thử nâng cấp schema cũ với dữ liệu giả; không chạy migration hoặc thử giao dịch trên database thật. Không gọi ngân hàng/SePay hay SMTP thật.

Kiểm thử tự động sau dotnet build:

    node tests/run-project-checks.mjs
    node tests/run-api-errors.mjs

Các bộ kiểm thử dùng server/database tạm, không dùng hotel.db của project. run-project-checks.mjs hỗ trợ HOTEL_TEST_LEGACY_SQL trỏ tới SQL của bốn migration cũ để kiểm tra nâng cấp có dữ liệu giả. Gửi email local dùng .eml trong Development; SMTP thật và giao dịch SePay thật vẫn cần cấu hình/kiểm chứng ở môi trường triển khai.

## Trang tài khoản và đặt phòng của khách hàng

Sau khi đăng nhập trên trang khách sạn, bấm **Đặt phòng của tôi** để mở `/customer.html#bookings`. Giao diện theo bố cục tài khoản/mua hàng: menu cá nhân bên trái, tab trạng thái phía trên và danh sách thẻ đặt phòng, nền sáng, ảnh phòng nhỏ, tổng tiền và các thao tác ở cuối thẻ. Không có trang Tổng quan hoặc các ô thống kê kiểu quản trị. Liên kết cũ `#overview` vẫn mở danh sách đặt phòng.

Các tab gồm Tất cả, Chờ nhận phòng, Đang lưu trú, Đã trả phòng, Đã hủy. Có tìm theo mã/số phòng, bộ lọc khoảng ngày thu gọn và phân trang; chi tiết lưu trú, dịch vụ, thanh toán và khoản cần hoàn; thanh toán QR/tại quầy và hóa đơn In/PDF; gửi/theo dõi yêu cầu đổi/hủy; hồ sơ, đổi mật khẩu và đăng xuất. Yêu cầu đổi/hủy chỉ dành cho booking chưa check-in và chưa có yêu cầu chờ xử lý; lễ tân tiếp tục duyệt theo quy trình hiện có.

Các API CustomerPortal/summary, CustomerPortal/bookings và CustomerPortal/bookings/{id} chỉ dành cho vai trò Customer và luôn tự lấy CustomerId từ JWT. Người dùng không thể chọn customerId khác để xem booking; booking người khác trả 404. Màn hình đăng nhập hiện khi mở trang trực tiếp mà chưa có phiên. Đăng xuất/hết phiên xóa dữ liệu đang hiển thị; không có token trong URL.

Trang thanh toán và hóa đơn có liên kết quay về Booking của tôi. Các form hồ sơ/mật khẩu và yêu cầu được dùng chung với trang khách hiện có. Không thay đổi schema/database cho tính năng này.

Đã chạy 59 kiểm tra API riêng trong tests/customer-portal.mjs và hồi quy qua node tests/run-project-checks.mjs. Đã thử Edge với login, điều hướng từ Booking của tôi, danh sách/phân trang/lọc, hóa đơn, yêu cầu đổi/hủy, cập nhật hồ sơ, đổi mật khẩu/đăng nhập lại, chặn booking người khác, lỗi/Thử lại, logout và các màn hình 320/390/768/1440 px; tất cả dùng dữ liệu tạm.

Chạy `node tests/run-customer-portal-ui.mjs` để kiểm tra bố cục bằng Playwright/Edge và chạy kèm 59 kiểm tra API. Có thể đặt `HOTEL_PLAYWRIGHT_MODULE` đến thư mục module Playwright, `HOTEL_BROWSER_PATH` đến trình duyệt và `HOTEL_UI_SCREENSHOTS` đến thư mục xuất ảnh. Harness tạo server/database riêng, không dùng tài khoản thật hoặc gửi SMTP. Kiểm tra bao gồm tab trạng thái, reset phân trang khi đổi tab, tìm kiếm, chi tiết, gửi yêu cầu, hồ sơ, hóa đơn, lỗi/Thử lại và bố cục 320/390/768/1440 px.

Điều hướng khách hàng dùng liên kết trực tiếp tới trang customer.html có phiên bản giao diện trên URL, không gọi hộp thoại lịch sử cũ. HTML/JavaScript/CSS được revalidate với Cache-Control: no-cache để nhận file cập nhật; ảnh/font vẫn giữ cơ chế cache. Phiên khách hàng được giữ trong cùng tab. Nếu đang chạy phiên ứng dụng cũ, dừng/chạy lại đúng project này và tải lại trang.


### Giữ chỗ 30 phút và thông báo khách hàng

Booking do khách tạo mới qua website có 30 phút để thanh toán cọc. Hạn được lưu theo UTC và hiển thị đếm ngược trên danh sách, chi tiết booking và trang thanh toán. Khi chưa ghi nhận khoản Deposit/Payment dương, hết hạn thì booking tự hủy, yêu cầu đổi/hủy đang chờ bị từ chối và phòng có thể được đặt lại. Tác vụ nền kiểm tra mỗi 15 giây; kiểm tra lịch trống và ghi tiền vẫn bảo vệ tại thời điểm thao tác. Khoản cọc đã nhận giữ booking, kể cả cọc một phần. Chọn trả tại quầy (Direct, 0 đồng) không kéo dài hạn. Booking giữ chỗ cần ghi nhận cọc trước khi check-in. Đổi ngày không đặt lại đồng hồ 30 phút.

Migration không thêm hạn vào booking cũ hoặc booking lễ tân tạo. Phòng miễn phí không yêu cầu thanh toán. Chuyển khoản đến sau khi hết hạn được lưu chờ đối soát, không tự khôi phục booking đã hủy. Lễ tân cần kiểm tra phòng và xử lý đặt mới/hoàn tiền riêng.

Chuông trên trang khách sạn và trang tài khoản khách hiển thị tối đa 100 thông báo gần nhất: hạn thanh toán, nhắc dưới 5 phút, hết hạn, khoản thu/hoàn tiền đã ghi nhận, kết quả yêu cầu đổi/hủy. Nội dung lấy từ giao dịch và yêu cầu đã lưu; mã nguồn sự kiện ổn định không nhân đôi khi gửi lại. Trạng thái đã đọc lưu trong SQLite theo từng hồ sơ khách, giữ qua đăng xuất và khởi động lại. Không gửi email, push trình duyệt hoặc xác nhận ngân hàng giả. Giao diện cập nhật thông báo mỗi 15 giây khi trang đang mở.

Kiểm thử riêng: node tests/run-booking-holds.mjs. Dùng server/database tạm; đặt HOTEL_TEST_DLL nếu build cấu hình riêng. Có thể bật kiểm thử Edge bằng HOTEL_PLAYWRIGHT_MODULE và HOTEL_BROWSER_PATH, xuất ảnh bằng HOTEL_UI_SCREENSHOTS. Bộ này kiểm tra hết hạn, trả phòng về lịch trống, tiền đến muộn, bảo vệ cọc, Direct, quyền sở hữu thông báo, đọc lại không trùng, khởi động lại, nâng schema có dữ liệu và đồng hồ thiết bị sai giờ.


Trang thanh toán hiển thị thời hạn ở khung đầu trang cùng nút hủy. Booking cũ hoặc lễ tân tạo không có hạn tự hủy và được giải thích rõ; không phát sinh đồng hồ 30 phút khi chỉ mở lại trang. Khách sở hữu booking Reserved chưa có khoản thu dương có thể hủy giữ chỗ sau xác nhận, bao gồm khi đã chọn Direct 0 đồng. Hủy và thu tiền dùng giao dịch SQLite nối tiếp: nếu tiền đến trước, API từ chối hủy ngay và yêu cầu khách gửi yêu cầu hủy cho lễ tân. Booking có cọc sử dụng quy trình duyệt đổi/hủy hiện có; không tự hoàn tiền. Gửi lại yêu cầu hủy giữ chỗ đã thành công không ghi thêm khoản tiền hoặc nhân đôi hành động. Chuyển khoản đến sau khi hủy vẫn được lưu chờ đối soát.

Kiểm thử: node tests/run-payment-cancellation.mjs dùng database/server riêng, kiểm tra quyền sở hữu, Direct, hủy lại, trả phòng về lịch trống, tiền đến muộn, 12 cặp hủy/thu tiền đồng thời và Edge desktop/mobile khi có cấu hình trình duyệt.


### Kênh liên hệ công khai

Trang chủ (mục Liên hệ), trang khách hàng và trang thanh toán dùng chung GET /api/HotelContact để hiển thị nút gọi lễ tân, gửi email và mở Facebook. Trang thanh toán vẫn hiển thị phần hỗ trợ khi chưa đăng nhập hoặc không tải được booking. Không gửi email/tin nhắn tự động khi mở trang; số điện thoại, email và liên kết chỉ được dùng khi khách bấm nút.

Thông tin hiện tại được chủ project cho phép công khai trong appsettings.json, mục HotelContact. Có thể thay bằng biến môi trường Render HotelContact__Phone, HotelContact__Email, HotelContact__FacebookUrl. Các trường này tách khỏi CustomerEmail:Smtp và không đọc thông tin cá nhân từ hồ sơ khách. Đường dẫn Facebook chỉ nhận HTTPS đúng host Facebook; số gọi và email được chuẩn hóa. Cấu hình trống hoặc không hợp lệ không tạo nút giả; lỗi tải có nút thử lại.

Các trường HotelContact được lưu trong gói sao lưu đầy đủ và nạp lại khi phục hồi. Kiểm thử: node tests/run-hotel-contact.mjs và node tests/run-full-backup.mjs. Bộ UI kiểm tra desktop/mobile, liên kết chính xác, tình huống API lỗi và không nhúng URL chạy JavaScript; không thực hiện cuộc gọi, gửi mail hoặc gửi tin Facebook.


### Số khách theo sức chứa phòng

Bộ chọn khách trên website lấy giới hạn từ GET /api/Bookings/guest-options, dựa trên sức chứa lớn nhất trong danh mục phòng (giới hạn hợp lệ 1–100 khách/phòng). Có phòng 20 khách thì chọn được từ 1 đến 20, không còn cố định 4 khách. Đây là sức chứa danh mục; tình trạng trống vẫn được kiểm tra theo ngày và số khách qua available-rooms. Khi danh mục chưa có phòng, bộ chọn dùng mức tối thiểu 1 khách.

Mỗi lần tìm phòng, website cập nhật lại giới hạn và giữ nguyên số khách đã chọn. Nếu quản trị giảm sức chứa xuống dưới số khách đang chọn, giao diện yêu cầu chọn lại thay vì tự giảm nhóm 20 người thành ít người hơn. Lỗi tải giới hạn có thông báo và nút thử lại. API tạo booking vẫn kiểm tra số khách với sức chứa từng phòng. Không đổi sức chứa phòng hoặc booking hiện có khi triển khai tính năng.

Kiểm thử: node tests/run-guest-capacity.mjs. Có thể bật Edge với HOTEL_PLAYWRIGHT_MODULE và HOTEL_BROWSER_PATH. Bộ này kiểm tra nhóm 5–20 người, giới hạn 100, phòng nhỏ bị loại, gửi vượt sức chứa bị từ chối, desktop/mobile, cập nhật danh mục, lỗi mạng/thử lại và luồng tạo booking đủ 20 khách trên database riêng.


API GET /api/Bookings/available-rooms từ chối ngày nhận phòng trước hôm nay của khách sạn bằng HTTP 400 với thông báo Ngày nhận phòng không thể ở trong quá khứ. Ngày được xác định bằng TimeProvider và Hotel:TimeZone, thống nhất với API tạo booking và giao diện tìm phòng. Ngày nhận hôm nay và trong tương lai vẫn được xử lý bình thường; các bộ lọc lịch sử booking không bị thay đổi. Không cần migration dữ liệu.

Kiểm thử riêng: node tests/run-availability-dates.mjs. Dùng server/database tạm với múi giờ Việt Nam, UTC+14 và UTC-12; kiểm tra ngày quá khứ, khoảng bắt đầu hôm qua nhưng kết thúc tương lai, ngày hôm nay/tương lai, khách chưa đăng nhập/khách hàng/nhân viên, đối chiếu chặn tạo booking và xác nhận không phát sinh booking hoặc khoản thu.

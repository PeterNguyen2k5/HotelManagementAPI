# Triển khai Docker

Stack gồm ứng dụng .NET 8 chạy bằng user `app`, Caddy làm reverse proxy HTTPS, và Prometheus tùy chọn. Chỉ Caddy công khai cổng 80/443; ứng dụng dùng cổng 8080 trong mạng Docker. Một instance ứng dụng dùng SQLite và named volume `hotel_data`.

## Chuẩn bị và chạy

1. Cài Docker Engine/Desktop với Docker Compose v2. Trỏ DNS của tên miền về máy chủ và mở 80/TCP, 443/TCP (443/UDP tùy chọn cho HTTP/3).
2. Sao chép `.env.example` thành `.env`; đặt `HOTEL_DOMAIN` thành tên miền thật, `ACME_EMAIL` thành email vận hành. Mặc định múi giờ `Asia/Ho_Chi_Minh`. Nếu subnet trùng mạng hiện có, đổi đồng thời `HOTEL_SUBNET`, `HOTEL_APP_IP`, `HOTEL_PROXY_IP`.
3. Tạo `deploy/secrets/bootstrap_admin_password.txt`: chỉ chứa mật khẩu khởi tạo do bạn chọn, tối thiểu 12 ký tự, tối đa 72 byte UTF-8. Tạo `deploy/secrets/monitoring_key.txt` chứa khóa ngẫu nhiên dài ít nhất 32 ký tự (ví dụ `openssl rand -hex 32`). Hai file dùng UTF-8 không BOM, được bỏ qua trong Git và Docker build context. Không đặt mật khẩu trong `.env`, Dockerfile hoặc command line. Giới hạn quyền đọc các file này trên máy chủ.
   Trên Linux, Compose mount secret từ file và giữ quyền file của host. User `app` và Prometheus cần đọc được file; đặt thư mục cha chỉ cho tài khoản triển khai truy cập, file bên trong cho phép đọc khi mount:

   ```sh
   chmod 700 deploy/secrets
   chmod 444 deploy/secrets/bootstrap_admin_password.txt deploy/secrets/monitoring_key.txt
   ```

   Không dùng file `600` thuộc root rồi chạy ứng dụng bằng user `app`; cấu hình đó sẽ lỗi quyền đọc. Với Docker Desktop trên Windows, giới hạn ACL của thư mục secret cho tài khoản triển khai và kiểm tra quyền đọc trong container.

4. Kiểm tra và khởi chạy từ thư mục project:

```sh
docker compose config --quiet
docker compose build --pull
docker compose up -d
docker compose ps
docker compose logs --tail=100 hotel proxy
```

Với tên miền DNS/cổng đã sẵn sàng, Caddy cấp/gia hạn chứng chỉ và chuyển HTTP sang HTTPS. Đăng nhập `admin` bằng mật khẩu khởi tạo và đổi mật khẩu bắt buộc. File khởi tạo không ghi đè tài khoản có sẵn. Mẫu Compose vẫn mount file này nên giữ file hoặc gỡ khai báo secret khỏi Compose sau khi hoàn tất khởi tạo.

Cấu hình này dành cho truy cập trực tiếp Internet → Caddy → ứng dụng. Nếu thêm Cloudflare/load balancer phía trước, cần cấu hình chuỗi proxy và địa chỉ tin cậy tương ứng; không bật tùy chọn tin mọi địa chỉ. Ứng dụng chỉ xử lý một bộ `X-Forwarded-For`/`X-Forwarded-Proto` từ đúng IP Caddy. Host công khai được giới hạn theo `HOTEL_DOMAIN`. Không publish cổng 8080 ra ngoài.

## Dữ liệu bền vững và di chuyển từ bản local

Volume `hotel_data` tại `/var/lib/hotel` chứa database, `jwt.key`, `data-protection-keys`, `App_Data/backups`, `App_Data/room-images`, và cấu hình ngân hàng. Mã ứng dụng/static assets ở `/app`, tách khỏi dữ liệu để nâng cấp image.

Nếu chuyển dữ liệu cũ, dừng ứng dụng cũ và sao chép `hotel.db`, `jwt.key`, `data-protection-keys`, toàn bộ `App_Data` vào volume trước khi chạy ứng dụng mới. File ngân hàng của bản local có thể nằm trong `bin/Debug/net8.0/bank-config.json`; sao chép thành `/var/lib/hotel/bank-config.json`. Giữ quyền sở hữu UID/GID 1654 của user `app`. Không chép database khi còn yêu cầu ghi hoặc bỏ sót file WAL. Không thay ngày/giờ lịch sử bằng việc đổi múi giờ; cấu hình múi giờ phải phù hợp dữ liệu khách sạn đã ghi trước đó.

Trên Linux, cấp quyền đúng cho thư mục bind mount nếu thay named volume bằng bind mount. Named volume mới nhận quyền từ thư mục đã tạo trong image. Gói ZIP đầy đủ trong ứng dụng hiện chứa database, ảnh, khóa và cấu hình vận hành được chọn; file .db cũ chỉ có SQLite. `docker compose down` giữ volume; `down -v` xóa dữ liệu.

## Sao lưu, retention và bản sao ngoài máy

Mặc định giữ 14 ngày và tối đa 30 bản, luôn bảo vệ gói đầy đủ đã xác minh. Compose cho chỉnh `HOTEL_BACKUP_RETENTION_DAYS` và `HOTEL_BACKUP_MAX_COUNT` trong `.env`. Gói chứa khóa và mật khẩu SMTP nếu có; phải bảo vệ như dữ liệu bí mật. Xem [hướng dẫn tạo, kiểm tra và phục hồi](../BACKUP-RESTORE-2026-10-28.md).

Tùy chọn sao tự động sang thư mục dành riêng trên ổ/NAS ngoài máy: mount ổ đó trên host, tạo thư mục rỗng, cấp quyền ghi cho UID/GID 1654. Đặt `HOTEL_BACKUP_REPLICA_PATH` trong `.env` thành đường dẫn tuyệt đối của thư mục đã tồn tại. Không trỏ vào thư mục chia sẻ có dữ liệu khác. Sau đó dùng cùng hai file Compose cho các lệnh vận hành:

```sh
docker compose -f compose.yaml -f compose.backup.yaml config --quiet
docker compose -f compose.yaml -f compose.backup.yaml up -d --build
```

Ứng dụng kiểm tra gói đã sao trước khi đổi tên, tự dọn bản cũ tại cả hai vị trí; đánh dấu thư mục bằng `.hotel-backup-replica`. Nơi lưu không truy cập được sẽ báo lỗi, giữ backup cục bộ trong giới hạn rồi thử lại ở lần bảo trì sau. Nếu mount thực chất ở cùng máy, tính năng chỉ tạo bản sao thứ hai, chưa bảo vệ trước mất máy chủ. Mẫu không tự đăng ký dịch vụ cloud hay lưu khóa truy cập NAS.

Phục hồi Docker: dừng dịch vụ chính khi chuyển dữ liệu; chạy CLI trong một container dùng cùng image với thư mục cha phục hồi ghi được bởi user `app`, đọc ZIP từ mount riêng. Ví dụ khi `/srv/hotel-restore` đã tồn tại, rỗng và thuộc UID 1654, `/srv/hotel-archives` chứa ZIP:

```sh
docker compose run --rm --no-deps -v /srv/hotel-restore:/restore -v /srv/hotel-archives:/archives:ro hotel --restore-backup /archives/hotel-TEN_GOI.zip --restore-target /restore/data
```

Thay tên gói thật. Đích `/restore/data` phải chưa tồn tại. Sau kiểm chứng trong môi trường riêng, dùng Compose override để mount `/srv/hotel-restore/data` vào `/var/lib/hotel`, giữ bản nguồn cho đến nghiệm thu. Cấu hình env/secret của Compose có ưu tiên cao hơn snapshot; kiểm tra múi giờ, SMTP, tên miền và key file trước khi khởi động. Nếu đổi monitoring key, cập nhật cả secret của Prometheus. Không sao chép riêng file SQLite đang mở hoặc bỏ qua WAL; dùng gói tạo qua Online Backup API.

## Health check

- `GET /health/live`: 200 nếu tiến trình còn xử lý HTTP; không truy vấn database.
- `GET /health/ready`: 200 khi đọc được schema ứng dụng và tạo/xóa được file thử trong vùng dữ liệu; lỗi trả 503. Response chỉ có trạng thái, không lộ đường dẫn/SQL/exception.
- Docker HEALTHCHECK dùng `dotnet HotelManagementAPI.dll --healthcheck`, gọi readiness qua HTTP nội bộ. Probe được miễn chuyển HTTPS, không yêu cầu JWT. HTTPS và xác thực vẫn áp dụng cho nghiệp vụ.

```sh
curl -fsS https://TEN_MIEN_CUA_BAN/health/live
curl -fsS https://TEN_MIEN_CUA_BAN/health/ready
docker compose exec hotel dotnet HotelManagementAPI.dll --healthcheck
```

Docker đánh dấu container `unhealthy` khi probe thất bại; chính sách `unless-stopped` chỉ tự khởi động lại khi tiến trình thoát. Dùng cảnh báo readiness để xử lý sự cố lưu trữ thay vì liên tục restart một database hỏng.

## Giám sát lỗi

```sh
docker compose --profile monitoring up -d
```

Prometheus ở `http://127.0.0.1:9090` trên máy chủ, chỉ bind loopback. Có thể truy cập từ xa bằng SSH tunnel. Không công khai dashboard hoặc bật publish `/metrics` qua proxy.

Prometheus scrape `http://hotel:8080/metrics` bằng Bearer key từ Docker secret; Caddy chặn `/metrics` công khai. HTTP nội bộ được miễn redirect cho endpoint này; thiếu/sai key trả 401, chưa cấu hình key trả 404. Key được so sánh theo thời gian cố định và không xuất trong log/metrics.

Metrics gồm số yêu cầu API theo nhóm HTTP status, thời gian xử lý, lỗi sao lưu/gửi email khôi phục, lần sao lưu thành công gần nhất và readiness. Không gắn email, tên khách, URL/query, nội dung request, token hoặc ID booking vào label. Counter tính từ lần khởi động; Prometheus xử lý reset counter khi restart. `deploy/alerts.yml` có cảnh báo ứng dụng không truy cập được/readiness lỗi, từ 3 lỗi API 5xx/5 phút, lỗi tác vụ nền và sao lưu cũ quá 26 giờ.

Cảnh báo xem tại trang Alerts của Prometheus. Chưa cấu hình gửi email/Slack: muốn nhận thông báo ngoài hệ thống cần nối Alertmanager và khai báo người nhận phù hợp. Không có tài khoản/dịch vụ ngoài nào được tự động kết nối.

Ứng dụng ghi JSON log ra stdout, timestamp UTC để tổng hợp giữa container, kèm trace ID cho lỗi API. Lỗi gửi email chỉ ghi cảnh báo chung; lỗi sao lưu ghi loại exception, không ghi thông tin nhạy cảm. Docker giới hạn log mỗi container 5 file × 10 MB. Khi khách gửi mã hỗ trợ, tra bằng:

```sh
docker compose logs hotel | grep 'MA_HO_TRO'
```

## Cấu hình bổ sung

- `Deployment__RequireHttps`: mặc định bật ngoài Development. Chỉ tắt rõ ràng cho server kiểm thử HTTP riêng.
- `ReverseProxy__Enabled`, `ReverseProxy__KnownProxies__0`: bật và nhập IP proxy chính xác; bật mà không khai báo proxy sẽ dừng khởi động. Không bật `ASPNETCORE_FORWARDEDHEADERS_ENABLED` để bỏ qua danh sách tin cậy.
- `Hotel__TimeZone`: IANA zone như `Asia/Ho_Chi_Minh`. Sai ID dừng khởi động. Ngày booking, check-in/out, thông báo, timestamp mới, audit và lịch sao lưu dùng cùng đồng hồ; JWT/link khôi phục vẫn tính thời hạn theo UTC. Giao diện lấy múi giờ qua `/api/HotelConfiguration` để chọn đúng ngày dù máy khách ở nước khác.
- `Storage__DataDirectory`: đường dẫn tuyệt đối đến dữ liệu có quyền ghi; Docker mặc định `/var/lib/hotel`. `Payments__BankConfigFile` trỏ đến file cấu hình ngân hàng trong volume.
- `Monitoring__ScrapeKeyFile`/`Monitoring__ScrapeKey`: file secret hoặc biến môi trường cho khóa scrape. Nếu dùng file thì file được ưu tiên.
- `BootstrapAdmin__PasswordFile`/`BootstrapAdmin__Password`: tương tự cho mật khẩu khởi tạo, chỉ được đọc khi chưa có nhân viên.
- SMTP/SePay: tiếp tục cấu hình như README chính. Compose đặt `CustomerEmail__PublicBaseUrl` theo tên miền HTTPS, nhưng không điền sẵn tài khoản SMTP hay khóa webhook. Không chỉnh logging lên mức chứa body/header hoặc bật EF sensitive-data logging.

Image mặc định dùng nhánh .NET 8/Caddy 2 và Prometheus latest. Để triển khai lặp lại chính xác, pin các image thành digest đã kiểm thử trong hạ tầng của bạn. Cập nhật image, backup volume rồi `docker compose up -d --build` để nâng cấp.

## Kiểm thử trước khi đưa lên máy chủ

```sh
dotnet build
node tests/run-deployment.mjs
node tests/run-project-checks.mjs
node tests/run-api-errors.mjs
node tests/run-full-backup.mjs
```

`run-deployment.mjs` dùng root dữ liệu/database/secret riêng để kiểm tra HTTPS và proxy tin cậy, rate limit theo IP, múi giờ/timestamp, readiness, metrics và lỗi thật. Máy không có Docker vẫn kiểm tra được ứng dụng; cần chạy các bước sau trên máy có Docker để xác nhận image và cấu hình container:

```sh
docker compose config --quiet
docker compose run --rm --no-deps proxy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker compose --profile monitoring run --rm --no-deps --entrypoint promtool prometheus check config /etc/prometheus/prometheus.yml
docker compose build
docker compose --profile monitoring up -d
```

Các kiểm tra local không thay thế việc xác nhận DNS, chứng chỉ công khai, quyền volume Linux, gửi SMTP thật hay nhận webhook SePay trên hạ tầng triển khai.

Tham khảo chính thức: [Microsoft — proxy/forwarded headers](https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/proxy-load-balancer?view=aspnetcore-8.0), [Microsoft — health checks](https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/health-checks?view=aspnetcore-8.0), [Caddy — automatic HTTPS](https://caddyserver.com/docs/automatic-https), [Prometheus — configuration](https://prometheus.io/docs/prometheus/latest/configuration/configuration/), [Docker — quyền của secret từ file](https://docs.docker.com/reference/compose-file/services/#long-syntax-5).


Kênh liên hệ khách sạn: cấu hình HotelContact__Phone, HotelContact__Email và HotelContact__FacebookUrl trên Render hoặc biến môi trường container để thay thông tin công khai. Nếu không ghi đè, ứng dụng dùng HotelContact trong appsettings.json. Không dùng mật khẩu SMTP hoặc SePay làm giá trị các trường này. GET /api/HotelContact chỉ trả thông tin công khai đã kiểm tra định dạng. Thông tin được đưa vào recovery-settings.json của gói sao lưu để phục hồi cùng ứng dụng.


Ứng dụng tự gắn CSP, chống iframe và nosniff. HSTS (180 ngày, không preload/subdomain) được phát trên HTTPS production sau bước xử lý ForwardedHeaders; proxy cần cung cấp scheme chính xác theo cấu hình tin cậy hiện có. Kiểm tra bằng curl -I https://TEN-MIEN/hotel.html và chạy node tests/run-security-headers.mjs trước khi cập nhật cấu hình Swagger hoặc nguồn script. CSP cho phép ảnh HTTPS để QR hoạt động; không cần thêm domain ngoài vào script-src.

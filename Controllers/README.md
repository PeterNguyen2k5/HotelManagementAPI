# Bản đồ Controller

Mở một trong **6 nhóm nghiệp vụ** sau trong Solution Explorer:

| Thư mục | Controller | Trách nhiệm |
| --- | --- | --- |
| `Authentication` | `Auth`, `CustomerAuth` | Đăng nhập nhân viên/khách, tài khoản và mật khẩu |
| `Rooms` | `Rooms`, `RoomTypes`, `RoomPresentation`, `Housekeeping` | Phòng, hạng phòng, nội dung/ảnh và dọn phòng |
| `Bookings` | `Bookings`, `BookingRequests` | Đặt phòng, check-in/check-out, yêu cầu đổi/hủy |
| `Payments` | `BookingOperations`, `BankTransfers` | Thu/hoàn tiền, hóa đơn, SePay và đối soát |
| `Customers` | `Customers`, `CustomerPortal`, `CustomerNotifications`, `HotelContact` | Hồ sơ khách, booking cá nhân, thông báo và liên hệ |
| `Operations` | `Services`, `Users`, `Reports`, `Administration`, `Notifications` | Dịch vụ, nhân viên, báo cáo, sao lưu và thông báo nhân viên |

Các tên trong bảng được viết ngắn, bỏ hậu tố `Controller`. Thư mục chỉ giúp tìm mã nguồn; quyền truy cập vẫn do `[Authorize]` tại từng Controller/action quyết định.

Vẫn có **19 Controller**. Tên lớp, namespace `HotelManagementAPI.Controllers`, route, phân quyền và nội dung C# được giữ nguyên. ASP.NET Core tìm Controller trong assembly; URL không phụ thuộc thư mục chứa file. Ví dụ `Controllers/Rooms/RoomsController.cs` vẫn nhận `GET /api/Rooms`.

Thứ tự đọc để vấn đáp: **Auth → Rooms → Bookings → BookingOperations**, sau đó mở các phần bổ trợ khi được hỏi.

Xem [tài liệu vấn đáp API](../docs/VAN-DAP-API.md) để có sơ đồ, ví dụ CRUD và câu hỏi trả lời theo mã nguồn.

using System.Text.Json;
using HotelManagementAPI.Data;
using HotelManagementAPI.Models;
using Microsoft.EntityFrameworkCore;

namespace HotelManagementAPI.Services;

public static class DemoRoomCatalog
{
    // Called only by the Admin endpoint inside its serializable transaction.
    public static async Task<bool> CreateWhenEmpty(HotelDbContext db, CancellationToken token)
    {
        if (await db.Rooms.AnyAsync(token)) return false;
        var definitions = new[]
        {
            new { Name = "Standard (mẫu)", Price = 450000m, Capacity = 2, Area = 24d, Beds = "1 giường đôi", Floor = 1,
                Amenities = new[] { "Wi-Fi", "Điều hòa", "Phòng tắm riêng", "Bàn làm việc" } },
            new { Name = "Deluxe (mẫu)", Price = 750000m, Capacity = 2, Area = 32d, Beds = "1 giường đôi lớn", Floor = 2,
                Amenities = new[] { "Wi-Fi", "Điều hòa", "Phòng tắm riêng", "Ban công", "Máy sấy tóc" } },
            new { Name = "Family (mẫu)", Price = 1100000m, Capacity = 4, Area = 45d, Beds = "2 giường đôi", Floor = 3,
                Amenities = new[] { "Wi-Fi", "Điều hòa", "Phòng tắm riêng", "Tủ lạnh nhỏ", "Khu vực tiếp khách" } }
        };
        foreach (var definition in definitions)
        {
            var type = await db.RoomTypes.FirstOrDefaultAsync(x => x.Name == definition.Name, token);
            if (type is null)
            {
                type = new RoomType { Name = definition.Name, Description = "Hạng phòng mẫu để trải nghiệm website; cần chỉnh lại theo khách sạn thực tế." };
                db.RoomTypes.Add(type);
            }
            for (var number = 1; number <= 2; number++)
            {
                var description = "Dữ liệu mẫu dùng để trải nghiệm website. Giá, diện tích và tiện nghi là thông tin minh họa; hãy chỉnh lại trước khi nhận đặt phòng thực tế.";
                var room = new Room
                {
                    RoomNumber = $"M{definition.Floor}0{number}", RoomType = type, Price = definition.Price,
                    Capacity = definition.Capacity, Status = RoomStatus.Available, Description = description
                };
                db.Rooms.Add(room);
                db.RoomPresentations.Add(new RoomPresentation
                {
                    Room = room, Description = description, Beds = definition.Beds, Area = definition.Area,
                    AmenitiesJson = JsonSerializer.Serialize(definition.Amenities), ImagesJson = "[]"
                });
            }
        }
        await db.SaveChangesAsync(token);
        return true;
    }
}

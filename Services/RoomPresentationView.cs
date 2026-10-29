using System.Text.Json;
using HotelManagementAPI.Models;

namespace HotelManagementAPI.Services;

public static class RoomPresentationView
{
    public static string Placeholder(int roomId, int view = 1) =>
        $"/images/room-illustrations/room-{(roomId % 3 + 3) % 3 + 1}-{view}.svg";

    public static object Create(Room room, RoomPresentation? content)
    {
        var images = content is null ? [] : JsonSerializer.Deserialize<string[]>(content.ImagesJson) ?? [];
        var amenities = content is null ? [] : JsonSerializer.Deserialize<string[]>(content.AmenitiesJson) ?? [];
        return new
        {
            room.Id, room.RoomNumber, room.RoomTypeId, roomTypeName = room.RoomType?.Name ?? "",
            room.Price, room.Capacity, description = content?.Description ?? room.Description,
            content?.Beds, content?.Area, amenities, images,
            gallery = images.Length > 0 ? images : new[] { Placeholder(room.Id), Placeholder(room.Id, 2) },
            isIllustration = images.Length == 0
        };
    }
}

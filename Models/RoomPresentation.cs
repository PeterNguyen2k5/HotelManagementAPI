using System.ComponentModel.DataAnnotations;

namespace HotelManagementAPI.Models;

public sealed class RoomPresentation
{
    public int RoomId { get; set; }
    public Room Room { get; set; } = null!;
    [MaxLength(4000)] public string? Description { get; set; }
    [MaxLength(100)] public string? Beds { get; set; }
    public double? Area { get; set; }
    public string AmenitiesJson { get; set; } = "[]";
    public string ImagesJson { get; set; } = "[]";
}

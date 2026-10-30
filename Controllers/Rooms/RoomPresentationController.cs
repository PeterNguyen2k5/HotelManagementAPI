using System.Text.Json;
using System.Text.RegularExpressions;
using HotelManagementAPI.Data;
using HotelManagementAPI.DTOs;
using HotelManagementAPI.Models;
using HotelManagementAPI.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace HotelManagementAPI.Controllers;

[ApiController, Route("api/RoomPresentation"), Authorize(Roles = Roles.Admin)]
public sealed partial class RoomPresentationController(HotelDbContext db, HotelStorage storage) : ControllerBase
{
    private const int MaxImageBytes = 5 * 1024 * 1024;

    private string Folder(int roomId) => Path.Combine(storage.Root, "App_Data", "room-images", roomId.ToString());
    private static string ImageUrl(int roomId, string file) => $"/api/RoomPresentation/{roomId}/images/{file}";

    [HttpGet("{roomId:int}"), AllowAnonymous]
    public async Task<IActionResult> Get(int roomId)
    {
        var room = await db.Rooms.AsNoTracking().Include(x => x.RoomType).FirstOrDefaultAsync(x => x.Id == roomId);
        if (room is null) return NotFound();
        var content = await db.RoomPresentations.AsNoTracking().FirstOrDefaultAsync(x => x.RoomId == roomId);
        Response.Headers.CacheControl = "no-store";
        return Ok(RoomPresentationView.Create(room, content));
    }

    [HttpPut("{roomId:int}")]
    public async Task<IActionResult> Save(int roomId, RoomPresentationSave request)
    {
        try
        {
            await using var tx = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable);
            var room = await db.Rooms.Include(x => x.RoomType).FirstOrDefaultAsync(x => x.Id == roomId);
            if (room is null) return NotFound();
            var images = request.Images.Distinct(StringComparer.Ordinal).ToArray();
            foreach (var image in images)
            {
                var file = image.StartsWith(ImageUrl(roomId, ""), StringComparison.Ordinal) ? image[ImageUrl(roomId, "").Length..] : "";
                if (!ImageName().IsMatch(file) || !System.IO.File.Exists(Path.Combine(Folder(roomId), file)))
                    return BadRequest(new { message = "Chỉ dùng ảnh đã tải lên cho đúng phòng này." });
            }
            var content = await db.RoomPresentations.FirstOrDefaultAsync(x => x.RoomId == roomId);
            if (content is null) { content = new RoomPresentation { RoomId = roomId }; db.RoomPresentations.Add(content); }
            content.Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim();
            content.Beds = string.IsNullOrWhiteSpace(request.Beds) ? null : request.Beds.Trim();
            content.Area = request.Area;
            content.AmenitiesJson = JsonSerializer.Serialize(request.Amenities.Select(x => x.Trim()).Distinct(StringComparer.OrdinalIgnoreCase));
            content.ImagesJson = JsonSerializer.Serialize(images);
            await db.SaveChangesAsync();
            await tx.CommitAsync();
            return Ok(RoomPresentationView.Create(room, content));
        }
        catch (Exception ex) when (ApiSupport.Busy(ex))
        { return Conflict(new { message = "Thông tin phòng đang được cập nhật. Hãy thử lại." }); }
    }

    [HttpGet("{roomId:int}/cover"), AllowAnonymous]
    public async Task<IActionResult> Cover(int roomId)
    {
        if (!await db.Rooms.AnyAsync(x => x.Id == roomId)) return NotFound();
        var content = await db.RoomPresentations.AsNoTracking().FirstOrDefaultAsync(x => x.RoomId == roomId);
        var images = content is null ? [] : JsonSerializer.Deserialize<string[]>(content.ImagesJson) ?? [];
        Response.Headers.CacheControl = "no-store";
        return Redirect(images.FirstOrDefault() ?? RoomPresentationView.Placeholder(roomId));
    }

    [HttpPost("{roomId:int}/images"), RequestSizeLimit(6 * 1024 * 1024), RequestFormLimits(MultipartBodyLengthLimit = 6 * 1024 * 1024)]
    public async Task<IActionResult> Upload(int roomId, IFormFile file, CancellationToken token)
    {
        if (!await db.Rooms.AnyAsync(x => x.Id == roomId, token)) return NotFound();
        if (file.Length is <= 0 or > MaxImageBytes)
            return BadRequest(new { message = "Ảnh phải có dung lượng từ 1 byte đến 5 MB." });
        await using var input = file.OpenReadStream();
        var header = new byte[12];
        var length = await input.ReadAtLeastAsync(header, 12, false, token);
        var extension = length >= 3 && header[0] == 0xff && header[1] == 0xd8 && header[2] == 0xff ? ".jpg" :
            length >= 8 && header.AsSpan(0, 8).SequenceEqual(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }) ? ".png" :
            length >= 12 && header.AsSpan(0, 4).SequenceEqual("RIFF"u8) && header.AsSpan(8, 4).SequenceEqual("WEBP"u8) ? ".webp" : null;
        if (extension is null) return BadRequest(new { message = "Chỉ nhận ảnh JPG, PNG hoặc WebP. Không nhận SVG hoặc file thực thi." });
        Directory.CreateDirectory(Folder(roomId));
        var name = Guid.NewGuid().ToString("N") + extension;
        var target = Path.Combine(Folder(roomId), name);
        try
        {
            await using var output = new FileStream(target, FileMode.CreateNew, FileAccess.Write, FileShare.None);
            await output.WriteAsync(header.AsMemory(0, length), token);
            await input.CopyToAsync(output, token);
        }
        catch { System.IO.File.Delete(target); throw; }
        return StatusCode(201, new { url = ImageUrl(roomId, name) });
    }

    [HttpGet("{roomId:int}/images/{file}"), AllowAnonymous]
    public async Task<IActionResult> Image(int roomId, string file)
    {
        if (!ImageName().IsMatch(file) || !await db.Rooms.AnyAsync(x => x.Id == roomId)) return NotFound();
        var path = Path.Combine(Folder(roomId), file);
        if (!System.IO.File.Exists(path)) return NotFound();
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        var contentType = Path.GetExtension(file) switch { ".jpg" => "image/jpeg", ".png" => "image/png", _ => "image/webp" };
        return PhysicalFile(path, contentType);
    }

    [GeneratedRegex("^[a-f0-9]{32}\\.(jpg|png|webp)$", RegexOptions.CultureInvariant)]
    private static partial Regex ImageName();
}

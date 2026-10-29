using System.IO.Compression;
using System.Security.Cryptography;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Xml;
using Microsoft.Data.Sqlite;

namespace HotelManagementAPI.Services;

public sealed record BackupFile(string Path, long Size, string Sha256);
public sealed record BackupManifest(int Version, DateTimeOffset CreatedAtUtc, List<BackupFile> Files);

public static class BackupArchive
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private const long MaxBytes = 20L * 1024 * 1024 * 1024;
    private static bool Allowed(string name) => name is "hotel.db" or "jwt.key" or "bank-config.json" or HotelRecoverySettings.FileName ||
        Regex.IsMatch(name, @"\Adata-protection-keys/[A-Za-z0-9_.-]+\.xml\z", RegexOptions.CultureInvariant) ||
        Regex.IsMatch(name, @"\AApp_Data/room-images/[1-9][0-9]*/[a-f0-9]{32}\.(jpg|png|webp)\z", RegexOptions.CultureInvariant);

    public static void CheckNoLinks(string path)
    {
        for (var current = Path.GetFullPath(path); current is not null; current = Path.GetDirectoryName(current))
        {
            try
            {
                if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0)
                    throw new IOException("Linked paths are not supported for backup or restore.");
            }
            catch (FileNotFoundException) { }
            catch (DirectoryNotFoundException) { }
        }
    }

    public static void PrivateDirectory(string path)
    {
        CheckNoLinks(path);
        Directory.CreateDirectory(path);
        if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        else
        {
            var acl = new DirectorySecurity(); acl.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);
            var owner = WindowsIdentity.GetCurrent().User ?? throw new IOException("Cannot secure backup directory.");
            foreach (var sid in new[] { owner, new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null), new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null) })
                acl.AddAccessRule(new FileSystemAccessRule(sid, FileSystemRights.FullControl,
                    InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
            new DirectoryInfo(path).SetAccessControl(acl);
        }
    }

    public static void PrivateFile(string path)
    {
        if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite);
    }

    public static string Child(string root, string name)
    {
        var fullRoot = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        var target = Path.GetFullPath(Path.Combine(root, name));
        if (!target.StartsWith(fullRoot, OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal))
            throw new InvalidDataException("Invalid backup entry path.");
        return target;
    }

    public static async Task Create(string stage, string destination, DateTimeOffset created, CancellationToken token)
    {
        var files = new List<BackupFile>();
        await using var output = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None);
        PrivateFile(destination);
        using var zip = new ZipArchive(output, ZipArchiveMode.Create, leaveOpen: true);
        foreach (var path in Directory.EnumerateFiles(stage, "*", SearchOption.AllDirectories).Order(StringComparer.Ordinal))
        {
            CheckNoLinks(path);
            var relative = Path.GetRelativePath(stage, path).Replace('\\', '/');
            if (!Allowed(relative)) throw new InvalidDataException("Unexpected backup input.");
            await using var input = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
            var hash = Convert.ToHexString(await SHA256.HashDataAsync(input, token)); input.Position = 0;
            files.Add(new(relative, input.Length, hash));
            await using var entry = zip.CreateEntry(relative, CompressionLevel.Optimal).Open();
            await input.CopyToAsync(entry, token);
        }
        await using var manifest = zip.CreateEntry("manifest.json", CompressionLevel.Optimal).Open();
        await JsonSerializer.SerializeAsync(manifest, new BackupManifest(1, created, files), Json, token);
    }

    private static async Task CopyChecked(Stream input, Stream output, long expected, string? hash, CancellationToken token)
    {
        using var digest = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        var buffer = new byte[65536]; long size = 0; int read;
        while ((read = await input.ReadAsync(buffer, token)) != 0)
        {
            size += read;
            if (size > expected) throw new InvalidDataException("Backup entry exceeds declared size.");
            digest.AppendData(buffer, 0, read); await output.WriteAsync(buffer.AsMemory(0, read), token);
        }
        if (size != expected || hash is not null && !Convert.ToHexString(digest.GetHashAndReset()).Equals(hash, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Backup entry integrity check failed.");
    }

    public static async Task<BackupManifest> ExtractVerified(string archive, string stage, CancellationToken token = default)
    {
        CheckNoLinks(archive); PrivateDirectory(stage);
        using var zip = ZipFile.OpenRead(archive);
        if (zip.Entries.Count is < 4 or > 100001) throw new InvalidDataException("Invalid backup entry count.");
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var entry in zip.Entries)
            if (!names.Add(entry.FullName) || entry.FullName != "manifest.json" && !Allowed(entry.FullName) ||
                ((entry.ExternalAttributes >> 16) & 0xF000) == 0xA000)
                throw new InvalidDataException("Unexpected or duplicate backup entry.");
        var header = zip.GetEntry("manifest.json") ?? throw new InvalidDataException("Missing backup manifest.");
        if (header.Length > 16 * 1024 * 1024) throw new InvalidDataException("Backup manifest is too large.");
        using var data = new MemoryStream();
        await using (var input = header.Open()) await CopyChecked(input, data, header.Length, null, token);
        data.Position = 0;
        var manifest = await JsonSerializer.DeserializeAsync<BackupManifest>(data, Json, token)
            ?? throw new InvalidDataException("Invalid backup manifest.");
        if (manifest.Version != 1 || manifest.Files is null || manifest.Files.Count != zip.Entries.Count - 1)
            throw new InvalidDataException("Unsupported backup manifest.");
        var listed = new HashSet<string>(StringComparer.OrdinalIgnoreCase); long total = 0;
        foreach (var file in manifest.Files)
        {
            if (file.Path is null || !Allowed(file.Path) || !listed.Add(file.Path) || file.Size < 0 || file.Size > MaxBytes ||
                file.Sha256 is null || !Regex.IsMatch(file.Sha256, "^[A-Fa-f0-9]{64}$") || (total += file.Size) > MaxBytes)
                throw new InvalidDataException("Invalid backup file declaration.");
            var entry = zip.GetEntry(file.Path) ?? throw new InvalidDataException("Missing backup file.");
            if (entry.Length != file.Size) throw new InvalidDataException("Backup file size mismatch.");
            var target = Child(stage, file.Path);
            PrivateDirectory(Path.GetDirectoryName(target)!);
            await using var input = entry.Open();
            await using var output = new FileStream(target, FileMode.CreateNew, FileAccess.Write, FileShare.None);
            PrivateFile(target); await CopyChecked(input, output, file.Size, file.Sha256, token);
        }
        foreach (var required in new[] { "hotel.db", "jwt.key", HotelRecoverySettings.FileName })
            if (!listed.Contains(required)) throw new InvalidDataException("Incomplete full backup.");
        await ValidateData(stage, token);
        return manifest;
    }

    private static async Task ValidateData(string stage, CancellationToken token)
    {
        if (new FileInfo(Path.Combine(stage, "jwt.key")).Length != 64) throw new InvalidDataException("Invalid JWT key.");
        HotelRecoverySettings.Read(Path.Combine(stage, HotelRecoverySettings.FileName));
        var bank = Path.Combine(stage, "bank-config.json");
        if (File.Exists(bank)) using (JsonDocument.Parse(await File.ReadAllTextAsync(bank, token))) { }
        var keys = Path.Combine(stage, "data-protection-keys");
        if (Directory.Exists(keys)) foreach (var file in Directory.EnumerateFiles(keys))
        {
            using var reader = XmlReader.Create(file, new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, MaxCharactersInDocument = 4 * 1024 * 1024 });
            while (reader.Read()) { }
        }
        await using var db = new SqliteConnection(new SqliteConnectionStringBuilder
        { DataSource = Path.Combine(stage, "hotel.db"), Mode = SqliteOpenMode.ReadOnly, Pooling = false }.ToString());
        await db.OpenAsync(token);
        await using var command = db.CreateCommand(); command.CommandText = "PRAGMA quick_check";
        if (!Equals(await command.ExecuteScalarAsync(token), "ok")) throw new InvalidDataException("SQLite integrity check failed.");
        command.CommandText = "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('Users','Bookings','Customers','CustomerAccounts','RoomPresentations','__EFMigrationsHistory')";
        if (Convert.ToInt64(await command.ExecuteScalarAsync(token)) != 6) throw new InvalidDataException("Backup does not contain the application schema.");
        command.CommandText = "SELECT RoomId,ImagesJson FROM RoomPresentations";
        await using var rows = await command.ExecuteReaderAsync(token);
        while (await rows.ReadAsync(token)) foreach (var image in JsonSerializer.Deserialize<string[]>(rows.GetString(1)) ?? [])
        {
            var prefix = $"/api/RoomPresentation/{rows.GetInt32(0)}/images/";
            var relative = image.StartsWith(prefix, StringComparison.Ordinal)
                ? $"App_Data/room-images/{rows.GetInt32(0)}/" + image[prefix.Length..] : "";
            if (!Allowed(relative) || !File.Exists(Child(stage, relative)))
                throw new InvalidDataException("A published room image is missing from the backup.");
        }
    }

    public static async Task<BackupManifest> Restore(string archive, string target)
    {
        target = Path.GetFullPath(target); CheckNoLinks(target);
        if (Directory.Exists(target) || File.Exists(target)) throw new IOException("Restore target must be a new directory.");
        var parent = Path.GetDirectoryName(target) ?? throw new IOException("Invalid restore target.");
        if (!Directory.Exists(parent)) throw new IOException("Restore parent directory must exist.");
        var stage = Child(parent, ".hotel-restore-" + Guid.NewGuid().ToString("N"));
        try
        {
            var manifest = await ExtractVerified(archive, stage);
            Directory.Move(stage, target); return manifest;
        }
        finally { if (Directory.Exists(stage)) Directory.Delete(stage, recursive: true); }
    }

    public static async Task<BackupManifest> Verify(string archive)
    {
        // Keep scratch data beside the archive, not in the container's small /tmp tmpfs.
        var stage = Child(Path.GetDirectoryName(Path.GetFullPath(archive))!, ".hotel-backup-verify-" + Guid.NewGuid().ToString("N"));
        try { return await ExtractVerified(archive, stage); }
        finally { if (Directory.Exists(stage)) Directory.Delete(stage, recursive: true); }
    }
}

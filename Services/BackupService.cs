using System.Text.RegularExpressions;
using System.Xml;
using HotelManagementAPI.Controllers;
using HotelManagementAPI.Data;
using HotelManagementAPI.Models;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace HotelManagementAPI.Services;

public sealed class BackupService(IServiceScopeFactory scopes, HotelStorage storage, TimeProvider clock,
    OperationalMetrics metrics, IConfiguration configuration, IWebHostEnvironment environment, IOptions<BackupOptions> settings)
{
    private readonly SemaphoreSlim gate = CreateGate(storage, environment, settings.Value);
    private readonly BackupOptions options = settings.Value;
    public string Folder => Path.Combine(storage.Root, "App_Data", "backups");
    private string? Replica => string.IsNullOrWhiteSpace(options.ReplicaDirectory) ? null : Path.GetFullPath(options.ReplicaDirectory);
    private const string ReplicaMarker = ".hotel-backup-replica";
    private const string ReplicaIdentity = "HotelManagementAPI backup replica v1";
    private static bool ManagedName(string name) => Regex.IsMatch(name, @"\Ahotel-[0-9]{8}-[0-9]{6}-[a-f0-9]{32}\.(zip|db)\z", RegexOptions.CultureInvariant);

    private static SemaphoreSlim CreateGate(HotelStorage storage, IWebHostEnvironment environment, BackupOptions options)
    {
        var comparison = OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
        var web = Path.TrimEndingDirectorySeparator(Path.GetFullPath(environment.WebRootPath ?? Path.Combine(environment.ContentRootPath, "wwwroot")));
        bool Within(string path, string parent) => path.Equals(parent, comparison) ||
            path.StartsWith(Path.TrimEndingDirectorySeparator(parent) + Path.DirectorySeparatorChar, comparison);
        var locations = new List<string> { Path.Combine(storage.Root, "App_Data", "backups") };
        if (!string.IsNullOrWhiteSpace(options.ReplicaDirectory)) locations.Add(Path.GetFullPath(options.ReplicaDirectory));
        foreach (var location in locations)
            if (location.Equals(web, comparison) || location.StartsWith(web.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, comparison))
                throw new InvalidOperationException("Backup directories must not be publicly served.");
        if (!string.IsNullOrWhiteSpace(options.ReplicaDirectory))
        {
            var replica = Path.TrimEndingDirectorySeparator(Path.GetFullPath(options.ReplicaDirectory));
            var data = Path.TrimEndingDirectorySeparator(storage.Root);
            if (replica.Equals(Path.GetPathRoot(replica), comparison) || Within(replica, data) || Within(data, replica) ||
                Within(web, replica) || Within(Path.TrimEndingDirectorySeparator(environment.ContentRootPath), replica))
                throw new InvalidOperationException("Backup replica must be a dedicated directory outside application data and public assets.");
        }
        return new SemaphoreSlim(1, 1);
    }

    private void CleanupAbandoned(string folder)
    {
        var cutoff = clock.GetUtcNow().UtcDateTime.AddHours(-24);
        foreach (var directory in Directory.EnumerateDirectories(folder))
        {
            if (!Regex.IsMatch(Path.GetFileName(directory), @"\A\.(creating|hotel-backup-verify)-[a-f0-9]{32}\z") || Directory.GetLastWriteTimeUtc(directory) >= cutoff) continue;
            var pending = new Stack<string>(); pending.Push(directory);
            while (pending.TryPop(out var current))
            {
                BackupArchive.CheckNoLinks(current);
                foreach (var file in Directory.EnumerateFiles(current)) BackupArchive.CheckNoLinks(file);
                foreach (var child in Directory.EnumerateDirectories(current)) pending.Push(child);
            }
            Directory.Delete(directory, recursive: true);
        }
        foreach (var file in Directory.EnumerateFiles(folder))
            if (Regex.IsMatch(Path.GetFileName(file), @"\Ahotel-[0-9]{8}-[0-9]{6}-[a-f0-9]{32}\.(zip|db)\.partial(-[a-f0-9]{32})?\z") && File.GetLastWriteTimeUtc(file) < cutoff)
            { BackupArchive.CheckNoLinks(file); File.Delete(file); }
    }

    private void CheckFolder(string path)
    {
        var web = Path.GetFullPath(environment.WebRootPath ?? Path.Combine(environment.ContentRootPath, "wwwroot"));
        var full = Path.GetFullPath(path);
        var comparison = OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
        if (full.Equals(web, comparison) || full.StartsWith(web.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, comparison))
            throw new InvalidOperationException("Backup storage must be outside the web root.");
        BackupArchive.CheckNoLinks(full);
    }

    private async Task Copy(string source, string stage, string relative, CancellationToken token)
    {
        BackupArchive.CheckNoLinks(source);
        var target = BackupArchive.Child(stage, relative);
        BackupArchive.PrivateDirectory(Path.GetDirectoryName(target)!);
        await using var input = new FileStream(source, FileMode.Open, FileAccess.Read, FileShare.Read);
        await using var output = new FileStream(target, FileMode.CreateNew, FileAccess.Write, FileShare.None);
        BackupArchive.PrivateFile(target); await input.CopyToAsync(output, token);
    }

    private async Task CopyTree(string source, string stage, string relative, CancellationToken token)
    {
        if (!Directory.Exists(source)) return;
        BackupArchive.CheckNoLinks(source);
        foreach (var file in Directory.EnumerateFiles(source))
            await Copy(file, stage, relative + "/" + Path.GetFileName(file), token);
        foreach (var directory in Directory.EnumerateDirectories(source))
            await CopyTree(directory, stage, relative + "/" + Path.GetFileName(directory), token);
    }

    public async Task<DatabaseBackup> Create(string actor, CancellationToken token = default)
    {
        await gate.WaitAsync(token);
        string? stage = null, partial = null, target = null; var recorded = false;
        try
        {
            CheckFolder(Folder); BackupArchive.PrivateDirectory(Folder);
            stage = BackupArchive.Child(Folder, ".creating-" + Guid.NewGuid().ToString("N"));
            BackupArchive.PrivateDirectory(stage);
            using var scope = scopes.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<HotelDbContext>();
            // Bank-file updates cannot split the DB/config snapshot. Published images are immutable.
            await BookingOperationsController.BankConfigLock.WaitAsync(token);
            try
            {
                await using var source = new SqliteConnection(db.Database.GetDbConnection().ConnectionString);
                await using var destination = new SqliteConnection(new SqliteConnectionStringBuilder
                { DataSource = Path.Combine(stage, "hotel.db"), Pooling = false }.ToString());
                await source.OpenAsync(token); await destination.OpenAsync(token); source.BackupDatabase(destination);
                await using var journal = destination.CreateCommand(); journal.CommandText = "PRAGMA journal_mode=DELETE";
                await journal.ExecuteScalarAsync(token);
                if (File.Exists(storage.BankConfigFile)) await Copy(storage.BankConfigFile, stage, "bank-config.json", token);
                await HotelRecoverySettings.Write(Path.Combine(stage, HotelRecoverySettings.FileName), configuration,
                    scope.ServiceProvider, clock, environment, token);
            }
            finally { BookingOperationsController.BankConfigLock.Release(); }
            await Copy(Path.Combine(storage.Root, "jwt.key"), stage, "jwt.key", token);
            await CopyTree(Path.Combine(storage.Root, "data-protection-keys"), stage, "data-protection-keys", token);
            await CopyTree(Path.Combine(storage.Root, "App_Data", "room-images"), stage, "App_Data/room-images", token);
            var name = $"hotel-{clock.GetLocalNow():yyyyMMdd-HHmmss}-{Guid.NewGuid():N}.zip";
            target = BackupArchive.Child(Folder, name); partial = target + ".partial";
            await BackupArchive.Create(stage, partial, clock.GetUtcNow(), token);
            await BackupArchive.Verify(partial);
            File.Move(partial, target); partial = null;
            var record = new DatabaseBackup { FileName = name, Size = new FileInfo(target).Length, CreatedBy = actor };
            db.DatabaseBackups.Add(record); await db.SaveChangesAsync(token); recorded = true;
            try { await Replicate(record, token); }
            catch { await PruneCore(db, record.Id, token, includeReplica: false); throw; }
            await PruneCore(db, record.Id, token);
            metrics.BackupSucceeded(clock.GetUtcNow()); return record;
        }
        finally
        {
            try
            {
                if (partial is not null && File.Exists(partial)) File.Delete(partial);
                if (!recorded && target is not null && File.Exists(target)) File.Delete(target);
                if (stage is not null && Directory.Exists(stage)) Directory.Delete(stage, recursive: true);
            }
            finally { gate.Release(); }
        }
    }

    private void PrepareReplica(string replica)
    {
        CheckFolder(replica);
        var marker = BackupArchive.Child(replica, ReplicaMarker);
        BackupArchive.CheckNoLinks(marker);
        if (File.Exists(marker))
        {
            if (new FileInfo(marker).Length > 64 || File.ReadAllText(marker) != ReplicaIdentity)
                throw new IOException("Invalid backup replica marker.");
        }
        else if (Directory.Exists(replica) && Directory.EnumerateFileSystemEntries(replica).Any())
            throw new IOException("Backup replica requires a new or empty dedicated directory.");
        // Do not change permissions on an unrelated existing directory.
        BackupArchive.PrivateDirectory(replica);
        if (!File.Exists(marker))
        {
            using var file = new FileStream(marker, FileMode.CreateNew, FileAccess.Write, FileShare.None);
            BackupArchive.PrivateFile(marker);
            using var writer = new StreamWriter(file); writer.Write(ReplicaIdentity);
        }
    }

    private async Task Replicate(DatabaseBackup record, CancellationToken token)
    {
        if (Replica is not { } replica) return;
        PrepareReplica(replica);
        var target = BackupArchive.Child(replica, record.FileName); var temporary = target + ".partial-" + Guid.NewGuid().ToString("N");
        BackupArchive.CheckNoLinks(target);
        try
        {
            await using (var input = new FileStream(BackupArchive.Child(Folder, record.FileName), FileMode.Open, FileAccess.Read, FileShare.Read))
            await using (var output = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            { BackupArchive.PrivateFile(temporary); await input.CopyToAsync(output, token); }
            await BackupArchive.Verify(temporary); File.Move(temporary, target, overwrite: true);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }

    private async Task PruneCore(HotelDbContext db, int verifiedFullId, CancellationToken token, bool includeReplica = true)
    {
        var records = await db.DatabaseBackups.OrderByDescending(x => x.CreatedAt).ThenByDescending(x => x.Id).ToListAsync(token);
        var completed = records.Where(x => ManagedName(x.FileName) && File.Exists(BackupArchive.Child(Folder, x.FileName))).ToList();
        if (!completed.Any(x => x.Id == verifiedFullId && x.FileName.EndsWith(".zip", StringComparison.Ordinal))) return;
        var newestFull = verifiedFullId;
        var cutoff = clock.GetLocalNow().DateTime.AddDays(-options.RetentionDays);
        var kept = 1;
        foreach (var record in records)
        {
            if (record.Id == newestFull || !ManagedName(record.FileName)) continue;
            if (kept < options.MaxBackups && record.CreatedAt >= cutoff && File.Exists(BackupArchive.Child(Folder, record.FileName)))
            { kept++; continue; }
            foreach (var folder in includeReplica && Replica is { } replica ? new[] { Folder, replica } : new[] { Folder })
            {
                CheckFolder(folder); var path = BackupArchive.Child(folder, record.FileName); BackupArchive.CheckNoLinks(path);
                if (File.Exists(path)) File.Delete(path);
            }
            db.DatabaseBackups.Remove(record);
        }
        await db.SaveChangesAsync(token);
        CleanupAbandoned(Folder);
        if (includeReplica && Replica is { } replicaFolder && Directory.Exists(replicaFolder))
        {
            // A replica may contain copies whose local catalog entries were rotated during an outage.
            // This is a dedicated directory; only the application's reserved backup filenames are managed.
            CheckFolder(replicaFolder);
            var protectedName = completed.First(x => x.Id == newestFull).FileName;
            var copies = Directory.EnumerateFiles(replicaFolder).Where(x => ManagedName(Path.GetFileName(x)))
                .Select(x => new FileInfo(x)).OrderByDescending(x => x.LastWriteTimeUtc).ToList();
            var retained = 1; var limit = clock.GetUtcNow().UtcDateTime.AddDays(-options.RetentionDays);
            foreach (var copy in copies)
            {
                if (copy.Name == protectedName) continue;
                BackupArchive.CheckNoLinks(copy.FullName);
                if (retained < options.MaxBackups && copy.LastWriteTimeUtc >= limit) { retained++; continue; }
                File.Delete(copy.FullName);
            }
            CleanupAbandoned(replicaFolder);
        }
    }

    public async Task Maintain(CancellationToken token)
    {
        bool create;
        await gate.WaitAsync(token);
        try
        {
            CheckFolder(Folder);
            using var scope = scopes.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<HotelDbContext>();
            var latest = await db.DatabaseBackups.Where(x => x.FileName.EndsWith(".zip"))
                .OrderByDescending(x => x.CreatedAt).ThenByDescending(x => x.Id).FirstOrDefaultAsync(token);
            create = latest is null || latest.CreatedAt < clock.GetLocalNow().Date || !ManagedName(latest.FileName) ||
                !File.Exists(BackupArchive.Child(Folder, latest.FileName)) || new FileInfo(BackupArchive.Child(Folder, latest.FileName)).Length != latest.Size;
            if (!create)
            {
                try { await BackupArchive.Verify(BackupArchive.Child(Folder, latest!.FileName)); }
                catch (Exception ex) when (ex is InvalidDataException or System.Text.Json.JsonException or SqliteException or XmlException)
                { create = true; }
                if (!create)
                {
                    try { await Replicate(latest!, token); }
                    catch { await PruneCore(db, latest!.Id, token, includeReplica: false); throw; }
                    await PruneCore(db, latest!.Id, token);
                    metrics.BackupSucceeded(new DateTimeOffset(TimeZoneInfo.ConvertTimeToUtc(
                        DateTime.SpecifyKind(latest!.CreatedAt, DateTimeKind.Unspecified), clock.LocalTimeZone)));
                }
            }
        }
        finally { gate.Release(); }
        if (create) await Create("Tự động mỗi ngày", token);
    }

    public Stream? OpenDownload(DatabaseBackup record)
    {
        if (!ManagedName(record.FileName)) return null;
        CheckFolder(Folder); var path = BackupArchive.Child(Folder, record.FileName); BackupArchive.CheckNoLinks(path);
        try { return new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete); }
        catch (FileNotFoundException) { return null; }
        catch (DirectoryNotFoundException) { return null; }
    }
}

public sealed class DailyBackupService(BackupService backups, OperationalMetrics metrics, ILogger<DailyBackupService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try { await backups.Maintain(stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception ex)
            {
                metrics.BackgroundFailure("backup");
                logger.LogError("Không tạo hoặc bảo trì được bản sao lưu. ExceptionType: {ExceptionType}", ex.GetType().FullName);
            }
            try { await Task.Delay(TimeSpan.FromHours(1), stoppingToken); }
            catch (OperationCanceledException) { break; }
        }
    }
}

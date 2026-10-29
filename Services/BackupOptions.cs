using System.ComponentModel.DataAnnotations;

namespace HotelManagementAPI.Services;

public sealed class BackupOptions
{
    [Range(1, 3650)] public int RetentionDays { get; set; } = 14;
    [Range(1, 10000)] public int MaxBackups { get; set; } = 30;
    public string? ReplicaDirectory { get; set; }
}

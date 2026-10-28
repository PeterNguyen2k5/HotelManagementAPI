using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Configuration.Json;
using Microsoft.Extensions.Configuration.Memory;
using Microsoft.Extensions.Options;

namespace HotelManagementAPI.Services;

public static class HotelRecoverySettings
{
    public const string FileName = "recovery-settings.json";
    private static readonly string[] Keys = ["Hotel:TimeZone", "DataProtection:ApplicationName",
        "ConnectionStrings:DefaultConnection", "Payments:BankConfigFile", "Payments:SepayWebhookKey",
        "CustomerEmail:Mode", "CustomerEmail:From", "CustomerEmail:PublicBaseUrl", "CustomerEmail:Smtp:Host",
        "CustomerEmail:Smtp:Port", "CustomerEmail:Smtp:Username", "CustomerEmail:Smtp:Password",
        "Monitoring:ScrapeKey", "Backup:RetentionDays", "Backup:MaxBackups"];

    public static async Task Write(string path, IConfiguration config, IServiceProvider services, TimeProvider clock,
        IWebHostEnvironment environment, CancellationToken token)
    {
        var values = Keys.Where(k => config[k] is not null).ToDictionary(k => k, k => config[k]!);
        values["Hotel:TimeZone"] = clock.LocalTimeZone.Id;
        values["ConnectionStrings:DefaultConnection"] = "Data Source=hotel.db";
        values["Payments:BankConfigFile"] = "bank-config.json";
        values["DataProtection:ApplicationName"] = services.GetRequiredService<IOptions<DataProtectionOptions>>()
            .Value.ApplicationDiscriminator ?? environment.ContentRootPath;
        values["CustomerEmail:Mode"] = config["CustomerEmail:Mode"] ?? (environment.IsDevelopment() ? "Pickup" : "Smtp");
        var scrape = DeploymentSecrets.Read(config, "Monitoring:ScrapeKey");
        if (scrape is not null) values["Monitoring:ScrapeKey"] = scrape;
        await using var file = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None);
        await JsonSerializer.SerializeAsync(file, values, cancellationToken: token);
    }

    public static Dictionary<string, string> Read(string path)
    {
        var values = JsonSerializer.Deserialize<Dictionary<string, string>>(File.ReadAllText(path))
            ?? throw new InvalidDataException("Invalid recovery settings.");
        if (values.Any(x => !Keys.Contains(x.Key, StringComparer.OrdinalIgnoreCase) || x.Value is null) ||
            values.GetValueOrDefault("ConnectionStrings:DefaultConnection") != "Data Source=hotel.db" ||
            values.GetValueOrDefault("Payments:BankConfigFile") != "bank-config.json" ||
            string.IsNullOrEmpty(values.GetValueOrDefault("DataProtection:ApplicationName")))
            throw new InvalidDataException("Invalid recovery settings.");
        return values;
    }

    public static void Load(WebApplicationBuilder builder, HotelStorage storage)
    {
        var path = Path.Combine(storage.Root, FileName);
        if (!File.Exists(path)) return;
        BackupArchive.CheckNoLinks(path);
        var values = Read(path);
        // Recovered settings replace application defaults, while operator secrets/env/CLI retain priority.
        // CreateBuilder also has an early bootstrap CLI provider. Insert after the application
        // JSON defaults, not before that bootstrap provider, so restored values aren't masked.
        var defaults = builder.Configuration.Sources.ToList().FindLastIndex(source => source is JsonConfigurationSource json &&
            (Path.GetFileName(json.Path)?.StartsWith("appsettings.", StringComparison.OrdinalIgnoreCase) ?? false));
        var index = defaults < 0 ? builder.Configuration.Sources.Count : defaults + 1;
        builder.Configuration.Sources.Insert(index, new MemoryConfigurationSource { InitialData = values! });
    }
}

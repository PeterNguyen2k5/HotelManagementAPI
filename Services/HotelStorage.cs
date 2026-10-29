namespace HotelManagementAPI.Services;

public sealed class HotelStorage(IWebHostEnvironment environment, IConfiguration configuration)
{
    public string Root { get; } = Path.GetFullPath(configuration["Storage:DataDirectory"] ?? environment.ContentRootPath,
        environment.ContentRootPath);
    public string BankConfigFile => Path.GetFullPath(configuration["Payments:BankConfigFile"] ??
        Path.Combine(AppContext.BaseDirectory, "bank-config.json"), Root);
}

public static class DeploymentSecrets
{
    public static string? Read(IConfiguration configuration, string name)
    {
        var file = configuration[name + "File"];
        return string.IsNullOrWhiteSpace(file) ? configuration[name] : File.ReadAllText(file).TrimEnd('\r', '\n');
    }
}

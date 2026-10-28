using System.Security.Claims;
using System.Security.Cryptography;
using System.Net;
using System.Threading.RateLimiting;
using HotelManagementAPI.Data;
using HotelManagementAPI.Models;
using HotelManagementAPI.Services;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;

if (args.Length > 0 && args[0] is "--verify-backup" or "--restore-backup")
{
    try
    {
        var manifest = args switch
        {
            ["--verify-backup", var archive] => await BackupArchive.Verify(archive),
            ["--restore-backup", var archive, "--restore-target", var target] => await BackupArchive.Restore(archive, target),
            _ => throw new ArgumentException("Invalid backup command.")
        };
        Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(new { success = true, version = manifest.Version, files = manifest.Files.Count, createdAtUtc = manifest.CreatedAtUtc }));
    }
    catch
    {
        Console.Error.WriteLine("Không xác minh/phục hồi được gói sao lưu. Kiểm tra gói đầy đủ hợp lệ và thư mục đích mới chưa tồn tại.");
        Environment.ExitCode = 1;
    }
    return;
}

if (args is ["--healthcheck"])
{
    try
    {
        using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(3) };
        using var response = await client.GetAsync(Environment.GetEnvironmentVariable("HEALTHCHECK_URL") ?? "http://127.0.0.1:8080/health/ready");
        Environment.ExitCode = response.IsSuccessStatusCode ? 0 : 1;
    }
    catch { Environment.ExitCode = 1; }
    return;
}

System.Globalization.CultureInfo.DefaultThreadCurrentCulture = System.Globalization.CultureInfo.InvariantCulture;
System.Globalization.CultureInfo.DefaultThreadCurrentUICulture = System.Globalization.CultureInfo.InvariantCulture;

var builder = WebApplication.CreateBuilder(args);
builder.Logging.ClearProviders();
builder.Logging.AddJsonConsole(options => { options.UseUtcTimestamp = true; options.TimestampFormat = "yyyy-MM-ddTHH:mm:ss.fffZ"; });
var storage = new HotelStorage(builder.Environment, builder.Configuration);
HotelRecoverySettings.Load(builder, storage);
Directory.CreateDirectory(storage.Root);
builder.Services.AddSingleton(storage);
var hotelTimeZone = TimeZoneInfo.FindSystemTimeZoneById(builder.Configuration["Hotel:TimeZone"] ?? "Asia/Ho_Chi_Minh");
builder.Services.AddSingleton<TimeProvider>(new HotelTimeProvider(hotelTimeZone));
builder.Services.AddSingleton<OperationalMetrics>();
builder.Services.AddHealthChecks().AddCheck<HotelReadinessCheck>("hotel-storage", tags: ["ready"], timeout: TimeSpan.FromSeconds(3));
var reverseProxyEnabled = builder.Configuration.GetValue<bool>("ReverseProxy:Enabled");
if (reverseProxyEnabled)
{
    var proxies = builder.Configuration.GetSection("ReverseProxy:KnownProxies").Get<string[]>() ?? [];
    if (proxies.Length == 0 || proxies.Any(value => !IPAddress.TryParse(value, out _)))
        throw new InvalidOperationException("ReverseProxy:KnownProxies must contain explicit trusted proxy IP addresses.");
    builder.Services.Configure<ForwardedHeadersOptions>(options =>
    {
        options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
        options.ForwardLimit = 1;
        options.RequireHeaderSymmetry = true;
        options.KnownNetworks.Clear(); options.KnownProxies.Clear();
        foreach (var value in proxies)
        {
            var proxy = IPAddress.Parse(value);
            options.KnownProxies.Add(proxy);
            if (proxy.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork) options.KnownProxies.Add(proxy.MapToIPv6());
        }
    });
}
var requireHttps = builder.Configuration.GetValue<bool?>("Deployment:RequireHttps") ?? !builder.Environment.IsDevelopment();
builder.Services.AddHttpsRedirection(options => options.HttpsPort = 443);
builder.Services.AddHsts(options => { options.MaxAge = TimeSpan.FromDays(180); options.IncludeSubDomains = false; });
var scrapeKey = DeploymentSecrets.Read(builder.Configuration, "Monitoring:ScrapeKey");
var dataProtection = builder.Services.AddDataProtection().PersistKeysToFileSystem(
    new DirectoryInfo(Path.Combine(storage.Root, "data-protection-keys")));
if (builder.Configuration["DataProtection:ApplicationName"] is { Length: > 0 } applicationName)
    dataProtection.SetApplicationName(applicationName);
var connection = new SqliteConnectionStringBuilder(
    builder.Configuration.GetConnectionString("DefaultConnection") ?? "Data Source=hotel.db");
if (!Path.IsPathRooted(connection.DataSource))
    connection.DataSource = Path.Combine(storage.Root, connection.DataSource);
builder.Services.AddDbContext<HotelDbContext>(options => options.UseSqlite(connection.ToString()));
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<HotelWorkflow>();
builder.Services.AddScoped<BankTransferReconciliation>();
builder.Services.AddSingleton<BackupService>();
builder.Services.AddOptions<BackupOptions>().Bind(builder.Configuration.GetSection("Backup"))
    .ValidateDataAnnotations().Validate(x => string.IsNullOrWhiteSpace(x.ReplicaDirectory) || Path.IsPathFullyQualified(x.ReplicaDirectory),
        "Backup:ReplicaDirectory must be an absolute path.").ValidateOnStart();
builder.Services.AddHostedService<DailyBackupService>();
builder.Services.AddSingleton<CustomerPasswordRecovery>();
builder.Services.AddSingleton<CustomerEmailSender>();

var keyPath = Path.Combine(storage.Root, "jwt.key");
if (!File.Exists(keyPath)) File.WriteAllBytes(keyPath, RandomNumberGenerator.GetBytes(64));
var signingKey = new SymmetricSecurityKey(File.ReadAllBytes(keyPath));
builder.Services.AddSingleton(signingKey);
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true, ValidIssuer = "HotelManagementAPI",
            ValidateAudience = true, ValidAudience = "HotelManagementFrontend",
            ValidateIssuerSigningKey = true, IssuerSigningKey = signingKey,
            ValidateLifetime = true, ClockSkew = TimeSpan.Zero
        };
        options.Events = new JwtBearerEvents
        {
            OnTokenValidated = async context =>
            {
                var idText = context.Principal?.FindFirstValue(ClaimTypes.NameIdentifier);
                var role = context.Principal?.FindFirstValue(ClaimTypes.Role);
                if (!int.TryParse(idText, out var id))
                {
                    context.Fail("Invalid user");
                    return;
                }
                var db = context.HttpContext.RequestServices.GetRequiredService<HotelDbContext>();
                if (role == Roles.Customer)
                {
                    var account = await db.CustomerAccounts.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id);
                    if (account is null || !account.IsActive) context.Fail("Customer account disabled");
                    else if (!CustomerTokenState.Matches(context.Principal, account, signingKey))
                        context.Fail("Customer credentials changed or session is outdated");
                    return;
                }
                var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id);
                if (user is null || !user.IsActive || user.Role != role)
                    context.Fail("User disabled or role changed");
                else if (!StaffTokenState.Matches(context.Principal, user, signingKey))
                    context.Fail("Staff credentials changed or session is outdated");
                else context.HttpContext.Items[StaffPasswordChangeMiddleware.RequiredKey] = user.MustChangePassword;
            }
        };
    });
builder.Services.AddAuthorization();
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.OnRejected = async (context, cancellationToken) =>
    {
        var response = context.HttpContext.Response;
        response.StatusCode = StatusCodes.Status429TooManyRequests;
        if (context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter))
            response.Headers.RetryAfter = ((int)Math.Ceiling(retryAfter.TotalSeconds)).ToString();
        var isLogin = context.HttpContext.Request.Path.Equals(
            "/api/Auth/login", StringComparison.OrdinalIgnoreCase);
        await ApiErrors.Write(context.HttpContext, StatusCodes.Status429TooManyRequests,
            isLogin ? "Đăng nhập quá nhiều lần. Vui lòng thử lại sau ít phút." : null);
    };
    options.AddPolicy("login", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 5, Window = TimeSpan.FromMinutes(1), QueueLimit = 0
            }));
    foreach (var policy in new[] { "customer-login", "customer-register", "customer-forgot", "customer-reset", "customer-password" })
        options.AddPolicy(policy, context => RateLimitPartition.GetFixedWindowLimiter(
            context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
            { PermitLimit = 5, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    options.AddPolicy("public-booking", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 5, Window = TimeSpan.FromMinutes(1), QueueLimit = 0
            }));
});
builder.Services.AddControllers().ConfigureApiBehaviorOptions(options =>
{
    options.SuppressMapClientErrors = true;
    options.InvalidModelStateResponseFactory = context =>
        new BadRequestObjectResult(new
        {
            message = "Dữ liệu không hợp lệ.",
            statusCode = StatusCodes.Status400BadRequest,
            traceId = context.HttpContext.TraceIdentifier,
            errors = context.ModelState.Where(x => x.Value?.Errors.Count > 0)
                .ToDictionary(x => x.Key, x => x.Value!.Errors.Select(e => e.ErrorMessage).ToArray())
        });
});
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(options =>
{
    options.SwaggerDoc("v1", new OpenApiInfo { Title = "Hotel Management API", Version = "v1" });
    options.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        Type = SecuritySchemeType.Http, Scheme = "bearer", BearerFormat = "JWT",
        In = ParameterLocation.Header
    });
    options.AddSecurityRequirement(new OpenApiSecurityRequirement
    {
        [new OpenApiSecurityScheme
        {
            Reference = new OpenApiReference { Type = ReferenceType.SecurityScheme, Id = "Bearer" }
        }] = Array.Empty<string>()
    });
});

var app = builder.Build();
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<HotelDbContext>();
    await db.Database.MigrateAsync();
    if (!await db.Users.AnyAsync())
    {
        var initialPassword = DeploymentSecrets.Read(builder.Configuration, "BootstrapAdmin:Password");
        if (!StaffPasswordPolicy.ValidInitialPassword(initialPassword))
            throw new InvalidOperationException("Configure BootstrapAdmin__Password with at least 12 characters and at most 72 UTF-8 bytes before initializing the administrator. No default administrator password is provided.");
        db.Users.Add(new User
        {
            Username = "admin", FullName = "Quản trị viên", Role = Roles.Admin,
            Email = "admin@hotel.local", PasswordHash = BCrypt.Net.BCrypt.HashPassword(initialPassword!),
            MustChangePassword = true
        });
        db.Services.AddRange(
            new HotelService { Name = "Giặt ủi", Unit = "Kg", Price = 50000 },
            new HotelService { Name = "Bữa sáng", Unit = "Suất", Price = 150000 });
        await db.SaveChangesAsync();
    }
    // Existing installations keep their credentials; restrict legacy default administrators.
    var legacyAdmins = await db.Users.Where(x => x.Role == Roles.Admin && !x.MustChangePassword).ToListAsync();
    foreach (var admin in legacyAdmins)
        if (BCrypt.Net.BCrypt.Verify("admin123", admin.PasswordHash)) admin.MustChangePassword = true;
    if (legacyAdmins.Any(x => x.MustChangePassword)) await db.SaveChangesAsync();
    var workflow=scope.ServiceProvider.GetRequiredService<HotelWorkflow>();
    var legacy=await ApiSupport.FullBookings(db).Where(x=>x.Status==BookingStates.CheckedOut && !db.BookingInvoices.Any(i=>i.BookingId==x.Id)).ToListAsync();
    foreach(var booking in legacy) workflow.IssueInvoice(booking);
    if(legacy.Count>0)await db.SaveChangesAsync();
}
if (reverseProxyEnabled) app.UseForwardedHeaders();
app.UseMiddleware<RequestMonitoringMiddleware>();
app.UseMiddleware<ApiErrorMiddleware>();
if (requireHttps)
{
    if (!app.Environment.IsDevelopment()) app.UseHsts();
    app.UseWhen(context => !DeploymentHealth.IsProbe(context), branch => branch.UseHttpsRedirection());
}
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}
app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = context =>
    {
        // Revalidate entry pages and executable assets after updates; keep image/font caching.
        var extension = Path.GetExtension(context.File.Name).ToLowerInvariant();
        if (extension is ".html" or ".js" or ".css")
            context.Context.Response.Headers.CacheControl = "no-cache";
    }
});
app.UseRateLimiter();
app.UseAuthentication();
app.UseMiddleware<StaffPasswordChangeMiddleware>();
app.UseAuthorization();
app.MapDeploymentEndpoints(scrapeKey);
app.MapGet("/api/HotelConfiguration", (HttpContext context, TimeProvider clock) =>
{
    context.Response.Headers.CacheControl = "no-store";
    var id = clock.LocalTimeZone.Id;
    if (TimeZoneInfo.TryConvertWindowsIdToIanaId(id, out var iana)) id = iana;
    return Results.Json(new { timeZone = id, today = clock.GetLocalNow().ToString("yyyy-MM-dd") });
}).AllowAnonymous();
app.MapControllers();
app.MapFallback("/api/{**path}", (HttpContext context) => Results.Json(
    ApiErrors.Create(context, StatusCodes.Status404NotFound, "Đường dẫn API không tồn tại."), statusCode: 404));
app.MapFallbackToFile("index.html");
app.Run();

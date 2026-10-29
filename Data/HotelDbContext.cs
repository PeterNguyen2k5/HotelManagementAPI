using HotelManagementAPI.Models;
using Microsoft.EntityFrameworkCore;

namespace HotelManagementAPI.Data;

public sealed class HotelDbContext(DbContextOptions<HotelDbContext> options, IHttpContextAccessor? http = null, TimeProvider? clock = null) : DbContext(options)
{
    public DbSet<CustomerAccount> CustomerAccounts => Set<CustomerAccount>();
    public DbSet<BookingRequest> BookingRequests => Set<BookingRequest>();
    public DbSet<BookingPayment> BookingPayments => Set<BookingPayment>();
    public DbSet<BankPaymentOperation> BankPaymentOperations => Set<BankPaymentOperation>();
    public DbSet<BankTransfer> BankTransfers => Set<BankTransfer>();
    public DbSet<RoomCharge> RoomCharges => Set<RoomCharge>();
    public DbSet<BookingInvoice> BookingInvoices => Set<BookingInvoice>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();
    public DbSet<DatabaseBackup> DatabaseBackups => Set<DatabaseBackup>();
    public DbSet<User> Users => Set<User>();
    public DbSet<RoomType> RoomTypes => Set<RoomType>();
    public DbSet<Room> Rooms => Set<Room>();
    public DbSet<RoomPresentation> RoomPresentations => Set<RoomPresentation>();
    public DbSet<Customer> Customers => Set<Customer>();
    public DbSet<Booking> Bookings => Set<Booking>();
    public DbSet<BookingDetail> BookingDetails => Set<BookingDetail>();
    public DbSet<HotelService> Services => Set<HotelService>();
    public DbSet<ServiceUsage> ServiceUsages => Set<ServiceUsage>();
    public DbSet<ServiceUsageOperation> ServiceUsageOperations => Set<ServiceUsageOperation>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<BankPaymentOperation>().HasKey(x => x.RequestId);
        b.Entity<BankPaymentOperation>().Property(x => x.RequestId).HasMaxLength(36);
        b.Entity<BankPaymentOperation>().Property(x => x.Fingerprint).HasMaxLength(64);
        b.Entity<BankPaymentOperation>().HasOne(x => x.Payment).WithMany()
            .HasForeignKey(x => x.PaymentId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<ServiceUsageOperation>().HasKey(x => x.RequestId);
        b.Entity<ServiceUsageOperation>().Property(x => x.RequestId).HasMaxLength(36);
        b.Entity<ServiceUsageOperation>().Property(x => x.ServiceName).HasMaxLength(100);
        b.Entity<ServiceUsageOperation>().HasIndex(x => x.UsageId).IsUnique();
        b.Entity<ServiceUsageOperation>().HasOne(x => x.Usage).WithOne()
            .HasForeignKey<ServiceUsageOperation>(x => x.UsageId).OnDelete(DeleteBehavior.SetNull);
        b.Entity<BankTransfer>().HasIndex(x => x.SepayId).IsUnique();
        b.Entity<BankTransfer>().HasIndex(x => new { x.Status, x.Id });
        b.Entity<BankTransfer>().HasIndex(x => x.PaymentId).IsUnique();
        b.Entity<BankTransfer>().Property(x => x.BankReferenceKey).HasMaxLength(64);
        b.Entity<BankTransfer>().HasIndex(x => x.BankReferenceKey);
        b.Entity<BankTransfer>().Property(x => x.Amount).HasConversion(v => (long)(v * 100m), v => v / 100m);
        b.Entity<BankTransfer>().HasOne(x => x.Payment).WithOne().HasForeignKey<BankTransfer>(x => x.PaymentId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<BankTransfer>().HasOne<Booking>().WithMany().HasForeignKey(x => x.BookingId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<RoomPresentation>().HasKey(x => x.RoomId);
        b.Entity<RoomPresentation>().HasOne(x => x.Room).WithOne().HasForeignKey<RoomPresentation>(x => x.RoomId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<BookingRequest>().HasOne(x=>x.Booking).WithMany().HasForeignKey(x=>x.BookingId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<BookingRequest>().HasIndex(x=>x.BookingId).IsUnique().HasFilter("Status = 'Pending'");
        b.Entity<BookingPayment>().HasOne(x=>x.Booking).WithMany(x=>x.Payments).HasForeignKey(x=>x.BookingId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<BookingPayment>().HasIndex(x=>x.RequestId).IsUnique();
        b.Entity<BookingPayment>().Property(x => x.BankReferenceKey).HasMaxLength(64);
        b.Entity<BookingPayment>().HasIndex(x => x.BankReferenceKey).IsUnique();
        b.Entity<BookingPayment>().Property(x=>x.Amount).HasConversion(v=>(long)(v*100m),v=>v/100m);
        b.Entity<RoomCharge>().Property(x=>x.UnitPrice).HasConversion(v=>(long)(v*100m),v=>v/100m);
        b.Entity<RoomCharge>().Property(x=>x.Total).HasConversion(v=>(long)(v*100m),v=>v/100m);
        b.Entity<BookingInvoice>().HasIndex(x=>x.BookingId).IsUnique();
        b.Entity<BookingInvoice>().HasOne(x=>x.Booking).WithOne().HasForeignKey<BookingInvoice>(x=>x.BookingId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<AuditLog>().HasIndex(x=>x.CreatedAt);
        b.Entity<CustomerAccount>().HasIndex(x => x.Username).IsUnique();
        b.Entity<CustomerAccount>().HasIndex(x => x.Email).IsUnique();
        b.Entity<CustomerAccount>().HasIndex(x => x.CustomerId).IsUnique();
        b.Entity<CustomerAccount>().HasOne(x => x.Customer).WithOne()
            .HasForeignKey<CustomerAccount>(x => x.CustomerId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<User>().HasIndex(x => x.Username).IsUnique();
        b.Entity<User>().HasIndex(x => x.Email).IsUnique();
        b.Entity<RoomType>().HasIndex(x => x.Name).IsUnique();
        b.Entity<Room>().HasIndex(x => x.RoomNumber).IsUnique();
        b.Entity<Room>().HasOne(x => x.RoomType).WithMany(x => x.Rooms)
            .HasForeignKey(x => x.RoomTypeId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Booking>().HasOne(x => x.Room).WithMany(x => x.Bookings)
            .HasForeignKey(x => x.RoomId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Booking>().HasOne(x => x.Customer).WithMany(x => x.Bookings)
            .HasForeignKey(x => x.CustomerId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Booking>().HasOne(x => x.Detail).WithOne(x => x.Booking)
            .HasForeignKey<BookingDetail>(x => x.BookingId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<ServiceUsage>().HasOne(x => x.Service).WithMany(x => x.Usages)
            .HasForeignKey(x => x.ServiceId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<ServiceUsage>().HasOne(x => x.Booking).WithMany(x => x.ServiceUsages)
            .HasForeignKey(x => x.BookingId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<Booking>().HasIndex(x => new { x.RoomId, x.CheckInDate, x.CheckOutDate });

        b.Entity<Room>().Property(x => x.Price).HasConversion(v => (long)(v * 100m), v => v / 100m);
        b.Entity<BookingDetail>().Property(x => x.RoomPricePerNight).HasConversion(v => (long)(v * 100m), v => v / 100m);
        b.Entity<BookingDetail>().Property(x => x.RoomTotal).HasConversion(v => (long)(v * 100m), v => v / 100m);
        b.Entity<HotelService>().Property(x => x.Price).HasConversion(v => (long)(v * 100m), v => v / 100m);
        b.Entity<ServiceUsage>().Property(x => x.UnitPrice).HasConversion(v => (long)(v * 100m), v => v / 100m);
        b.Entity<ServiceUsage>().Property(x => x.Total).HasConversion(v => (long)(v * 100m), v => v / 100m);
    }
    public override async Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        var now = (clock ?? TimeProvider.System).GetLocalNow().DateTime;
        foreach (var entry in ChangeTracker.Entries().Where(entry => entry.State == EntityState.Added))
            foreach (var property in entry.Properties.Where(property => property.Metadata.Name is "CreatedAt" or "UsedAt" or "IssuedAt"))
                if (property.CurrentValue is DateTime value && value == default) property.CurrentValue = now;
        var safe = new HashSet<string> { "Status", "RoomId", "CheckInDate", "CheckOutDate", "Price", "Capacity", "IsActive", "Amount", "Type" };
        var transferSafe = new HashSet<string> { "SepayId", "BookingId", "PaymentId", "Reason" };
        var entries = ChangeTracker.Entries().Where(e=>e.Entity is not AuditLog && e.State is Microsoft.EntityFrameworkCore.EntityState.Added or Microsoft.EntityFrameworkCore.EntityState.Modified or Microsoft.EntityFrameworkCore.EntityState.Deleted)
            .Select(e=>new { Entry=e, Action=e.State.ToString(), Summary=string.Join("; ",e.Properties.Where(p=>(safe.Contains(p.Metadata.Name) || e.Entity is BankTransfer && transferSafe.Contains(p.Metadata.Name)) && (e.State==Microsoft.EntityFrameworkCore.EntityState.Added || p.IsModified)).Select(p=>p.Metadata.Name+": "+p.CurrentValue)) }).ToList();
        if(entries.Count==0) return await base.SaveChangesAsync(cancellationToken);
        var owned = Database.CurrentTransaction is null ? await Database.BeginTransactionAsync(cancellationToken) : null;
        try
        {
            var result=await base.SaveChangesAsync(cancellationToken);
            foreach(var item in entries) AuditLogs.Add(new AuditLog {
                CreatedAt=now,
                Actor=http?.HttpContext?.User.Identity?.Name ?? (http?.HttpContext is null ? "System" : "Khách"),
                Role=http?.HttpContext?.User.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? (http?.HttpContext is null ? "System" : "Anonymous"),
                Action=item.Action,Entity=item.Entry.Metadata.ClrType.Name,
                EntityId=string.Join(",",item.Entry.Properties.Where(p=>p.Metadata.IsPrimaryKey()).Select(p=>p.CurrentValue)),Summary=item.Summary
            });
            await base.SaveChangesAsync(cancellationToken);
            if(owned is not null) await owned.CommitAsync(cancellationToken);
            return result;
        }
        finally { if(owned is not null) await owned.DisposeAsync(); }
    }
}

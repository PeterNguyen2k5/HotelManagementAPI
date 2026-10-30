using System.Data;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using HotelManagementAPI.Data;
using HotelManagementAPI.DTOs;
using HotelManagementAPI.Models;
using HotelManagementAPI.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
namespace HotelManagementAPI.Controllers;

[ApiController,Route("api/BookingOperations"),Authorize]
public sealed class BookingOperationsController(HotelDbContext db,HotelWorkflow workflow,
    IWebHostEnvironment environment, IConfiguration configuration, BankTransferReconciliation reconciliation, HotelStorage storage, BookingHolds holds, TimeProvider clock) : ControllerBase
{
    [HttpPost("{id:int}/amend"), Authorize(Roles = Roles.Staff)]
    public async Task<IActionResult> Amend(int id,AmendBooking request)
    {
        try{
            await using var tx=await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            var b=await ApiSupport.FullBookings(db).FirstOrDefaultAsync(x=>x.Id==id);
            if(b is null)return NotFound();
            if(await holds.TryExpire(b)){await db.SaveChangesAsync();await tx.CommitAsync();return Conflict(new {message=BookingHolds.ExpiredMessage});}
            await workflow.Amend(b,request);await db.SaveChangesAsync();await tx.CommitAsync();
            return Ok(ApiSupport.BookingView(b));
        }catch(WorkflowConflict ex){return Conflict(new {message=ex.Message});}
        catch(Exception ex) when(ApiSupport.Busy(ex)){return Conflict(new {message="Booking đang thay đổi. Hãy thử lại."});}
    }
    [HttpGet("{id:int}/payments"), Authorize(Roles = Roles.Staff)]
    public async Task<IActionResult> Payments(int id)
    {
        var b=await ApiSupport.FullBookings(db).AsNoTracking().FirstOrDefaultAsync(x=>x.Id==id);
        return b is null?NotFound():Ok(new {balance=HotelWorkflow.Balance(b),items=b.Payments.OrderBy(x=>x.Id).Select(PaymentView)});
    }
    [HttpPost("{id:int}/payments"), Authorize(Roles = Roles.Staff)]
    public async Task<IActionResult> Pay(int id,PaymentCreate request)
    {
        try{
            await using var tx=await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            request.RequestId = PaymentRequestIds.Normalize(request.RequestId);
            var retry = await PaymentRequestIds.Find(db, request.RequestId);
            var operation = retry.Operation;
            var duplicate = retry.Payment;
            if (duplicate is not null && !(duplicate.BookingId == id && duplicate.Amount == request.Amount &&
                duplicate.Type == request.Type && duplicate.Method == request.Method && duplicate.Reference == request.Reference))
                return Conflict(new { message = "Mã yêu cầu đã được sử dụng cho giao dịch khác." });
            if (operation is not null)
                return operation.Fingerprint == BankTransferReconciliation.OperationFingerprint(id, request)
                    ? Ok(PaymentView(operation.Payment)) : Conflict(new { message = "Mã yêu cầu đã được sử dụng cho giao dịch khác." });
            if(duplicate is not null)
                return Ok(PaymentView(duplicate));
            var b=await ApiSupport.FullBookings(db).FirstOrDefaultAsync(x=>x.Id==id);
            if(b is null)return NotFound();
            if(await holds.TryExpire(b)){await db.SaveChangesAsync();await tx.CommitAsync();return Conflict(new {message=BookingHolds.ExpiredMessage});}
            if (request.Method == "Transfer")
            {
                var config = LoadBankConfig();
                if (!config.IsConfigured)
                    return StatusCode(503, new { message = "Hãy cấu hình tài khoản ngân hàng nhận tiền trước khi ghi chuyển khoản." });
                var payment = request.Type == "Refund"
                    ? await reconciliation.RecordRefundTransfer(b, request, config, User.Identity?.Name ?? "Staff")
                    : await reconciliation.RecordManualTransfer(b, request, config, User.Identity?.Name ?? "Staff");
                await db.SaveChangesAsync(); await tx.CommitAsync();
                return Ok(PaymentView(payment));
            }
            var net=HotelWorkflow.Paid(b);var gross=HotelWorkflow.Gross(b);
            if(request.Type=="Refund"){
                if(request.Amount>Math.Max(0,net-gross)) return Conflict(new {message="Số hoàn vượt khoản cần hoàn. Hãy cập nhật hoặc hủy booking trước."});
            }else if(b.Status==BookingStates.Cancelled || request.Amount>Math.Max(0,gross-net) || (request.Type=="Deposit" && b.Status==BookingStates.CheckedOut))
                return Conflict(new {message="Khoản thu vượt số còn phải thu hoặc booking không cho phép nhận cọc."});
            var p=new BookingPayment{BookingId=id,RequestId=request.RequestId,Type=request.Type,Method=request.Method,Amount=request.Amount,Reference=request.Reference,
                RecordedBy=User.Identity?.Name??"Staff",CreatedAt=workflow.Now};
            db.BookingPayments.Add(p);await db.SaveChangesAsync();await tx.CommitAsync();return Ok(PaymentView(p));
        }catch(WorkflowConflict ex){return Conflict(new {message=ex.Message});}
        catch(Exception ex) when(ApiSupport.Busy(ex) || ex is DbUpdateException update && ApiSupport.Unique(update))
        {return Conflict(new {message="Giao dịch đang được ghi nhận. Hãy kiểm tra lịch sử trước khi thử lại."});}
    }
    [HttpGet("{id:int}/invoice"),AllowAnonymous]
    public async Task<IActionResult> Invoice(int id)
    {
        if(User.Identity?.IsAuthenticated!=true)return Unauthorized();
        if(!User.IsInRole(Roles.Admin) && !User.IsInRole(Roles.Receptionist) && !User.IsInRole(Roles.Customer))return Forbid();
        var b=await ApiSupport.FullBookings(db).AsNoTracking().FirstOrDefaultAsync(x=>x.Id==id);
        if(b is null)return NotFound();
        if(User.IsInRole(Roles.Customer)){
            var accountId=int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
            if(!await db.CustomerAccounts.AnyAsync(x=>x.Id==accountId && x.CustomerId==b.CustomerId))return NotFound();
        }
        if(b.Status!=BookingStates.CheckedOut)return Conflict(new {message="Hóa đơn được phát hành sau check-out."});
        var invoice=await db.BookingInvoices.AsNoTracking().FirstOrDefaultAsync(x=>x.BookingId==id);
        if(invoice is null)return Conflict(new {message="Hóa đơn chưa được phát hành. Hãy liên hệ lễ tân."});
        return Ok(new {invoice.Number,invoice.IssuedAt,detail=JsonSerializer.Deserialize<JsonElement>(invoice.Snapshot),balance=HotelWorkflow.Balance(b),payments=b.Payments.Select(PaymentView)});
    }
    private string BankConfigFile => storage.BankConfigFile;
    internal static readonly SemaphoreSlim BankConfigLock = new(1, 1);
    private BankConfigSave LoadBankConfig()
    {
        if (!System.IO.File.Exists(BankConfigFile)) return new BankConfigSave();
        return JsonSerializer.Deserialize<BankConfigSave>(System.IO.File.ReadAllText(BankConfigFile))
            ?? throw new InvalidOperationException("Bank configuration is invalid.");
    }
    private bool CanSimulate => environment.IsDevelopment() && User.IsInRole(Roles.Admin) &&
        HttpContext.Connection.RemoteIpAddress is { } ip &&
        System.Net.IPAddress.IsLoopback(ip.IsIPv4MappedToIPv6 ? ip.MapToIPv4() : ip);
    private object BankView(BankConfigSave config) => new
    {
        bankConfigured = config.IsConfigured,
        bankId = config.IsConfigured ? config.BankId : "",
        bankName = config.IsConfigured ? config.BankName : "",
        accountNumber = config.IsConfigured ? config.AccountNumber : "",
        webhookAccountNumber = config.IsConfigured ? config.WebhookAccountNumber : null,
        accountName = config.IsConfigured ? config.AccountName : "",
        qrImageUrl = config.IsConfigured ? config.QrImageUrl : null,
        sepayConfigured = !string.IsNullOrWhiteSpace(configuration["Payments:SepayWebhookKey"] ?? config.SepayApiKey),
        canSimulate = CanSimulate
    };
    private async Task<bool> CanAccess(Booking booking) => User.IsInRole(Roles.Admin) ||
        User.IsInRole(Roles.Receptionist) || User.IsInRole(Roles.Customer) &&
        int.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var accountId) &&
        await db.CustomerAccounts.AsNoTracking().AnyAsync(x => x.Id == accountId && x.IsActive && x.CustomerId == booking.CustomerId);
    [HttpGet("bank-config"), AllowAnonymous]
    public IActionResult GetBankConfig()
    {
        Response.Headers.CacheControl = "no-store";
        return Ok(BankView(LoadBankConfig()));
    }
    [HttpPost("bank-config"), Authorize(Roles = Roles.Admin)]
    public async Task<IActionResult> SaveBankConfig(BankConfigSave config)
    {
        config.WebhookAccountNumber = string.IsNullOrWhiteSpace(config.WebhookAccountNumber)
            ? null : config.WebhookAccountNumber.Trim();
        if (!config.IsConfigured)
            return BadRequest(new { message = "Hãy nhập thông tin tài khoản ngân hàng thực tế. Không sử dụng tài khoản mẫu." });
        await BankConfigLock.WaitAsync(HttpContext.RequestAborted);
        string? temporary = null;
        try
        {
            // Blank preserves the server-side key; it is never included in responses.
            if (string.IsNullOrWhiteSpace(config.SepayApiKey)) config.SepayApiKey = LoadBankConfig().SepayApiKey;
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(BankConfigFile))!);
            temporary = BankConfigFile + "." + Guid.NewGuid().ToString("N") + ".tmp";
            await System.IO.File.WriteAllTextAsync(temporary, JsonSerializer.Serialize(config), HttpContext.RequestAborted);
            System.IO.File.Move(temporary, BankConfigFile, overwrite: true);
            return Ok(BankView(config));
        }
        finally
        {
            if (temporary is not null && System.IO.File.Exists(temporary)) System.IO.File.Delete(temporary);
            BankConfigLock.Release();
        }
    }

    [HttpGet("{id:int}/public-info"), Authorize(Roles = Roles.Customer + "," + Roles.Staff)]
    public async Task<IActionResult> PublicInfo(int id)
    {
        await holds.Reap();
        Response.Headers.CacheControl = "no-store";
        var b = await ApiSupport.FullBookings(db).AsNoTracking().Include(x => x.Room).ThenInclude(x => x.RoomType).FirstOrDefaultAsync(x => x.Id == id);
        if (b is null) return NotFound(new { message = "Không tìm thấy thông tin đặt phòng." });
        if (!await CanAccess(b)) return NotFound();
        var balance = HotelWorkflow.Balance(b);
        return Ok(new
        {
            b.Id,
            customerName = b.Customer?.FullName ?? "",
            customerPhone = b.Customer?.Phone ?? "",
            customerEmail = b.Customer?.Email ?? "",
            b.RoomId,
            roomNumber = b.Room?.RoomNumber ?? "",
            roomTypeName = b.Room?.RoomType?.Name ?? "",
            nights = b.Detail?.Nights ?? 0,
            roomPricePerNight = b.Detail?.RoomPricePerNight ?? 0m,
            roomTotal = b.Detail?.RoomTotal ?? 0m,
            totalAmount = b.Status == BookingStates.Cancelled ? 0m : (b.Detail?.RoomTotal ?? 0m) + b.ServiceUsages.Sum(s => s.Total),
            b.GuestCount,
            checkInDate = b.CheckInDate,
            checkOutDate = b.CheckOutDate,
            status = b.Status,
            paymentDueAtUtc = BookingHolds.Utc(b.PaymentDueAtUtc), holdExpiredAtUtc = BookingHolds.Utc(b.HoldExpiredAtUtc),
            awaitingPayment = BookingHolds.AwaitingPayment(b), serverTimeUtc = clock.GetUtcNow(),
            canCancelHold = User.IsInRole(Roles.Customer) && b.Status == BookingStates.Reserved && !BookingHolds.HasReceipt(b),
            canRequestCancellation = User.IsInRole(Roles.Customer) && b.Status == BookingStates.Reserved,
            hasPendingRequest = await db.BookingRequests.AnyAsync(x => x.BookingId == id && x.Status == "Pending"),
            balance,
            payments = b.Payments.OrderBy(x => x.Id).Select(PaymentView)
        });
    }

    [HttpPost("{id:int}/cancel-hold"), Authorize(Roles = Roles.Customer)]
    public async Task<IActionResult> CancelHold(int id)
    {
        try
        {
            await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            var accountId = int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
            var customerId = await db.CustomerAccounts.Where(x => x.Id == accountId && x.IsActive).Select(x => x.CustomerId).FirstAsync();
            var booking = await ApiSupport.FullBookings(db).FirstOrDefaultAsync(x => x.Id == id && x.CustomerId == customerId);
            if (booking is null) return NotFound();
            if (booking.Status == BookingStates.Cancelled)
                return Ok(new { booking = ApiSupport.BookingView(booking), message = "Booking đã hủy." });
            if (booking.Status != BookingStates.Reserved)
                return Conflict(new { message = "Chỉ booking chưa nhận phòng mới được hủy giữ chỗ." });
            if (BookingHolds.HasReceipt(booking))
                return Conflict(new { message = "Booking đã nhận tiền. Vui lòng gửi yêu cầu hủy để lễ tân kiểm tra và xử lý khoản cần hoàn." });
            if (!await holds.TryExpire(booking)) await workflow.Cancel(booking);
            await db.SaveChangesAsync(); await tx.CommitAsync();
            return Ok(new { booking = ApiSupport.BookingView(booking), message = "Đã hủy giữ chỗ và mở lại phòng. Nếu bạn vừa chuyển khoản, hãy liên hệ lễ tân để đối soát." });
        }
        catch (Exception ex) when (ApiSupport.Busy(ex))
        { return Conflict(new { message = "Booking đang được cập nhật. Hãy tải lại trạng thái trước khi thử tiếp." }); }
    }

    [HttpPost("{id:int}/customer-payment"), Authorize(Roles = Roles.Customer + "," + Roles.Staff)]
    public async Task<IActionResult> CustomerPayment(int id, CustomerPaymentRequest request)
    {
        try
        {
            await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            var booking = await ApiSupport.FullBookings(db).FirstOrDefaultAsync(x => x.Id == id);
            if (booking is null || !await CanAccess(booking)) return NotFound();
            if(await holds.TryExpire(booking)){await db.SaveChangesAsync();await tx.CommitAsync();return Conflict(new {message=BookingHolds.ExpiredMessage});}
            if (request.Type != "Direct") return Conflict(new { message = "Chuyển khoản chỉ được ghi nhận sau xác nhận ngân hàng hoặc lễ tân." });
            if (request.Amount != 0 || request.Method != "Cash")
                return BadRequest(new { message = "Chọn thanh toán tại quầy không ghi nhận tiền đã thu." });
            request.RequestId = PaymentRequestIds.Normalize(request.RequestId);
            var retry = await PaymentRequestIds.Find(db, request.RequestId);
            if (retry.Operation is not null)
                return Conflict(new { message = "Mã yêu cầu đã được sử dụng cho giao dịch khác." });
            var duplicate = retry.Payment;
            if (duplicate is not null)
                return duplicate.BookingId == id && duplicate.Type == "Direct" && duplicate.Method == "Cash" && duplicate.Amount == 0 &&
                    duplicate.Reference == (request.Reference ?? "Khách chọn thanh toán tại quầy")
                    ? Ok(new { payment = PaymentView(duplicate), message = "Đã ghi nhận lựa chọn thanh toán tại quầy." })
                    : Conflict(new { message = "Mã yêu cầu đã được sử dụng cho giao dịch khác." });
            if (booking.Status == BookingStates.Cancelled) return Conflict(new { message = "Booking đã hủy." });
            var payment = new BookingPayment
            {
                BookingId = id, RequestId = request.RequestId, Type = "Direct", Method = "Cash", Amount = 0m,
                Reference = request.Reference ?? "Khách chọn thanh toán tại quầy",
                RecordedBy = User.Identity?.Name ?? "Khách hàng", CreatedAt = workflow.Now
            };
            db.BookingPayments.Add(payment);
            await db.SaveChangesAsync(); await tx.CommitAsync();
            return Ok(new { payment = PaymentView(payment), balance = HotelWorkflow.Balance(booking),
                booking = ApiSupport.BookingView(booking), message = "Đã chọn thanh toán tại quầy; chưa ghi nhận tiền đã thu." });
        }
        catch (WorkflowConflict ex) { return Conflict(new { message = ex.Message }); }
        catch (Exception ex) when (ApiSupport.Busy(ex) || ex is DbUpdateException update && ApiSupport.Unique(update))
        { return Conflict(new { message = "Giao dịch đang được ghi nhận. Vui lòng thử lại." }); }
    }

    [HttpGet("all-payments"), Authorize(Roles = Roles.Staff)]
    public async Task<IActionResult> AllPayments([FromQuery] PageQuery query, [FromQuery] string? method = null, [FromQuery] string? type = null, [FromQuery] string? keyword = null)
    {
        var q = db.BookingPayments.Include(x => x.Booking).ThenInclude(b => b.Customer)
                                  .Include(x => x.Booking).ThenInclude(b => b.Room)
                                  .AsNoTracking().AsQueryable();

        if (!string.IsNullOrWhiteSpace(method)) q = q.Where(x => x.Method == method);
        if (!string.IsNullOrWhiteSpace(type)) q = q.Where(x => x.Type == type);
        if (!string.IsNullOrWhiteSpace(keyword))
        {
            var kw = keyword.Trim();
            q = q.Where(x => x.BookingId.ToString() == kw ||
                             (x.Booking.Customer != null && (x.Booking.Customer.FullName.Contains(kw) || (x.Booking.Customer.Phone != null && x.Booking.Customer.Phone.Contains(kw)))) ||
                             (x.Reference != null && x.Reference.Contains(kw)));
        }

        var total = await q.CountAsync();
        var skip = (long)(query.PageNumber - 1) * query.PageSize;
        var rows = skip >= total ? [] : await q.OrderByDescending(x => x.Id).Skip((int)skip).Take(query.PageSize).ToListAsync();

        return Ok(ApiSupport.Page(rows.Select(x => new
        {
            x.Id,
            x.BookingId,
            customerName = x.Booking?.Customer?.FullName ?? "Chưa rõ",
            customerPhone = x.Booking?.Customer?.Phone ?? "",
            roomNumber = x.Booking?.Room?.RoomNumber ?? "Chưa rõ",
            x.Type,
            x.Method,
            x.Amount,
            x.Reference,
            x.RecordedBy,
            x.CreatedAt
        }).ToList(), total, query.PageNumber, query.PageSize));
    }

    [HttpGet("{id:int}/payment-status"), Authorize(Roles = Roles.Customer + "," + Roles.Staff)]
    public async Task<IActionResult> PaymentStatus(int id)
    {
        await holds.Reap();
        Response.Headers.CacheControl = "no-store";
        var b = await ApiSupport.FullBookings(db).AsNoTracking().FirstOrDefaultAsync(x => x.Id == id);
        if (b is null) return NotFound(new { message = "Không tìm thấy booking." });
        if (!await CanAccess(b)) return NotFound();
        var net = HotelWorkflow.Paid(b);
        var gross = HotelWorkflow.Gross(b);
        var latestPayment = b.Payments.Where(p => p.Amount > 0).OrderByDescending(p => p.Id).FirstOrDefault();
        return Ok(new
        {
            bookingId = b.Id,
            gross,
            paid = net,
            remaining = Math.Max(0, gross - net),
            hasPaid = net > 0,
            payAtHotel = b.Payments.Any(p => p.Type == "Direct"),
            status = b.Status,
            paymentDueAtUtc = BookingHolds.Utc(b.PaymentDueAtUtc), holdExpiredAtUtc = BookingHolds.Utc(b.HoldExpiredAtUtc),
            awaitingPayment = BookingHolds.AwaitingPayment(b), serverTimeUtc = clock.GetUtcNow(),
            canCancelHold = User.IsInRole(Roles.Customer) && b.Status == BookingStates.Reserved && !BookingHolds.HasReceipt(b),
            canRequestCancellation = User.IsInRole(Roles.Customer) && b.Status == BookingStates.Reserved,
            hasPendingRequest = await db.BookingRequests.AnyAsync(x => x.BookingId == id && x.Status == "Pending"),
            latestPayment = latestPayment != null ? PaymentView(latestPayment) : null
        });
    }

    [HttpPost("sepay-webhook"), AllowAnonymous]
    public async Task<IActionResult> SepayWebhook(SepayWebhookRequest request)
    {
        var config = LoadBankConfig();
        if (!config.IsConfigured)
            return StatusCode(503, new { message = "Chuyển khoản chưa sẵn sàng: khách sạn chưa cấu hình tài khoản ngân hàng." });
        var expected = configuration["Payments:SepayWebhookKey"] ?? config.SepayApiKey;
        if (string.IsNullOrWhiteSpace(expected)) return StatusCode(503, new { message = "Webhook thanh toán chưa được cấu hình xác thực." });
        var authorization = Request.Headers.Authorization.ToString();
        if (!authorization.StartsWith("Apikey ", StringComparison.Ordinal) ||
            !CryptographicOperations.FixedTimeEquals(SHA256.HashData(Encoding.UTF8.GetBytes(expected)),
                SHA256.HashData(Encoding.UTF8.GetBytes(authorization[7..])))) return Unauthorized();
        if (!string.Equals(request.AccountNumber, config.SettlementAccountNumber, StringComparison.Ordinal))
            return BadRequest(new { message = "Tài khoản nhận tiền không khớp cấu hình." });
        if (!string.IsNullOrWhiteSpace(config.WebhookAccountNumber) &&
            !string.Equals(request.SubAccount, config.AccountNumber, StringComparison.Ordinal))
            return BadRequest(new { message = "Tài khoản ảo (subAccount) không khớp VA nhận thanh toán đã cấu hình." });
        if (!BankIdentity.Matches(config.BankId, request.Gateway))
            return BadRequest(new { message = "Ngân hàng của giao dịch không khớp hoặc chưa nhận diện được. Kiểm tra gateway SePay và ngân hàng đã cấu hình." });
        if (string.Equals(request.TransferType, "out", StringComparison.OrdinalIgnoreCase))
            return Ok(new { success = true, message = "Bỏ qua giao dịch tiền ra." });
        // Fail closed: only a confirmed incoming transfer may reach payment recording.
        if (!string.Equals(request.TransferType, "in", StringComparison.OrdinalIgnoreCase))
            return BadRequest(new { message = "Loại giao dịch không hợp lệ. transferType phải là 'in' hoặc 'out'." });
        try
        {
            await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            var transfer = await reconciliation.Receive(request, config.BankId, !string.IsNullOrWhiteSpace(config.WebhookAccountNumber));
            await db.SaveChangesAsync(); await tx.CommitAsync();
            // Acknowledgement means the receipt is durable; Pending does not mean the booking was paid.
            return Ok(new { success = true, transferId = transfer.Id, status = transfer.Status,
                bookingId = transfer.BookingId, amount = transfer.Amount,
                message = BankTransferReconciliation.ReasonText(transfer.Reason) });
        }
        catch (WorkflowConflict ex) { return Conflict(new { message = ex.Message }); }
        catch (Exception ex) when (ApiSupport.Busy(ex) || ex is DbUpdateException update && ApiSupport.Unique(update))
        { return Conflict(new { message = "Giao dịch đang được xử lý. Hãy thử lại." }); }
    }

    [HttpPost("{id:int}/simulate-sepay-payment"), Authorize(Roles = Roles.Admin)]
    public async Task<IActionResult> SimulateSepayPayment(int id, PaymentSimulationRequest? request = null)
    {
        if (!CanSimulate) return NotFound();
        try
        {
            await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            var booking = await ApiSupport.FullBookings(db).FirstOrDefaultAsync(x => x.Id == id);
            if (booking is null) return NotFound();
            if(await holds.TryExpire(booking)){await db.SaveChangesAsync();await tx.CommitAsync();return Conflict(new {message=BookingHolds.ExpiredMessage});}
            if (booking.Status == BookingStates.Cancelled) return Conflict(new { message = "Booking đã hủy." });
            var remaining = Math.Max(0, HotelWorkflow.Gross(booking) - HotelWorkflow.Paid(booking));
            var amount = request?.Amount is > 0 ? Math.Min(remaining, request.Amount.Value) : remaining;
            if (amount <= 0) return Conflict(new { message = "Booking không còn khoản phải thu." });
            var payment = new BookingPayment
            {
                BookingId = id, RequestId = "sepay-sim-" + Guid.NewGuid().ToString("N")[..8],
                Type = amount >= remaining ? "Payment" : "Deposit", Method = "Transfer", Amount = amount,
                Reference = "SePay mô phỏng local, không phải giao dịch ngân hàng thật", RecordedBy = "SePay Webhook Simulator", CreatedAt = workflow.Now
            };
            db.BookingPayments.Add(payment); await db.SaveChangesAsync(); await tx.CommitAsync();
            return Ok(new { success = true, payment = PaymentView(payment), balance = HotelWorkflow.Balance(booking),
                booking = ApiSupport.BookingView(booking), message = "Đã ghi nhận giao dịch mô phỏng local." });
        }
        catch (Exception ex) when (ApiSupport.Busy(ex))
        { return Conflict(new { message = "Giao dịch đang được xử lý. Hãy thử lại." }); }
    }

    private static object PaymentView(BookingPayment p)=>new{p.Id,p.BookingId,p.Type,p.Method,p.Amount,p.Reference,p.CreatedAt,p.RecordedBy};
}

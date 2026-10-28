using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Globalization;
using HotelManagementAPI.Data;
using HotelManagementAPI.DTOs;
using HotelManagementAPI.Models;
using Microsoft.EntityFrameworkCore;

namespace HotelManagementAPI.Services;

public sealed class BankTransferReconciliation(HotelDbContext db, HotelWorkflow workflow)
{
    public static string RequestId(long id) => "sepay-" + id;

    private static readonly Regex BookingCodePattern = new(
        @"(?:AN\s*NHIEN|ANNHIEN|BOOKING|HD)\s*#?\s*([0-9]+)",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.NonBacktracking);

    private static (int? BookingId, string? Reason) BookingCodes(params string?[] fields)
    {
        var ids = new HashSet<int>();
        var invalid = false;
        // A prefix at the end of one field must not be paired with a number in another field.
        foreach (var field in fields)
            foreach (Match match in BookingCodePattern.Matches(field ?? ""))
                if (int.TryParse(match.Groups[1].Value, NumberStyles.None, CultureInfo.InvariantCulture, out var id) && id > 0)
                    ids.Add(id);
                else invalid = true;
        if (ids.Count > 1) return (null, "AmbiguousBookingCode");
        if (invalid) return (null, "InvalidBookingCode");
        return (ids.Count == 1 ? ids.First() : null, null);
    }

    private static string NormalizeReference(string? value) => (value ?? "").Trim().ToUpperInvariant();
    private static bool Incoming(BookingPayment payment) => payment.Method == "Transfer" &&
        payment.Type is "Deposit" or "Payment";
    // Keep references from different banks/accounts separate, without using free-form payment content.
    private static string? ReferenceKey(string bankId, string account, string? reference) =>
        string.IsNullOrWhiteSpace(reference) ? null : Convert.ToHexString(SHA256.HashData(
            Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new[]
            { bankId.Trim().ToUpperInvariant(), account.Trim(), NormalizeReference(reference) }))));

    public static string OperationFingerprint(int bookingId, PaymentCreate request) => Convert.ToHexString(SHA256.HashData(
        Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new
        { bookingId, request.Type, request.Method, amount = request.Amount.ToString("G29", CultureInfo.InvariantCulture), request.Reference,
          request.BankId, request.BankAccountNumber }))));

    private BookingPayment RememberOperation(int bookingId, PaymentCreate request, BookingPayment payment)
    {
        db.BankPaymentOperations.Add(new BankPaymentOperation
        { RequestId = PaymentRequestIds.Normalize(request.RequestId), Fingerprint = OperationFingerprint(bookingId, request), Payment = payment });
        return payment;
    }

    public async Task<BookingPayment> RecordManualTransfer(Booking booking, PaymentCreate request, BankConfigSave bank, string actor)
    {
        if (request.BankId is not null && !request.BankId.Trim().Equals(bank.BankId.Trim(), StringComparison.OrdinalIgnoreCase) ||
            request.BankAccountNumber is not null && request.BankAccountNumber.Trim() != bank.AccountNumber.Trim())
            throw new WorkflowConflict("Tài khoản nhận tiền đã thay đổi. Hãy mở lại form và kiểm tra chứng từ trước khi ghi chuyển khoản.");
        var key = ReferenceKey(bank.BankId, bank.AccountNumber, request.Reference)!;
        var existing = await db.BookingPayments.FirstOrDefaultAsync(x => x.BankReferenceKey == key);
        if (existing is not null)
        {
            if (!Incoming(existing) || existing.BookingId != booking.Id || existing.Amount != request.Amount)
                throw new WorkflowConflict("Mã giao dịch ngân hàng đã được ghi với booking hoặc số tiền khác. Hãy kiểm tra đối soát.");
            return RememberOperation(booking.Id, request, existing);
        }
        var receipts = await db.BankTransfers.Where(x => x.BankReferenceKey == key).ToListAsync();
        if (receipts.Count > 1 || receipts.Any(x => x.Status != "Pending"))
            throw new WorkflowConflict("Mã tham chiếu đã có giao dịch ngân hàng được xử lý hoặc cần xác minh. Hãy mở Đối soát chuyển khoản.");
        // Older rows have no reliable account snapshot; do not guess their bank from today's config.
        var oldReceipts = await db.BankTransfers.Where(x => x.BankReferenceKey == null && x.AccountNumber == bank.AccountNumber)
            .Select(x => x.ReferenceCode).ToListAsync();
        if (oldReceipts.Any(x => NormalizeReference(x) == NormalizeReference(request.Reference)) ||
            await HasLegacyReference(request.Reference))
            throw new WorkflowConflict("Có khoản chuyển khoản cũ cùng mã tham chiếu. Hãy liên kết khoản đã thu trong Đối soát chuyển khoản.");
        var receipt = receipts.SingleOrDefault();
        if (receipt is not null && BookingCodes(receipt.Content, receipt.Description, receipt.Code).Reason is { } codeReason)
            throw new WorkflowConflict(ReasonText(codeReason) + " Hãy mở Đối soát chuyển khoản để xác minh booking.");
        if (receipt is not null && (receipt.Amount != request.Amount ||
            receipt.SuggestedBookingId.HasValue && receipt.SuggestedBookingId != booking.Id ||
            await PossibleManualPayment(receipt, booking.Id)))
            throw new WorkflowConflict("Thông tin giao dịch chưa khớp hoặc có thể đã được thu. Hãy kiểm tra Đối soát chuyển khoản.");
        var due = Math.Max(0, HotelWorkflow.Gross(booking) - HotelWorkflow.Paid(booking));
        if (booking.Status == BookingStates.Cancelled || request.Amount > due ||
            request.Type == "Deposit" && booking.Status == BookingStates.CheckedOut)
            throw new WorkflowConflict("Khoản thu vượt số còn phải thu hoặc booking không cho phép nhận cọc.");
        var payment = new BookingPayment
        {
            BookingId = booking.Id, RequestId = PaymentRequestIds.Normalize(request.RequestId), Type = request.Type, Method = "Transfer",
            Amount = request.Amount, Reference = request.Reference, BankReferenceKey = key,
            RecordedBy = actor, CreatedAt = workflow.Now
        };
        db.BookingPayments.Add(payment);
        if (receipt is not null) Complete(receipt, payment, actor, "Liên kết giao dịch ngân hàng khi lễ tân ghi khoản thu.");
        return RememberOperation(booking.Id, request, payment);
    }

    private IQueryable<BookingPayment> UnlinkedManualPayments() => db.BookingPayments.Where(x =>
        x.Method == "Transfer" && (x.Type == "Deposit" || x.Type == "Payment") &&
        !x.RequestId.StartsWith("sepay-") && !db.BankTransfers.Any(t => t.PaymentId == x.Id));

    private async Task<bool> HasLegacyReference(string? reference)
    {
        if (string.IsNullOrWhiteSpace(reference)) return false;
        var references = await UnlinkedManualPayments().Where(x => x.BankReferenceKey == null)
            .Select(x => x.Reference).ToListAsync();
        return references.Any(x => NormalizeReference(x) == NormalizeReference(reference));
    }

    private async Task<bool> PossibleManualPayment(BankTransfer transfer, int bookingId) =>
        await UnlinkedManualPayments().AnyAsync(x => x.BookingId == bookingId &&
            (transfer.BankReferenceKey == null || x.BankReferenceKey == null)) ||
        await HasLegacyReference(transfer.ReferenceCode);

    private async Task LinkExisting(BankTransfer transfer, BookingPayment payment, int bookingId, string actor, string note)
    {
        if (!Incoming(payment) || payment.BookingId != bookingId || payment.Amount != transfer.Amount ||
            payment.BankReferenceKey is not null && transfer.BankReferenceKey is not null && payment.BankReferenceKey != transfer.BankReferenceKey ||
            await db.BankTransfers.AnyAsync(x => x.Id != transfer.Id && x.PaymentId == payment.Id))
            throw new WorkflowConflict("Khoản đã thu không khớp booking, số tiền, mã ngân hàng hoặc đã được liên kết với giao dịch khác.");
        if (transfer.BankReferenceKey is not null)
        {
            if (await db.BookingPayments.AnyAsync(x => x.Id != payment.Id && x.BankReferenceKey == transfer.BankReferenceKey))
                throw new WorkflowConflict("Mã ngân hàng đã thuộc khoản thu khác. Không thể liên kết hoặc ghi thêm tiền.");
            payment.BankReferenceKey ??= transfer.BankReferenceKey;
        }
        Complete(transfer, payment, actor, note);
    }

    // The caller holds a serializable transaction across receipt, payment and audit writes.
    public async Task<BankTransfer> Receive(SepayWebhookRequest request, string bankId)
    {
        var fingerprint = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new
        {
            request.AccountNumber, amount = request.TransferAmount.ToString("G29", CultureInfo.InvariantCulture), request.Content, request.Description,
            request.Code, request.ReferenceCode, request.Gateway, request.TransactionDate
        }))));
        var existing = await db.BankTransfers.Include(x => x.Payment).FirstOrDefaultAsync(x => x.SepayId == request.Id);
        if (existing is not null)
        {
            if (existing.Fingerprint != fingerprint)
                throw new WorkflowConflict("ID SePay đã tồn tại với nội dung hoặc số tiền khác. Hãy kiểm tra giao dịch gốc.");
            if (existing.Status == "Pending" && BookingCodes(existing.Content, existing.Description, existing.Code).Reason is { } codeReason)
            {
                existing.SuggestedBookingId = null;
                existing.Reason = codeReason;
            }
            return existing;
        }

        var codes = BookingCodes(request.Content, request.Description, request.Code);
        var suggestion = codes.BookingId;
        var transfer = new BankTransfer
        {
            SepayId = request.Id, Fingerprint = fingerprint, AccountNumber = request.AccountNumber!,
            Amount = request.TransferAmount, Gateway = request.Gateway, TransactionDate = request.TransactionDate,
            Content = request.Content, Description = request.Description, Code = request.Code,
            ReferenceCode = request.ReferenceCode, SuggestedBookingId = suggestion,
            BankReferenceKey = ReferenceKey(bankId, request.AccountNumber!, request.ReferenceCode)
        };
        db.BankTransfers.Add(transfer);
        // Keep the authenticated receipt durable, but require staff review before any automatic link or credit.
        if (codes.Reason is not null)
        {
            transfer.Reason = codes.Reason;
            return transfer;
        }
        if (transfer.BankReferenceKey is not null)
        {
            var payment = await db.BookingPayments.FirstOrDefaultAsync(x => x.BankReferenceKey == transfer.BankReferenceKey);
            if (payment is not null)
            {
                if (Incoming(payment) && payment.Amount == transfer.Amount &&
                    (!suggestion.HasValue || suggestion == payment.BookingId) &&
                    !await db.BankTransfers.AnyAsync(x => x.PaymentId == payment.Id))
                    Complete(transfer, payment, "SePay Auto Webhook", "Liên kết khoản chuyển khoản đã thu; không cộng tiền lần nữa.");
                else transfer.Reason = "ExistingPaymentConflict";
                return transfer;
            }
            if (await db.BankTransfers.AnyAsync(x => x.BankReferenceKey == transfer.BankReferenceKey))
            {
                transfer.Reason = "DuplicateBankReference";
                return transfer;
            }
        }
        // Receipts recorded before this feature must never be credited a second time.
        var legacy = await db.BookingPayments.FirstOrDefaultAsync(x => x.RequestId == RequestId(request.Id));
        if (legacy is not null)
        {
            if (legacy.Amount == transfer.Amount && legacy.Method == "Transfer" && legacy.BookingId == suggestion)
                Complete(transfer, legacy, "SePay Auto Webhook", "Liên kết khoản thu SePay đã ghi nhận trước khi có danh sách đối soát.");
            else transfer.Reason = "ExistingPaymentConflict";
        }
        else if (suggestion.HasValue)
        {
            if (await PossibleManualPayment(transfer, suggestion.Value))
            {
                transfer.Reason = "PossibleExistingPayment";
                return transfer;
            }
            var booking = await ApiSupport.FullBookings(db).FirstOrDefaultAsync(x => x.Id == suggestion);
            var reason = PendingReason(transfer, booking);
            if (reason is null) AddPayment(transfer, booking!, "SePay Auto Webhook", "Tự động khớp mã đặt phòng.");
            else transfer.Reason = reason;
        }
        return transfer;
    }

    public async Task Match(BankTransfer transfer, int bookingId, string actor, string note,
        int? existingPaymentId = null, bool recordAsNew = false)
    {
        if (transfer.Status == "Matched")
        {
            if (transfer.BookingId != bookingId || existingPaymentId.HasValue && existingPaymentId != transfer.PaymentId)
                throw new WorkflowConflict("Giao dịch đã được gắn với booking hoặc khoản thu khác.");
            return; // Retrying the successful staff action is safe.
        }
        if (transfer.Status != "Pending") throw new WorkflowConflict("Giao dịch đã được đóng đối soát.");
        if (existingPaymentId.HasValue)
        {
            var payment = await db.BookingPayments.FirstOrDefaultAsync(x => x.Id == existingPaymentId);
            if (payment is null) throw new WorkflowConflict("Không tìm thấy khoản đã thu.");
            await LinkExisting(transfer, payment, bookingId, actor, note);
            return;
        }
        if (transfer.BankReferenceKey is not null)
        {
            var payment = await db.BookingPayments.FirstOrDefaultAsync(x => x.BankReferenceKey == transfer.BankReferenceKey);
            if (payment is not null)
            {
                await LinkExisting(transfer, payment, bookingId, actor, note);
                return;
            }
            if (await db.BankTransfers.AnyAsync(x => x.Id != transfer.Id && x.BankReferenceKey == transfer.BankReferenceKey && x.Status != "Closed"))
                throw new WorkflowConflict("Có nhiều giao dịch cùng mã ngân hàng. Hãy xác minh và xử lý bản trùng trước khi ghi tiền.");
            if (transfer.Reason == "DuplicateBankReference" && !recordAsNew)
                throw new WorkflowConflict("Hãy xác nhận đây là khoản mới chưa thu sau khi xử lý các bản trùng.");
        }
        if (await db.BookingPayments.AnyAsync(x => x.RequestId == RequestId(transfer.SepayId)))
            throw new WorkflowConflict("ID SePay đã có khoản thu. Cần kiểm tra lịch sử trước khi xử lý.");
        if (!recordAsNew && await PossibleManualPayment(transfer, bookingId))
            throw new WorkflowConflict("Có thể đã thu chuyển khoản này. Chọn khoản đã thu để liên kết, hoặc xác nhận đây là khoản mới sau khi kiểm tra.");
        var booking = await ApiSupport.FullBookings(db).FirstOrDefaultAsync(x => x.Id == bookingId);
        var reason = PendingReason(transfer, booking);
        if (reason is not null) throw new WorkflowConflict(ReasonText(reason));
        AddPayment(transfer, booking!, actor, note);
    }

    private static string? PendingReason(BankTransfer transfer, Booking? booking)
    {
        if (booking is null) return "BookingNotFound";
        if (booking.Status == BookingStates.Cancelled) return "BookingCancelled";
        var due = Math.Max(0, HotelWorkflow.Gross(booking) - HotelWorkflow.Paid(booking));
        if (due == 0) return "BookingSettled";
        return transfer.Amount > due ? "AmountExceedsDue" : null;
    }

    private void AddPayment(BankTransfer transfer, Booking booking, string actor, string note)
    {
        var due = Math.Max(0, HotelWorkflow.Gross(booking) - HotelWorkflow.Paid(booking));
        var payment = new BookingPayment
        {
            BookingId = booking.Id, RequestId = RequestId(transfer.SepayId),
            Type = transfer.Amount >= due ? "Payment" : "Deposit", Method = "Transfer", Amount = transfer.Amount,
            BankReferenceKey = transfer.BankReferenceKey,
            Reference = $"SePay #{transfer.SepayId} - {transfer.ReferenceCode ?? transfer.Code ?? "Auto"}",
            RecordedBy = actor, CreatedAt = workflow.Now
        };
        db.BookingPayments.Add(payment);
        Complete(transfer, payment, actor, note);
    }

    private void Complete(BankTransfer transfer, BookingPayment payment, string actor, string note)
    {
        transfer.Status = "Matched"; transfer.Reason = "Matched";
        transfer.BookingId = payment.BookingId; transfer.Payment = payment;
        transfer.ResolvedAt = workflow.Now; transfer.ResolvedBy = actor; transfer.ResolutionNote = note.Trim();
    }

    public static string ReasonText(string reason) => reason switch
    {
        "MissingBookingCode" => "Không có mã đặt phòng hợp lệ trong nội dung chuyển khoản.",
        "AmbiguousBookingCode" => "Có nhiều mã booking khác nhau trong giao dịch. Cần đối soát để xác nhận booking nhận tiền.",
        "InvalidBookingCode" => "Giao dịch có mã booking không hợp lệ hoặc vượt giới hạn. Cần đối soát trước khi ghi tiền.",
        "BookingNotFound" => "Không tìm thấy booking.",
        "BookingCancelled" => "Booking đã hủy, cần kiểm tra hoàn tiền hoặc booking phù hợp.",
        "BookingSettled" => "Booking đã thanh toán đủ.",
        "AmountExceedsDue" => "Số tiền vượt số còn phải thu. Không tự phân bổ một phần hoặc ghi vượt dư nợ.",
        "ExistingPaymentConflict" => "Mã ngân hàng hoặc ID SePay đã có khoản thu với thông tin khác. Cần kiểm tra lịch sử.",
        "PossibleExistingPayment" => "Có khoản chuyển khoản có thể đã được lễ tân ghi nhận. Kiểm tra và liên kết khoản đã thu, không cộng tiền lần nữa.",
        "DuplicateBankReference" => "Có nhiều giao dịch cùng mã tham chiếu ngân hàng. Cần xác minh trước khi ghi tiền.",
        "Closed" => "Đã xử lý riêng theo ghi chú đối soát.",
        "Matched" => "Đã gắn giao dịch với booking.",
        _ => "Cần kiểm tra giao dịch."
    };

    public static object View(BankTransfer t)
    {
        // Also show the warning for pending receipts saved before this validation was introduced.
        var codes = BookingCodes(t.Content, t.Description, t.Code);
        var review = t.Status == "Pending" && codes.Reason is not null;
        var reason = review ? codes.Reason! : t.Reason;
        return new
        {
        t.Id, t.SepayId, t.AccountNumber, t.Amount, t.Gateway, t.TransactionDate, t.Content, t.Description,
        t.Code, t.ReferenceCode, suggestedBookingId = review ? null : t.SuggestedBookingId,
        t.Status, reason, reasonText = ReasonText(reason),
        t.BookingId, t.PaymentId, t.CreatedAt, t.ResolvedAt, t.ResolvedBy, t.ResolutionNote
        };
    }
}

using HotelManagementAPI.Data;
using HotelManagementAPI.Models;
using Microsoft.EntityFrameworkCore;

namespace HotelManagementAPI.Services;

public static class PaymentRequestIds
{
    public static string Normalize(string value) => Guid.Parse(value).ToString("D");

    // Caller holds the payment's serializable transaction, including lookup and insertion.
    public static async Task<(BookingPayment? Payment, BankPaymentOperation? Operation)> Find(
        HotelDbContext db, string requestId)
    {
        var canonical = Normalize(requestId);
        var id = Guid.Parse(canonical);
        var payments = await db.BookingPayments
            .Where(x => EF.Functions.Collate(x.RequestId, "NOCASE") == canonical).Take(2).ToListAsync();
        var operations = await db.BankPaymentOperations.Include(x => x.Payment)
            .Where(x => EF.Functions.Collate(x.RequestId, "NOCASE") == canonical).Take(2).ToListAsync();

        // Earlier validation also accepted a padded 32-digit GUID. Keep those old keys bound
        // to the same operation without rewriting payment history or normalizing tracked PKs.
        var oldPayments = await db.BookingPayments.Where(x => !x.RequestId.Contains("-")).ToListAsync();
        payments.AddRange(oldPayments.Where(x => Guid.TryParse(x.RequestId, out var old) && old == id).Take(2));
        var oldOperations = await db.BankPaymentOperations.Include(x => x.Payment)
            .Where(x => !x.RequestId.Contains("-")).ToListAsync();
        operations.AddRange(oldOperations.Where(x => Guid.TryParse(x.RequestId, out var old) && old == id).Take(2));

        if (payments.Count > 1 || operations.Count > 1 ||
            payments.Count == 1 && operations.Count == 1 && payments[0].Id != operations[0].PaymentId)
            throw new WorkflowConflict("UUID này có nhiều bản ghi thanh toán cũ hoặc nội dung xung đột. Hãy đối soát lịch sử; không ghi thêm tiền bằng UUID này.");
        return (payments.SingleOrDefault(), operations.SingleOrDefault());
    }
}

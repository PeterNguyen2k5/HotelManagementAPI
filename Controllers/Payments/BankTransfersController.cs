using System.Data;
using HotelManagementAPI.Data;
using HotelManagementAPI.DTOs;
using HotelManagementAPI.Models;
using HotelManagementAPI.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace HotelManagementAPI.Controllers;

[ApiController, Route("api/BankTransfers"), Authorize(Roles = Roles.Staff)]
public sealed class BankTransfersController(HotelDbContext db, BankTransferReconciliation reconciliation, HotelWorkflow workflow) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> List([FromQuery] BankTransferQuery query)
    {
        Response.Headers.CacheControl = "no-store";
        var rows = db.BankTransfers.AsNoTracking().AsQueryable();
        if (!string.IsNullOrEmpty(query.Status)) rows = rows.Where(x => x.Status == query.Status);
        if (!string.IsNullOrWhiteSpace(query.Keyword))
        {
            var term = query.Keyword.Trim();
            var isId = long.TryParse(term.TrimStart('#'), out var id);
            rows = rows.Where(x => isId && (x.SepayId == id || x.BookingId == id || x.SuggestedBookingId == id) ||
                x.AccountNumber.Contains(term) || x.Content != null && x.Content.Contains(term) ||
                x.Description != null && x.Description.Contains(term) || x.ReferenceCode != null && x.ReferenceCode.Contains(term));
        }
        var count = await rows.CountAsync();
        var skip = (long)(query.PageNumber - 1) * query.PageSize;
        var items = skip >= count ? new List<BankTransfer>() : await rows.OrderByDescending(x => x.Id).Skip((int)skip).Take(query.PageSize).ToListAsync();
        return Ok(ApiSupport.Page(items.Select(BankTransferReconciliation.View).ToList(), count, query.PageNumber, query.PageSize));
    }

    [HttpGet("{id:int}")]
    public async Task<IActionResult> Get(int id)
    {
        Response.Headers.CacheControl = "no-store";
        var transfer = await db.BankTransfers.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id);
        return transfer is null ? NotFound() : Ok(BankTransferReconciliation.View(transfer));
    }

    [HttpPost("{id:int}/match")]
    public async Task<IActionResult> Match(int id, BankTransferMatch request)
    {
        try
        {
            await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            var transfer = await db.BankTransfers.FirstOrDefaultAsync(x => x.Id == id);
            if (transfer is null) return NotFound();
            await reconciliation.Match(transfer, request.BookingId, User.Identity!.Name!, request.Note,
                request.ExistingPaymentId, request.RecordAsNew);
            await db.SaveChangesAsync(); await tx.CommitAsync();
            return Ok(new { transfer = BankTransferReconciliation.View(transfer), message = "Đã đối soát chuyển khoản với booking. Khoản đã thu chỉ được liên kết, không cộng tiền lần nữa." });
        }
        catch (WorkflowConflict ex) { return Conflict(new { message = ex.Message }); }
        catch (Exception ex) when (ApiSupport.Busy(ex) || ex is DbUpdateException update && ApiSupport.Unique(update))
        { return Conflict(new { message = "Giao dịch đang được đối soát. Hãy tải lại trước khi thử tiếp." }); }
    }

    [HttpPost("{id:int}/close")]
    public async Task<IActionResult> Close(int id, BankTransferClose request)
    {
        try
        {
            await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            var transfer = await db.BankTransfers.FirstOrDefaultAsync(x => x.Id == id);
            if (transfer is null) return NotFound();
            if (transfer.Status != "Pending") return Conflict(new { message = "Chỉ giao dịch chờ đối soát mới được đóng." });
            transfer.Status = "Closed"; transfer.Reason = "Closed";
            transfer.ResolvedAt = workflow.Now; transfer.ResolvedBy = User.Identity!.Name;
            transfer.ResolutionNote = request.Note.Trim();
            await db.SaveChangesAsync(); await tx.CommitAsync();
            return Ok(new { transfer = BankTransferReconciliation.View(transfer), message = "Đã đóng đối soát theo ghi chú; không ghi thêm tiền vào booking hoặc chuyển tiền ngân hàng." });
        }
        catch (Exception ex) when (ApiSupport.Busy(ex))
        { return Conflict(new { message = "Giao dịch đang được đối soát. Hãy tải lại trước khi thử tiếp." }); }
    }
}

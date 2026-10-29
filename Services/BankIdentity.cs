namespace HotelManagementAPI.Services;

public static class BankIdentity
{
    // Explicit aliases only. Never trust the administrator's display name or a substring match.
    // VietQR BIN/shortName and SePay gateway names identify the same bank.
    private static readonly string[][] Banks =
    [
        ["MB", "MBBANK", "MBB", "970422"], ["VCB", "VIETCOMBANK", "970436"],
        ["ICB", "CTG", "VIETINBANK", "970415"], ["BIDV", "970418"],
        ["VBA", "AGRIBANK", "970405"], ["TCB", "TECHCOMBANK", "970407"],
        ["ACB", "970416"], ["VPB", "VPBANK", "970432"], ["TPB", "TPBANK", "970423"],
        ["MSB", "MARITIMEBANK", "970426"], ["OCB", "970448"],
        ["KLB", "KIENLONGBANK", "970452"], ["SEAB", "SEABANK", "970440"],
        ["STB", "SACOMBANK", "970403"], ["HDB", "HDBANK", "970437"],
        ["EIB", "EXIMBANK", "970431"], ["VIB", "970441"], ["SHB", "970443"],
        ["NAB", "NAMABANK", "970428"], ["LPB", "LPBANK", "LIENVIETPOSTBANK", "970449"],
        ["ABB", "ABBANK", "970425"], ["BAB", "BACABANK", "970409"],
        ["BVB", "BAOVIETBANK", "970438"], ["NCB", "970419"], ["PGB", "PGBANK", "970430"],
        ["PVCB", "PVCOMBANK", "970412"], ["SGB", "SAIGONBANK", "970400"],
        ["SCB", "970429"], ["VAB", "VIETABANK", "970427"],
        ["VCCB", "BVBank", "VIETCAPITALBANK", "970454"], ["VIETBANK", "970433"],
        ["CAKE", "546034"], ["UBANK", "546035"], ["CIMB", "422589"],
        ["SHBVN", "SHINHANBANK", "970424"], ["WOORI", "WOORIBANK", "970457"]
    ];

    public static string? Canonical(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var alias = string.Concat(value.Where(c => !char.IsWhiteSpace(c))).ToUpperInvariant();
        return Banks.FirstOrDefault(bank => bank.Any(x => x.Equals(alias, StringComparison.OrdinalIgnoreCase)))?[0];
    }

    public static bool Matches(string? configured, string? gateway) =>
        Canonical(configured) is { } bank && Canonical(gateway) == bank;
}

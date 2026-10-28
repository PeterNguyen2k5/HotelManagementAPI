namespace HotelManagementAPI.Services;

public sealed class HotelTimeProvider(TimeZoneInfo timeZone) : TimeProvider
{
    public override TimeZoneInfo LocalTimeZone => timeZone;
}

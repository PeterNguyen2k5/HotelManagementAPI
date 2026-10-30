using HotelManagementAPI.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace HotelManagementAPI.Controllers;

[ApiController, Route("api/HotelContact"), AllowAnonymous]
public sealed class HotelContactController(IConfiguration configuration) : ControllerBase
{
    [HttpGet]
    public IActionResult Get()
    {
        Response.Headers.CacheControl = "no-store";
        // Contact details are explicitly public; never reuse SMTP credentials or customer profiles.
        return Ok(HotelContactInfo.Read(configuration));
    }
}

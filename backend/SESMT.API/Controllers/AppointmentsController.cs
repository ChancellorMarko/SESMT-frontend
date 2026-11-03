using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SESMT.Application.Modules.Appointments;
using Microsoft.EntityFrameworkCore;
using SESMT.API.Services;
using SESMT.Infrastructure.Persistence;

namespace SESMT.API.Controllers;

[ApiController, Authorize, Route("appointments")]
public sealed class AppointmentsController(AppointmentService service, IAppointmentRepository repository, SesmtDbContext db, NativeResourceAccess access) : ApiControllerBase
{
    [HttpPost]
    public async Task<IActionResult> Create(RequestAppointment request, CancellationToken ct)
    {
        if (!Actor(out var actor)) return Unauthenticated();
        var result = await service.CreateAsync(request, actor, ct);
        return CreatedAtAction(nameof(Get), new {id = result.Id}, result);
    }
    [HttpGet]
    public async Task<IActionResult> List(CancellationToken ct, Guid? companyId = null, DateTimeOffset? from = null, DateTimeOffset? to = null,
        string? status = null, string? q = null, int page = 1, int pageSize = 20)
    {
        if (!Actor(out var actor)) return Unauthenticated();
        return Ok(await service.ListAsync(actor, companyId, from, to, status, q, page, pageSize, ct));
    }
    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Get(Guid id, CancellationToken ct)
    {
        if (!Actor(out var actor)) return Unauthenticated(); return Ok(await service.GetAsync(id, actor, ct));
    }
    [HttpPost("{id:guid}/confirm")]
    public async Task<IActionResult> Confirm(Guid id, ConfirmAppointment request, CancellationToken ct)
    {
        if (!Actor(out var actor)) return Unauthenticated(); return Ok(await service.ConfirmAsync(id, request, actor, ct));
    }
    [HttpPost("{id:guid}/reschedule")]
    public async Task<IActionResult> Reschedule(Guid id, RescheduleAppointment request, CancellationToken ct)
    {
        if (!Actor(out var actor)) return Unauthenticated(); return Ok(await service.RescheduleAsync(id, request, actor, ct));
    }
    [HttpPost("{id:guid}/cancel")]
    public async Task<IActionResult> Cancel(Guid id, CancelAppointment request, CancellationToken ct)
    {
        if (!Actor(out var actor)) return Unauthenticated(); return Ok(await service.CancelAsync(id, request, actor, ct));
    }
    [HttpPut("{id:guid}/context")]
    public async Task<IActionResult> Configure(Guid id, ConfigureAppointment request, CancellationToken ct)
    {
        if (!Actor(out var actor)) return Unauthenticated(); return Ok(await service.ConfigureAsync(id, request, actor, ct));
    }
    [HttpGet("{id:guid}/responsibles")]
    public async Task<IActionResult> Responsibles(Guid id, CancellationToken ct)
    {
        Response.Headers.CacheControl = "no-store";
        if (!Actor(out var actor)) return Unauthenticated();
        var appointment = await service.GetAsync(id, actor, ct);
        await access.RequireAsync("agenda:editar", appointment.CompanyId, false, ct);
        var people = await (from worker in db.Workers join user in db.Users on worker.UserId equals user.Id
            where worker.CompanyId == appointment.CompanyId && worker.Active && worker.DeletedAt == null && worker.DismissalDate == null
                && user.Active && user.DeletedAt == null
            select new { user.Id, name = user.Name, active = user.Active }).Distinct().ToArrayAsync(ct);
        var result = new List<object>();
        foreach (var person in people)
            if (appointment.LocationId.HasValue && await repository.CanAttendAsync(person.Id, appointment.CompanyId, appointment.LocationId.Value,
                appointment.ServiceCodes, appointment.StartsAt, appointment.EndsAt, ct)) result.Add(person);
        return Ok(result);
    }
    private IActionResult Unauthenticated()
        => Failure(401, "INVALID_CLAIMS", "Não foi possível identificar o usuário.");
    private bool Actor(out Guid actor) => Guid.TryParse(User.FindFirstValue("sub") ?? User.FindFirstValue(ClaimTypes.NameIdentifier), out actor) && actor != Guid.Empty;
}

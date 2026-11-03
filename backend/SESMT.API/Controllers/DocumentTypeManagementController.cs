using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SESMT.API.Services;
using SESMT.Infrastructure.Persistence;

namespace SESMT.API.Controllers;

[ApiController,Authorize,Route("document-type-management")]
public sealed class DocumentTypeManagementController(SesmtDbContext db,DocumentTypeManagement management) : ApiControllerBase
{
    [HttpGet("context")]
    public async Task<IActionResult> Context(CancellationToken ct){Response.Headers.CacheControl="no-store";await management.RequireRead(ct);return Ok(new{canManage=await management.CanManage(ct)});}
    [HttpGet]
    public async Task<IActionResult> List(CancellationToken ct,string? q=null,int page=1,int pageSize=20)
    {
        Response.Headers.CacheControl="no-store";await management.RequireRead(ct);
        if(q?.Length>160 || page is <1 or >1000000 || pageSize is <1 or >100)return Failure(400,"VALIDATION_FAILED","Busca ou paginação inválida.");
        var query=db.DocumentTypes.AsNoTracking().Where(t=>t.Active && t.DeletedAt==null);
        if(!string.IsNullOrWhiteSpace(q)){var term=q.Trim().ToLower();query=query.Where(t=>t.Code.ToLower().Contains(term)||t.Name.ToLower().Contains(term)||t.Category.ToLower().Contains(term));}
        var total=await query.CountAsync(ct);var rows=await query.OrderBy(t=>t.Name).ThenBy(t=>t.Id).Skip((page-1)*pageSize).Take(pageSize).ToArrayAsync(ct);
        return Ok(new{items=rows.Select(DocumentTypeManagement.View),total,page,pageSize});
    }
    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Get(Guid id,CancellationToken ct){Response.Headers.CacheControl="no-store";await management.RequireRead(ct);var state=DocumentTypeManagement.View(await management.Load(id,false,ct));Response.Headers.ETag=$"\"{state.Version}\"";return Ok(state);}
    [HttpGet("{id:guid}/history")]
    public async Task<IActionResult> History(Guid id,CancellationToken ct)
    {
        Response.Headers.CacheControl="no-store";await management.RequireWrite(ct);await management.Load(id,false,ct);
        var rows=await db.AuditLogs.AsNoTracking().Where(a=>a.ResourceType=="tipo_documental"&&a.ResourceId==id).OrderByDescending(a=>a.Id).Take(100)
            .Select(a=>new{a.EventId,a.Action,a.ActorName,a.OccurredAt,a.NewData}).ToArrayAsync(ct);
        return Ok(rows.Select(a=>{using var json=JsonDocument.Parse(a.NewData!);return new{id=a.EventId,a.Action,a.ActorName,a.OccurredAt,version=json.RootElement.GetProperty("version").GetString()};}));
    }
}

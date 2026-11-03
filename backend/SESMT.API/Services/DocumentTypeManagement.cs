using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using SESMT.Application.Common.Interfaces;
using SESMT.Application.Exceptions;
using SESMT.Application.Modules.Documents.DTOs;
using SESMT.Application.Modules.Documents.Mappers;
using SESMT.Domain.Modules.Audit.Entities;
using SESMT.Domain.Modules.Documents.Entities;
using SESMT.Infrastructure.Persistence;

namespace SESMT.API.Services;

public sealed record ManagedDocumentType(DocumentTypeResponse Item, string Version);
public sealed class DocumentTypeManagement(SesmtDbContext db, NativeResourceAccess access, ICurrentUserService actor)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public async Task<bool> CanManage(CancellationToken ct)
    {
        await access.ReadAsync(ct);
        return await (from a in db.UserRoles join r in db.Roles on a.RoleId equals r.Id
            join rp in db.RolePermissions on r.Id equals rp.RoleId join p in db.Permissions on rp.PermissionId equals p.Id
            where a.UserId == actor.UserId && a.CompanyId == null && a.Active && a.DeletedAt == null && r.Code == "ADMIN" && r.Active && r.DeletedAt == null
                && rp.Active && rp.DeletedAt == null && p.Active && p.DeletedAt == null && p.Resource == "parametro" && p.Action == "editar"
            select a.Id).AnyAsync(ct);
    }
    public async Task RequireWrite(CancellationToken ct) { if (!await CanManage(ct)) throw new ResourceForbiddenException(); }
    public async Task RequireRead(CancellationToken ct)
    {
        if (await CanManage(ct)) return;
        var s = await access.ReadAsync(ct);
        if (!s.Grants.Any(g => s.CompanyIds.Contains(g.CompanyId) && g.Permission is "documento:ler" or "parametro:ler" or "parametro:editar")) throw new ResourceForbiddenException();
    }
    public static ManagedDocumentType View(DocumentType type)
    {
        var item = DocumentTypeMapper.ToResponse(type);
        var json = JsonSerializer.Serialize(new { item, type.UpdatedAt, type.DeletedAt }, Json);
        return new(item,Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(json))));
    }
    public async Task<DocumentType> Load(Guid id,bool locked,CancellationToken ct)
        => await (locked ? db.DocumentTypes.FromSqlInterpolated($"SELECT * FROM docs.documento_tipo WHERE id={id} FOR UPDATE") : db.DocumentTypes.AsNoTracking())
            .SingleOrDefaultAsync(t=>t.Id==id && t.DeletedAt==null,ct) ?? throw new NotFoundException("Tipo documental não encontrado.");
    public static bool SamePolicy(DocumentType type,DocumentTypeUpdateRequest r) {
        using var before=JsonDocument.Parse(type.MetadataSchema);using var after=JsonDocument.Parse(r.MetadataSchema);
        return type.Category==r.Category && type.SecrecyLevel==r.SecrecyLevel && type.RequiresApproval==r.RequiresApproval
            && type.RequiresSignature==r.RequiresSignature && type.PeriodicityInDays==r.PeriodicityInDays
            && type.RetentionPeriodInYears==r.RetentionPeriodInYears && type.SchemaVersion==r.SchemaVersion && JsonElement.DeepEquals(before.RootElement,after.RootElement);
    }
    public async Task Audit(string action,ManagedDocumentType? before,ManagedDocumentType after,CancellationToken ct)
    {
        var author=await db.Users.AsNoTracking().Where(u=>u.Id==actor.UserId).Select(u=>new{u.Name,email=u.Email.Value}).SingleAsync(ct);
        async Task<string> Canonical(object value)=>await db.Database.SqlQuery<string>($"SELECT CAST(CAST({JsonSerializer.Serialize(value,Json)} AS jsonb) AS text) AS \"Value\"").SingleAsync(ct);
        db.Add(new AuditLog(action,"tipo_documental",after.Item.Id,actor.UserId,author.email,author.Name,before==null?null:await Canonical(before),await Canonical(after),null,
            actor.IpAddress,actor.UserAgent,await db.AuditLogs.OrderByDescending(a=>a.Id).Select(a=>a.CurrentHash).FirstOrDefaultAsync(ct),result:"SUCCESS",traceId:actor.TraceId));
    }
}

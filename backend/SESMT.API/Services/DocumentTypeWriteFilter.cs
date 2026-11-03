using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.EntityFrameworkCore;
using SESMT.API.Controllers;
using SESMT.Application.Modules.Documents.DTOs;
using SESMT.Infrastructure.Persistence;

namespace SESMT.API.Services;

/// <summary>The catalog is shared by all companies; a scoped parameter grant is insufficient.</summary>
public sealed class DocumentTypeWriteFilter(SesmtDbContext db,DocumentTypeManagement management) : IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(ActionExecutingContext context,ActionExecutionDelegate next)
    {
        var ct=context.HttpContext.RequestAborted;
        await management.RequireWrite(ct);
        await using var tx=await db.Database.BeginTransactionAsync(ct);
        ManagedDocumentType? before=null;
        if(context.ActionArguments.TryGetValue("id",out var value) && value is Guid id) {
            var entity=await management.Load(id,true,ct);before=DocumentTypeManagement.View(entity);
            var matches=context.HttpContext.Request.Headers.IfMatch;
            if(matches.Count==0){context.Result=Error(428,"PRECONDITION_REQUIRED","Envie a versão do tipo documental em If-Match.");return;}
            var header=matches.Count==1?matches[0]:null;
            if(header is not {Length:66} || header[0]!='"' || header[^1]!='"' || !OrganizationEditingController.ValidVersion(header[1..^1])){context.Result=Error(400,"INVALID_PRECONDITION","Informe uma única versão válida entre aspas.");return;}
            if(header[1..^1]!=before.Version){context.Result=Error(409,"DOCUMENT_TYPE_CHANGED","O tipo documental foi alterado. Atualize a consulta.");return;}
            if(context.HttpContext.Request.Method=="DELETE" && await db.Documents.AnyAsync(d=>d.DocumentTypeId==id,ct)){context.Result=Error(409,"DOCUMENT_TYPE_IN_USE","Tipos já usados por documentos devem ser preservados.");return;}
            if(context.ActionArguments.TryGetValue("request",out var raw) && raw is DocumentTypeUpdateRequest update) {
                bool same;
                try{same=update.MetadataSchema!=null && update.MetadataSchema.Length<=1000000 && DocumentTypeManagement.SamePolicy(entity,update);}catch(JsonException){same=false;}
                if(!same){context.Result=Error(409,"IMMUTABLE_DOCUMENT_POLICY","Para outra classificação ou regra de aprovação, cadastre um novo tipo. A política existente é preservada.");return;}
                update.Name=update.Name.Trim();update.Description=Optional(update.Description);
            }
        } else if(context.ActionArguments.TryGetValue("request",out var raw) && raw is DocumentTypeCreateRequest create) {
            if(!Valid(create.PeriodicityInDays,create.RetentionPeriodInYears,create.MetadataSchema,create.SchemaVersion)
                || create.SecrecyLevel is not ("INTERNO" or "RESTRITO" or "MEDICO" or "Interno" or "Restrito" or "Medico")) {context.Result=Error(400,"VALIDATION_FAILED","Confira a classificação, os prazos e o esquema do tipo.");return;}
            create.Code=create.Code.Trim();create.Name=create.Name.Trim();create.Category=create.Category.Trim();create.Description=Optional(create.Description);
            if(string.IsNullOrWhiteSpace(create.Code)||string.IsNullOrWhiteSpace(create.Name)||string.IsNullOrWhiteSpace(create.Category)){context.Result=Error(400,"VALIDATION_FAILED","Informe código, nome e categoria.");return;}
        }
        var result=await next();
        if(result.Exception!=null || result.Result is ObjectResult {StatusCode:>=400} || result.Result is StatusCodeResult {StatusCode:>=400})return;
        var itemId=before?.Item.Id ?? ((result.Result as ObjectResult)?.Value is DocumentTypeResponse response ? response.Id : Guid.Empty);
        if(itemId==Guid.Empty)throw new InvalidOperationException("Missing document type receipt.");
        var saved=await db.DocumentTypes.AsNoTracking().SingleAsync(t=>t.Id==itemId,ct);var after=DocumentTypeManagement.View(saved);
        await management.Audit(before==null?"DOCUMENT_TYPE_CREATED":context.HttpContext.Request.Method=="DELETE"?"DOCUMENT_TYPE_DEACTIVATED":"DOCUMENT_TYPE_RENAMED",before,after,ct);
        await db.SaveChangesAsync(ct);await tx.CommitAsync(ct);context.HttpContext.Response.Headers.ETag=$"\"{after.Version}\"";
        ObjectResult Error(int status,string code,string message)=>new(new{code,message,requestId=context.HttpContext.TraceIdentifier}){StatusCode=status};
    }
    private static string? Optional(string? value)=>string.IsNullOrWhiteSpace(value)?null:value.Trim();
    private static bool Valid(int? days,int? years,string? schema,int version) {
        if(days is <=0 || years is <=0 || version<1 || schema==null || schema.Length>20000)return false;
        try{using var doc=JsonDocument.Parse(schema,new JsonDocumentOptions{MaxDepth=32});return doc.RootElement.ValueKind==JsonValueKind.Object;}catch(JsonException){return false;}
    }
}

using Microsoft.EntityFrameworkCore;
using SESMT.Domain.Common.Entity;
using SESMT.Domain.Modules.Audit.Entities;
using SESMT.Domain.Modules.Equipment.Entities;
using SESMT.Infrastructure.Persistence;

namespace SESMT.API.Services;

/// <summary>Explicit presentation cleanup of the reserved local dataset. Never runs at ordinary startup.</summary>
public static class LocalOperationalData
{
    private static readonly string[] OriginalNames = ["Exemplo Alice Administradora", "Exemplo Bruno Gestor", "Exemplo Carla Tecnica", "Exemplo Daniel Bombeiro", "Exemplo Elisa Recursos Humanos", "Exemplo Fabio Auditor", "Exemplo Gabriela Medica", "Exemplo Hugo Trabalhador"];
    public static readonly string[] Names = ["Alice Martins", "Bruno Costa", "Carla Mendes", "Daniel Souza", "Elisa Ribeiro", "Fábio Santos", "Gabriela Lima", "Hugo Almeida"];
    public static async Task<object> PrepareAsync(SesmtDbContext db, string actorEmail, CancellationToken ct)
    {
        var companyId = LocalExampleSeeder.CompanyId;
        var company = await db.Companies.SingleAsync(c => c.Id == companyId && c.Cnpj.Value == "00000000000191" && c.Active && c.DeletedAt == null, ct);
        var actor = await db.Users.SingleAsync(u => u.Email.Value == actorEmail && u.Active && u.DeletedAt == null, ct);
        if (!await (from link in db.UserRoles join role in db.Roles on link.RoleId equals role.Id
            where link.UserId == actor.Id && link.CompanyId == null && link.Active && link.DeletedAt == null && role.Code == "ADMIN" && role.Active && role.DeletedAt == null select link.Id).AnyAsync(ct))
            throw new InvalidOperationException("A preparação local exige um administrador global ativo.");
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(724891352618::bigint)", ct);
        if (company.CorporateName.StartsWith("EXEMPLO")) company.Update("Ampara Serviços Integrados", "Ampara Serviços Integrados", company.Cnpj.Value, company.Email?.Value, company.Phone);
        var workers = await db.Workers.Where(w => w.CompanyId == companyId && w.DeletedAt == null).ToArrayAsync(ct);
        var emails = LocalExampleSeeder.Accounts.Select(a => a.Email).ToArray();
        var people = await db.Users.Where(u => emails.Contains(u.Email.Value) && u.DeletedAt == null).ToArrayAsync(ct);
        var firefighter = await db.Roles.SingleOrDefaultAsync(r => r.Code == "EXEMPLO_BOMBEIRO" && r.Active && r.DeletedAt == null, ct);
        if (firefighter is not null)
        {
            Clean(firefighter, "Name", "Bombeiro"); Clean(firefighter, "Description", "Atividades de prevenção e resposta.");
            var technician = await db.Roles.SingleAsync(r => r.Code == "TECNICO" && r.Active && r.DeletedAt == null, ct);
            var granted = await db.RolePermissions.Where(r => r.RoleId == firefighter.Id && r.DeletedAt == null).Select(r => r.PermissionId).ToArrayAsync(ct);
            var source = await (from link in db.RolePermissions join permission in db.Permissions on link.PermissionId equals permission.Id
                where link.RoleId == technician.Id && link.Active && link.DeletedAt == null && permission.Active && permission.DeletedAt == null
                    && (permission.Resource == "epi" || permission.Resource == "agenda" || permission.Resource == "designacao" || permission.Action == "ler" && new[] { "empresa", "unidade", "setor", "cargo" }.Contains(permission.Resource))
                select permission.Id).ToArrayAsync(ct);
            foreach (var permission in source.Except(granted)) db.Add(new SESMT.Domain.Modules.IdentityAccess.Entities.RolePermission(firefighter.Id, permission));
        }
        foreach (var person in people)
        {
            var index = Array.IndexOf(OriginalNames, person.Name);
            if (index >= 0) person.Update(Names[index], person.Email.Value);
        }
        foreach (var worker in workers)
        {
            var index = Array.IndexOf(OriginalNames, worker.Name.Value);
            if (index >= 0) worker.Update(worker.Enrollment, Names[index], worker.DateOfBirth, worker.AdmissionDate, worker.DismissalDate, worker.PositionId, worker.UnitId, worker.DepartmentId);
        }
        foreach (var unit in await db.Units.Where(x => x.CompanyId == companyId).ToArrayAsync(ct)) Clean(unit, "Name");
        var units = await db.Units.Where(x => x.CompanyId == companyId && x.Active && x.DeletedAt == null).ToArrayAsync(ct);
        foreach (var sector in await db.Departments.Where(x => units.Select(u => u.Id).Contains(x.UnitId)).ToArrayAsync(ct)) { Clean(sector, "Name"); Clean(sector, "Description", "Segurança e operações."); }
        foreach (var position in await db.Positions.Where(x => x.CompanyId == companyId).ToArrayAsync(ct)) { Clean(position, "Name"); Clean(position, "Description", "Atividades e responsabilidades do cargo."); }
        foreach (var team in await db.Teams.Where(x => x.CompanyId == companyId).ToArrayAsync(ct)) { Clean(team, "Name"); Clean(team, "Description", "Equipe de operações."); }
        foreach (var document in await db.Documents.Where(x => x.CompanyId == companyId).ToArrayAsync(ct)) { Clean(document, "Title"); Clean(document, "Description", "Registro administrativo da unidade."); }
        foreach (var type in await db.DocumentTypes.Where(x => x.Code == "EXEMPLO_REGISTRO").ToArrayAsync(ct)) { Clean(type, "Name"); Clean(type, "Description", "Documentos administrativos."); }
        foreach (var appointment in await db.WorkPermitAppointments.Where(x => x.CompanyId == companyId).ToArrayAsync(ct)) Clean(appointment, "Title");
        foreach (var permit in await db.WorkPermits.Where(x => x.CompanyId == companyId).ToArrayAsync(ct)) Clean(permit, "Title");
        foreach (var designation in await db.OperationalDesignations.Where(x => x.CompanyId == companyId).ToArrayAsync(ct)) Clean(designation, "Origin", "Designação operacional");
        foreach (var requirement in await db.WorkPermitDocumentRequirements.Where(x => x.CompanyId == companyId).ToArrayAsync(ct)) Clean(requirement, "Description", "Registro administrativo exigido para a atividade.");
        foreach (var template in await db.WorkPermitTemplateVersions.Where(x => x.CompanyId == companyId).ToArrayAsync(ct)) Clean(template, "Name");
        foreach (var alert in await db.Alerts.Where(x => x.EntityId == companyId && x.Type == "EXEMPLO").ToArrayAsync(ct)) { Clean(alert, "Title", "Cadastros disponíveis"); Clean(alert, "Message", "Consulte os cadastros, documentos e atividades da unidade."); }
        var catalogNames = new[] { "Capacete de segurança", "Óculos de proteção", "Luva de proteção", "Protetor auditivo", "Calçado de segurança", "Cinturão de segurança" };
        for (var i = 0; i < catalogNames.Length; i++)
        {
            var code = $"EPI-{i + 1:000}";
            if (!await db.Equipment.AnyAsync(e => e.CompanyId == companyId && e.Code == code, ct)) db.Add(new ProtectiveEquipment(companyId, code, catalogNames[i], null, null, null, actor.Id));
        }
        await db.SaveChangesAsync(ct);
        var catalog = await db.Equipment.Where(e => e.CompanyId == companyId && e.Active && e.DeletedAt == null).OrderBy(e => e.Code).ToArrayAsync(ct);
        var recipients = workers.Where(w => w.UserId.HasValue && w.UnitId.HasValue && w.Active && w.DismissalDate == null).OrderBy(w => w.Enrollment).ToArray();
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, TimeZoneInfo.FindSystemTimeZoneById("America/Sao_Paulo")).DateTime);
        for (var i = 0; i < Math.Min(4, recipients.Length); i++)
        {
            var recipient = recipients[i == 3 && recipients.Length > 7 ? 7 : i];
            var command = Guid.Parse($"e76a12c0-20aa-4d00-8000-{i + 100:000000000000}");
            if (await db.EquipmentDeliveries.AnyAsync(d => d.CompanyId == companyId && d.CommandId == command, ct)) continue;
            var equipment = catalog.FirstOrDefault(e => e.Code == $"EPI-{i + 1:000}");
            if (equipment is null) continue;
            var delivered = today.AddDays(i == 2 ? -90 : -7);
            if (recipient.AdmissionDate > delivered) continue;
            var delivery = new EquipmentDelivery(equipment, recipient.UnitId!.Value, recipient.Id, command, i == 1 ? 2 : 1, null,
                delivered, today.AddDays(i == 2 ? -1 : 60), "Controle de entrega da unidade.", actor.Id);
            if (i == 1) delivery.Return(today.AddDays(-1), "Substituição por desgaste", actor.Id);
            db.Add(delivery);
        }
        var firefighterUser = people.SingleOrDefault(p => p.Email.Value == "bombeiro@exemplo.ampara.local");
        var firefighterWorker = recipients.SingleOrDefault(w => w.UserId == firefighterUser?.Id);
        if (firefighterWorker is not null)
            for (var i = 0; i < 2; i++)
            {
                var command = Guid.Parse($"e76a12c0-20aa-4d00-8000-{i + 104:000000000000}");
                if (await db.EquipmentDeliveries.AnyAsync(d => d.CompanyId == companyId && d.CommandId == command, ct)) continue;
                var equipment = catalog.FirstOrDefault(e => e.Code == (i == 0 ? "EPI-001" : "EPI-005"));
                if (equipment is null || firefighterWorker.AdmissionDate > today.AddDays(-7)) continue;
                db.Add(new EquipmentDelivery(equipment, firefighterWorker.UnitId!.Value, firefighterWorker.Id, command, 1, null, today.AddDays(-7), today.AddDays(60), "Controle de entrega da unidade.", actor.Id));
            }
        db.Add(new AuditLog("LOCAL_PRESENTATION_UPDATED", "conjunto_exemplos", companyId, actor.Id, actor.Email.Value, actor.Name, null, null, null, null, "CLI local",
            await db.AuditLogs.OrderByDescending(a => a.Id).Select(a => a.CurrentHash).FirstOrDefaultAsync(ct), companyId: companyId));
        await db.SaveChangesAsync(ct); await transaction.CommitAsync(ct);
        return new { equipment = await db.Equipment.CountAsync(e => e.CompanyId == companyId, ct), deliveries = await db.EquipmentDeliveries.CountAsync(d => d.CompanyId == companyId, ct) };

        void Clean<TEntity>(TEntity entity, string property, string? replacement = null) where TEntity : EntityBase
        {
            var entry = db.Entry(entity);
            if (entry.Metadata.FindProperty(property)?.ClrType != typeof(string)) return;
            var field = entry.Property<string?>(property); var old = field.CurrentValue;
            if (old is null) return;
            var changed = old.Replace("EXEMPLO - ", "").Replace("Exemplo: ", "");
            for (var i = 0; i < OriginalNames.Length; i++) changed = changed.Replace(OriginalNames[i], Names[i]);
            if (replacement is not null && (old.Contains("EXEMPLO", StringComparison.OrdinalIgnoreCase) || old.Contains("sintétic", StringComparison.OrdinalIgnoreCase)
                || old.Contains("teste", StringComparison.OrdinalIgnoreCase) || old.StartsWith("Rascunho sem arquivo") || old.StartsWith("Sem valor de comprovação"))) changed = replacement;
            if (changed != old) { field.CurrentValue = changed; entity.MarkAsUpdated(actor.Id); }
        }
    }
}

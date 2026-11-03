using SESMT.Domain.Common.AggregateRoot;

namespace SESMT.Domain.Modules.Training.Entities;

/// <summary>Administrative course attendance; does not certify qualification or release work.</summary>
public sealed class TrainingRecord : AggregateRootBase
{
    public Guid CompanyId { get; private set; }
    public Guid UnitId { get; private set; }
    public Guid WorkerId { get; private set; }
    public Guid CommandId { get; private set; }
    public string Title { get; private set; } = "";
    public string? Reference { get; private set; }
    public string Kind { get; private set; } = "INITIAL";
    public DateOnly CompletedOn { get; private set; }
    public DateOnly? RenewalOn { get; private set; }
    public int DurationMinutes { get; private set; }
    public string? Provider { get; private set; }
    public string? Instructor { get; private set; }
    public string? Venue { get; private set; }
    public string? Content { get; private set; }
    public string? Notes { get; private set; }
    public DateTimeOffset? RevokedAt { get; private set; }
    public string? RevocationReason { get; private set; }
    public int Revision { get; private set; } = 1;

    private TrainingRecord() { }
    public TrainingRecord(Guid company, Guid unit, Guid worker, Guid command, Guid actor)
    {
        if (new[] { company, unit, worker, command, actor }.Contains(Guid.Empty))
            throw new ArgumentException("Empresa, unidade, trabalhador e responsável são obrigatórios.");
        CompanyId = company; UnitId = unit; WorkerId = worker; CommandId = command; CreatedBy = actor;
    }
    public void Set(string title, string? reference, string kind, DateOnly completedOn, DateOnly? renewalOn,
        int durationMinutes, string? provider, string? instructor, string? venue, string? content, string? notes)
    {
        if (RevokedAt.HasValue) throw new InvalidOperationException("O registro foi invalidado.");
        if (string.IsNullOrWhiteSpace(title) || title.Trim().Length > 160 || reference?.Length > 40
            || kind is not ("INITIAL" or "PERIODIC" or "EVENTUAL") || completedOn == default || renewalOn < completedOn
            || durationMinutes is < 1 or > 600000 || provider?.Length > 160 || instructor?.Length > 160
            || venue?.Length > 160 || content?.Length > 2000 || notes?.Length > 500)
            throw new ArgumentException("Confira os dados do treinamento.");
        Title = title.Trim(); Reference = Clean(reference); Kind = kind; CompletedOn = completedOn; RenewalOn = renewalOn;
        DurationMinutes = durationMinutes; Provider = Clean(provider); Instructor = Clean(instructor); Venue = Clean(venue);
        Content = Clean(content); Notes = Clean(notes);
    }
    public void RecordUpdate(Guid actor) { Revision++; MarkAsUpdated(actor); }
    public void Revoke(string reason, Guid actor, DateTimeOffset now)
    {
        if (RevokedAt.HasValue) throw new InvalidOperationException("O registro já foi invalidado.");
        if (string.IsNullOrWhiteSpace(reason) || reason.Trim().Length is < 3 or > 200)
            throw new ArgumentException("Informe o motivo da invalidação, entre 3 e 200 caracteres.");
        RevokedAt = now; RevocationReason = reason.Trim(); RecordUpdate(actor);
    }
    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}

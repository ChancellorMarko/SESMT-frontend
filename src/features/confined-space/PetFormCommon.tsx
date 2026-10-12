import type { AppointmentDto, PermitSourceCheckDto } from '../../shared/contracts/work-permits';
import { formatDate } from '../../shared/lib/format';
import { Field } from '../../shared/ui';
import styles from './confined-space.module.css';

export function PetAppointment({ appointment }: { appointment: AppointmentDto }) {
  return <section className="panel stack" aria-label="Contexto do atendimento da PET"><h2>{appointment.code} · {appointment.serviceLabel}</h2><dl className={styles.meta}>
    <div><dt>Equipe</dt><dd>{appointment.teamName}</dd></div><div><dt>Local</dt><dd>{appointment.location}</dd></div><div><dt>Período previsto</dt><dd>{formatDate(appointment.startsAt)} até {formatDate(appointment.endsAt)}</dd></div>
    <div><dt>Responsável pelo atendimento</dt><dd>{appointment.responsibleName}</dd></div><div><dt>Participantes previstos</dt><dd>{appointment.participants.length}</dd></div>
  </dl></section>;
}

export function PetSourceChecks({ checks, disabled, onChange }: { checks: PermitSourceCheckDto[]; disabled: boolean; onChange: (checks: PermitSourceCheckDto[]) => void }) {
  const update = (id: string, value: Partial<PermitSourceCheckDto>) => onChange(checks.map(check => check.id === id ? { ...check, ...value } : check));
  return <div className="stack">{checks.map((check, index) => <fieldset className={styles.fieldset} disabled={disabled} key={check.id}><legend>{index + 1}. {check.label}</legend>
    <div className="form-grid"><Field label={`Resposta da verificação ${index + 1}`}><select value={check.answer || ''} onChange={event => update(check.id, { answer: event.target.value ? event.target.value as 'YES' | 'NO' | 'NA' : null })}><option value="">Ainda não respondida</option><option value="YES">Sim</option><option value="NO">Não</option><option value="NA">Não aplicável</option></select></Field>
      <Field label={check.answer === 'NO' || check.answer === 'NA' ? `Justificativa da verificação ${index + 1}` : `Registro da verificação ${index + 1}`}><textarea value={check.note || ''} maxLength={1000} rows={2} onChange={event => update(check.id, { note: event.target.value })} /></Field></div>
    <small className="muted">Referência no modelo: {check.sourceCell || check.id}.</small>
  </fieldset>)}</div>;
}

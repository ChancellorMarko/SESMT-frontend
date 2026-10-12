import type { AppointmentDto, PermitSourceCheckDto } from '../../shared/contracts/work-permits';
import { formatDate } from '../../shared/lib/format';
import { Badge, Field } from '../../shared/ui';
import styles from './authorizations.module.css';

export const sourceAnswerLabel = (answer: PermitSourceCheckDto['answer']) => answer === 'YES' ? 'Sim' : answer === 'NO' ? 'Não' : answer === 'NA' ? 'Não aplicável' : 'Não respondido';
export function AuthorizationAppointment({ appointment }: { appointment: AppointmentDto }) {
  return <section className="panel stack" aria-label="Contexto do atendimento da AT"><h2>{appointment.code} · {appointment.serviceLabel}</h2><dl className={styles.meta}>
    <div><dt>Unidade</dt><dd>{appointment.unitId}</dd></div><div><dt>Equipe</dt><dd>{appointment.teamName}</dd></div><div><dt>Local</dt><dd>{appointment.location}</dd></div>
    <div><dt>Período previsto</dt><dd>{formatDate(appointment.startsAt)} até {formatDate(appointment.endsAt)}</dd></div><div><dt>Responsável pelo atendimento</dt><dd>{appointment.responsibleName}</dd></div><div><dt>Participantes</dt><dd>{appointment.participants.length}</dd></div>
  </dl><ul>{appointment.participants.map(person => <li key={person.workerId}>{person.name} · {person.serviceFunction}</li>)}</ul></section>;
}
export function AuthorizationSourceChecks({ checks, onChange, disabled = false, readOnly = false, prefix }: {
  checks: PermitSourceCheckDto[]; onChange?: (checks: PermitSourceCheckDto[]) => void; disabled?: boolean; readOnly?: boolean; prefix: string;
}) {
  const update = (id: string, patch: Partial<PermitSourceCheckDto>) => onChange?.(checks.map(item => item.id === id ? { ...item, ...patch } : item));
  return <div className="stack">{checks.map((item, index) => <fieldset className={styles.fieldset} disabled={disabled} key={item.id}>
    <legend>{index + 1}. {item.label}</legend>
    {readOnly ? <><Badge tone={item.answer === null ? 'warning' : 'neutral'}>{sourceAnswerLabel(item.answer)}</Badge>{item.note && <p className={styles.preserve}>{item.note}</p>}</> : <>
      <div className={styles.answers}>{(['YES', 'NO', 'NA'] as const).map(answer => <label className={styles.check} key={answer}><input type="radio" name={`${prefix}-${item.id}`} checked={item.answer === answer} onChange={() => update(item.id, { answer })} />{sourceAnswerLabel(answer)}</label>)}</div>
      {(item.id === 'at-check-b24' || item.answer === 'NO' || item.answer === 'NA' || item.note) && <Field label={item.id === 'at-check-b24' ? 'Meios de comunicação de emergência disponíveis *' : `Justificativa da questão ${index + 1} *`}><textarea value={item.note || ''} maxLength={1000} rows={3} onChange={event => update(item.id, { note: event.target.value })} /></Field>}
    </>}
    <small className="muted">Referência no arquivo: {item.sourceCell || item.id}. Resposta documental do modelo recebido.</small>
  </fieldset>)}</div>;
}

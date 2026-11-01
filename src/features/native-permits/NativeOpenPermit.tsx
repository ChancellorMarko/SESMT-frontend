import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import { useVerifiedRead } from '../../shared/lib/verified-read';
import { Button, Feedback, Field, InfoButton, Spinner } from '../../shared/ui';
import type { NativeAppointment } from '../native-operations/contracts';
import { NativeCommandDialog, NativeContextConflict, NativeFormError } from '../native-operations/NativeCommandDialog';
import { assertSameAppointment, checkedOpenedPermit, checkedOpeningContext, checkedOpeningReceipt, loadOpeningContext, OpeningIssue, openingSelection } from './opening';
import styles from '../../shared/ui/NativeRecords.module.css';
import local from './NativeOpening.module.css';

export function NativeOpenPermit({ appointment, onClose, onOpened }: { appointment: NativeAppointment; onClose: () => void; onOpened: (id: string) => void }) {
  const { sessionKey, can } = useSession(), client = useQueryClient(), opened = useRef<string | undefined>(undefined);
  const [chosen, choose] = useState<Record<string, string>>({}), [confirmation, confirm] = useState(false);
  const allowed = can('pt:criar') && can('workers.read');
  const context = useVerifiedRead({ queryKey: ['native-opening', sessionKey, appointment.id, appointment.version], scope: ['native-opening', sessionKey, appointment.id], enabled: allowed,
    request: signal => loadOpeningContext(appointment, signal), validate: value => checkedOpeningContext(value, appointment) });
  const data = context.data, eligible = data?.kind === 'create' ? data.templates.filter(model => model.serviceCodes.every(code => appointment.serviceCodes.includes(code))) : [];
  const groups = [...new Set(eligible.map(template => template.templateId))];
  async function perform(signal: AbortSignal) {
    if (!allowed || !data || context.isFetching || context.isError) throw new NativeFormError('Atualize os modelos e participantes antes de continuar.');
    if (data.kind === 'existing') { opened.current = data.permit.id; return; }
    if (!confirmation) throw new NativeFormError('Confirme os modelos e os participantes antes de abrir a PT.');
    const selection = openingSelection(data, appointment, Object.values(chosen).filter(Boolean));
    assertSameAppointment(await api.get<unknown>(`/appointments/${appointment.id}`, { signal }), appointment);
    let fresh;
    try { fresh = await loadOpeningContext(appointment, signal); }
    catch (failure) { if (failure instanceof OpeningIssue) throw new NativeContextConflict(failure.message); throw failure; }
    if (fresh.kind === 'existing') throw new NativeContextConflict('O agendamento já possui uma PT. Feche a janela e atualize a consulta para abrir o registro existente.');
    let verified;
    try { verified = openingSelection(fresh, appointment, selection.models.map(model => model.id)); }
    catch (failure) { if (failure instanceof NativeFormError) throw new NativeContextConflict('Os modelos foram alterados. Seus dados foram mantidos. Feche a janela e atualize a consulta antes de continuar.'); throw failure; }
    if (!verified.userIds.every(id => selection.userIds.includes(id)) || verified.userIds.length !== selection.userIds.length
      || fresh.people.some(person => !data.people.some(previous => previous.workerId === person.workerId && previous.userId === person.userId))
      || JSON.stringify(verified.models) !== JSON.stringify(selection.models)) throw new NativeContextConflict('Os vínculos ou modelos foram alterados. Seus dados foram mantidos. Feche a janela e atualize a consulta antes de continuar.');
    const receipt = checkedOpeningReceipt(await api.post<unknown>(`/work-permits/appointments/${appointment.id}/pt`, {
      templateVersoes: selection.models.map(model => ({ templateId: model.templateId, versao: model.versao })), participanteIds: selection.userIds,
      expectedAppointmentVersion: appointment.version,
    }, { signal }), selection);
    const permit = checkedOpenedPermit(await api.get<unknown>(`/work-permits/${receipt.id}`, { signal }), appointment, receipt, selection);
    // Preserve the post-write check as well as the server's appointment-version precondition.
    assertSameAppointment(await api.get<unknown>(`/appointments/${appointment.id}`, { signal }), appointment);
    opened.current = permit.id;
  }
  return <NativeCommandDialog title="Abrir permissão de trabalho" dirty={Object.values(chosen).some(Boolean) || confirmation} disabled={!allowed || !data || context.isFetching || context.isError} onClose={onClose} perform={perform} submitLabel={data?.kind === 'existing' ? 'Abrir PT existente' : 'Abrir PT em verificação'} onDone={async () => {
    if (!opened.current) return;
    await Promise.all(['native-permits', 'native-agenda', 'native-appointment', 'native-dashboard', 'native-opening'].map(key => client.invalidateQueries({ queryKey: [key, sessionKey] })));
    onOpened(opened.current);
  }}>{busy => <>
    <strong>{appointment.title}</strong>
    {!allowed && <Feedback tone="warning">Sua conta precisa de acesso à criação de PTs e à consulta dos trabalhadores.</Feedback>}
    {context.isPending && <Spinner/>}{context.isError && <Feedback tone="danger">{context.error instanceof OpeningIssue ? context.error.message : context.error instanceof ApiError && [403, 404].includes(context.error.status) ? 'Não foi possível acessar os participantes ou modelos deste agendamento com sua conta.' : 'Não foi possível conferir os dados da abertura. Feche a janela e atualize o agendamento.'}</Feedback>}
    {data?.kind === 'existing' && <Feedback>Este agendamento já possui uma PT. Abra o registro existente para continuar.</Feedback>}
    {data?.kind === 'create' && <>
      <div className={styles.scroll} role="region" aria-label="Participantes da abertura" tabIndex={0}><table className={`data-table ${local.table}`}><thead><tr><th scope="col">Participante</th><th scope="col">Conta</th></tr></thead><tbody>{data.people.map(person => <tr key={person.workerId}><td>{person.fullName}<small className={local.registration}>{person.registration}</small></td><td><InfoButton title={`Conta vinculada: ${person.fullName}`}><dl className={styles.details}><dt>Trabalhador</dt><dd>{person.workerId}</dd><dt>Usuário</dt><dd>{person.userId}</dd></dl></InfoButton></td></tr>)}</tbody></table></div>
      {!groups.length && <Feedback tone="warning">Não há modelos compatíveis com os serviços deste agendamento.</Feedback>}
      {groups.map(group => { const versions = eligible.filter(model => model.templateId === group).sort((a, b) => b.versao - a.versao); return <Field key={group} label={`Modelo: ${versions[0].nome}`}><select disabled={busy} value={chosen[group] ?? ''} onChange={event => choose(previous => ({ ...previous, [group]: event.target.value }))}><option value="">Não utilizar este modelo</option>{versions.map(model => <option key={model.id} value={model.id} disabled={!model.closingQuestions.length}>Versão {model.versao} · {model.serviceCodes.join(' / ')}{!model.closingQuestions.length ? ' · sem encerramento' : ''}</option>)}</select></Field>; })}
      <InfoButton title="Versões e participantes da abertura"><p>Escolha uma versão por modelo, cobrindo os serviços do agendamento. Os participantes usam o vínculo de conta registrado no cadastro. A PT será aberta em verificação; a abertura não libera a execução.</p></InfoButton>
      <label><input type="checkbox" checked={confirmation} disabled={busy} onChange={event => confirm(event.target.checked)}/> Confirmo os modelos e participantes deste agendamento.</label>
    </>}
  </>}</NativeCommandDialog>;
}

import { useNavigationGuard } from '../../app/navigation/NavigationProtection';
import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PauseCircle, PlayCircle } from 'lucide-react';
import { api, ApiError, revisionEtag } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { WorkPermitDto } from '../../shared/contracts/work-permits';
import { PERMIT_LIFECYCLE_REASON_MAX, type PermitLifecycleCommand, type PermitLifecycleRecordDto } from '../../shared/contracts/permit-lifecycle';
import { formatDate } from '../../shared/lib/format';
import { invalidateConsultation } from '../../shared/lib/consultation-cache';
import { Button, Feedback, Field, Modal } from '../../shared/ui';
import { errorMessage, validateText } from './validation';
import styles from './PermitLifecycleActions.module.css';

const labels: Record<PermitLifecycleCommand, string> = { suspend: 'Suspender operação', resume: 'Retomar operação', cancel: 'Cancelar PT' };
const actionNames: Record<PermitLifecycleCommand, string> = { suspend: 'SUSPEND', resume: 'RESUME', cancel: 'CANCEL' };
type Intent = { revision: number; version: number; state: PermitLifecycleRecordDto['operationStatus'] };

export function PermitLifecycleActions({ permit: value, disabled = false, onBusyChange, sectionId }: {
  permit: WorkPermitDto; disabled?: boolean; onBusyChange?: (busy: boolean) => void; sectionId?: string;
}) {
  const { me, sessionKey, unitId, can } = useSession();
  const client = useQueryClient();
  const permit = value as PermitLifecycleRecordDto;
  const [command, setCommand] = useState<PermitLifecycleCommand>();
  const [intent, setIntent] = useState<Intent>();
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [sameTeam, setSameTeam] = useState(false);
  const [sameConditions, setSameConditions] = useState(false);
  const [failure, setFailure] = useState('');
  const [notice, setNotice] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const readable = can('permits.read') && permit.appointment.unitId === unitId;
  const operator = readable && can('permits.operate') && permit.appointment.responsibleId === me?.user.id;
  const has = (action: PermitLifecycleCommand) => operator && permit.reviewStatus === 'NOT_SUBMITTED' && permit.availableActions.includes(actionNames[action])
    && (action === 'suspend' ? ['RELEASED', 'EXECUTING'].includes(permit.operationStatus) : action === 'resume' ? permit.operationStatus === 'SUSPENDED' : ['VERIFICATION', 'RELEASED', 'SUSPENDED'].includes(permit.operationStatus));
  const staleIntent = Boolean(command && intent && (intent.revision !== permit.revision || intent.version !== permit.version || intent.state !== permit.operationStatus));
  const mutation = useMutation({ mutationFn: async () => {
    if (!command || !intent || staleIntent) throw new Error('A PT mudou. Carregue e confira o estado atual antes de confirmar.');
    if (!has(command) || disabled) throw new Error('Esta ação não está disponível neste momento. Aguarde a confirmação em andamento e confira o estado atual.');
    const body = command === 'resume' ? { reason: reason.trim(), confirmed, sameTeam, sameConditions } : { reason: reason.trim(), confirmed };
    return api.post<WorkPermitDto>(`/work-permits/${permit.id}/${command}`, body, { etag: revisionEtag(intent.revision) });
  }, onSuccess: async updated => {
    client.setQueryData(['work-permit', sessionKey, unitId, permit.id], updated);
    setNotice(command === 'suspend' ? 'Operação suspensa. A retomada exige nova conferência das condições e da documentação.'
      : command === 'resume' ? 'Retomada registrada na mesma versão da PT após conferência.' : 'PT cancelada. O registro e seu histórico foram preservados.');
    setCommand(undefined); setIntent(undefined); setFailure('');
    await Promise.all([
      ...['work-permit', 'work-permits', 'appointments', 'appointment', 'permit-dashboard', 'pt-dashboard', 'eligibility'].map(key => client.invalidateQueries({ queryKey: [key] })),
      invalidateConsultation(client, 'permits', { sessionKey, unitId }),
    ]);
  } });
  const busy = mutation.isPending || refreshing;
  useNavigationGuard({ dirty: Boolean(command), busy });
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);
  useEffect(() => { setCommand(undefined); setIntent(undefined); setReason(''); setFailure(''); setNotice(''); mutation.reset(); }, [permit.id, sessionKey, unitId]);
  useEffect(() => {
    if (!command && !busy) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    const allowLeave = () => {
      if (busy) { setFailure('Aguarde a confirmação da ação antes de sair ou mudar a unidade.'); return false; }
      return window.confirm('Há uma confirmação da PT ainda não enviada. Deseja sair e descartá-la?');
    };
    const beforeContextChange = (event: Event) => { if (!event.defaultPrevented && !allowLeave()) event.preventDefault(); };
    const navigate = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      const destination = new URL(anchor.href, window.location.href);
      if (destination.pathname === window.location.pathname && destination.search === window.location.search) return;
      if (!allowLeave()) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener('beforeunload', beforeUnload); window.addEventListener('sesmt:before-context-change', beforeContextChange);
    document.addEventListener('click', navigate, true);
    return () => { window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('sesmt:before-context-change', beforeContextChange); document.removeEventListener('click', navigate, true); };
  }, [command, busy]);
  function open(action: PermitLifecycleCommand) {
    setCommand(action); setIntent({ revision: permit.revision, version: permit.version, state: permit.operationStatus });
    setReason(''); setConfirmed(false); setSameTeam(false); setSameConditions(false); setFailure(''); setNotice(''); mutation.reset();
  }
  async function refreshCurrent() {
    setRefreshing(true); setFailure('');
    try {
      const latest = await client.fetchQuery({ queryKey: ['work-permit', sessionKey, unitId, permit.id], queryFn: ({ signal }) => api.get<WorkPermitDto>(`/work-permits/${permit.id}`, { signal }), staleTime: 0 });
      setIntent({ revision: latest.revision, version: latest.version, state: (latest as PermitLifecycleRecordDto).operationStatus });
      setConfirmed(false); setSameTeam(false); setSameConditions(false); mutation.reset();
      setFailure('PT atualizada. O motivo foi preservado. Confira os dados e confirme novamente as condições da ação.');
    } catch (error) { setFailure(errorMessage(error)); }
    finally { setRefreshing(false); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setFailure('');
    const error = validateText(reason, 'Motivo', 5, PERMIT_LIFECYCLE_REASON_MAX);
    if (error) { setFailure(error); return; }
    if (!confirmed) { setFailure('Confirme explicitamente esta ação antes de continuar.'); return; }
    if (command === 'resume' && (!sameTeam || !sameConditions)) { setFailure('A retomada exige a mesma equipe e condições conferidas. Mudanças exigem nova análise e uma nova permissão.'); return; }
    try { await mutation.mutateAsync(); } catch { /* Keep the reason and confirmations for the operator to inspect. */ }
  }
  if (!readable) return null;
  const conflict = staleIntent || mutation.error instanceof ApiError && mutation.error.status === 412;
  const visible = has('suspend') || has('resume') || has('cancel') || permit.lifecycle || notice;
  if (!visible) return null;
  return <section id={sectionId} className="panel stack" aria-label="Interrupção e retomada da PT" aria-busy={busy}>
    <div><h2>Interrupção e retomada</h2><p className="muted">Registre uma interrupção, confira as condições para retomar ou encerre a permissão por cancelamento.</p></div>
    {notice && <Feedback tone="success">{notice}</Feedback>}
    {permit.operationStatus === 'SUSPENDED' && <Feedback tone="warning"><strong>Operação suspensa.</strong> {permit.lifecycle?.suspensionReason}<p className="muted">{permit.lifecycle?.suspendedByName} · {formatDate(permit.lifecycle?.suspendedAt)}. Retomar exige a mesma equipe, as condições conferidas e elegibilidade documental atual.</p></Feedback>}
    {permit.operationStatus === 'CANCELED' && <Feedback><strong>PT cancelada.</strong> {permit.lifecycle?.cancellationReason}<p className="muted">Registro preservado para consulta. Uma nova atividade precisa de uma nova PT.</p></Feedback>}
    {permit.lifecycle?.resumedAt && permit.operationStatus !== 'SUSPENDED' && permit.operationStatus !== 'CANCELED' && <p className="muted">Última retomada: {formatDate(permit.lifecycle.resumedAt)} · {permit.lifecycle.resumeReason}</p>}
    {disabled && (has('suspend') || has('resume') || has('cancel')) && <Feedback>Aguarde a confirmação da ação em andamento antes de alterar a operação.</Feedback>}
    <div className="actions">
      {has('suspend') && <Button variant="secondary" disabled={disabled || busy} onClick={() => open('suspend')}><PauseCircle size={16} aria-hidden="true" />Suspender operação</Button>}
      {has('resume') && <Button disabled={disabled || busy} onClick={() => open('resume')}><PlayCircle size={16} aria-hidden="true" />Retomar operação</Button>}
      {has('cancel') && <Button variant="danger" disabled={disabled || busy} onClick={() => open('cancel')}>Cancelar PT</Button>}
    </div>
    <Modal open={Boolean(command)} title={command ? labels[command] : 'Controle da operação'} onClose={() => { if (!busy) { setCommand(undefined); setIntent(undefined); setFailure(''); mutation.reset(); } }}>
      {command && <form className="stack" noValidate onSubmit={event => void submit(event)}>
        <p><strong>{permit.code} · versão {permit.version}</strong></p>
        {command === 'suspend' ? <Feedback tone="warning">Interrompa a atividade em campo e registre o motivo. A preparação, as ciências e o histórico desta versão serão preservados.</Feedback>
          : command === 'resume' ? <Feedback tone="warning">Antes de retomar, confira a equipe, o ambiente e as medidas de controle. A documentação aplicável será conferida novamente. Se houve mudança, mantenha a operação suspensa e solicite nova análise e permissão.</Feedback>
            : <Feedback tone="warning">O cancelamento é definitivo para esta PT e preserva seus documentos e histórico. Uma execução em andamento precisa ser suspensa primeiro.</Feedback>}
        <Field label={command === 'suspend' ? 'Motivo da suspensão *' : command === 'resume' ? 'Conferência para retomada *' : 'Motivo do cancelamento *'}><textarea value={reason} maxLength={PERMIT_LIFECYCLE_REASON_MAX} rows={4} disabled={busy} onChange={event => setReason(event.target.value)} /></Field>
        {command === 'resume' && <><label className={styles.confirmation}><input type="checkbox" checked={sameTeam} disabled={busy} onChange={event => setSameTeam(event.target.checked)} />A equipe e os participantes permanecem os mesmos desta PT.</label><label className={styles.confirmation}><input type="checkbox" checked={sameConditions} disabled={busy} onChange={event => setSameConditions(event.target.checked)} />Conferi as condições do local e os controles; não houve alteração que exija nova análise ou permissão.</label></>}
        <label className={styles.confirmation}><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />{command === 'suspend' ? 'Confirmo a interrupção da operação e o registro deste motivo.' : command === 'resume' ? 'Confirmo a conferência e solicito a retomada desta operação.' : 'Confirmo o cancelamento definitivo desta PT.'}</label>
        {(failure || mutation.isError) && <Feedback tone="danger">{failure || errorMessage(mutation.error)}</Feedback>}
        {conflict && <Feedback tone="warning">A PT foi atualizada. Confira o registro atual antes de confirmar.<div className="actions"><Button variant="secondary" disabled={busy} onClick={() => void refreshCurrent()}>Atualizar PT e preservar motivo</Button></div></Feedback>}
        {command && !has(command) && <Feedback tone="warning">Esta ação já não está disponível no estado atual da PT. Feche a janela e confira o registro.</Feedback>}
        <div className="actions"><Button type="submit" variant={command === 'cancel' ? 'danger' : 'primary'} disabled={busy || disabled || conflict || !has(command)}>{busy ? 'Registrando…' : `Confirmar: ${labels[command].toLocaleLowerCase('pt-BR')}`}</Button><Button variant="secondary" disabled={busy} onClick={() => { setCommand(undefined); setIntent(undefined); setFailure(''); mutation.reset(); }}>Continuar na PT</Button></div>
      </form>}
    </Modal>
  </section>;
}

import { useState } from 'react';
import { api } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import { InvalidReadResponse } from '../../shared/lib/verified-read';
import { Field } from '../../shared/ui';
import { appointmentInstant, appointmentLocal } from '../agenda/support';
import { NativeCommandDialog, NativeFormError } from '../native-operations/NativeCommandDialog';
import { checkedPermit, same, type NativePermit, type PermitDeclarations } from './contracts';

export const permitActions = {
  release: { label: 'Liberar PT', permission: 'pt:liberar', from: ['EM_VERIFICACAO'], to: 'LIBERADA' },
  start: { label: 'Iniciar serviço', permission: 'pt:iniciar', from: ['LIBERADA'], to: 'EM_EXECUCAO' },
  suspend: { label: 'Suspender serviço', permission: 'pt:editar', from: ['EM_EXECUCAO'], to: 'SUSPENSA' },
  resume: { label: 'Retomar serviço', permission: 'pt:iniciar', from: ['SUSPENSA'], to: 'EM_EXECUCAO' },
  cancel: { label: 'Cancelar PT', permission: 'pt:editar', from: ['EM_VERIFICACAO', 'LIBERADA'], to: 'CANCELADA' },
  observations: { label: 'Registrar observação', permission: 'pt:editar', from: ['EM_EXECUCAO', 'SUSPENSA'], to: null },
} as const;
export type PermitAction = keyof typeof permitActions;
export function actionNeedsReadiness(action: PermitAction) { return ['release', 'start', 'resume'].includes(action); }
export function permitActionAllowed(item: NativePermit, action: PermitAction, can: (permission: string) => boolean) {
  return can(permitActions[action].permission) && (permitActions[action].from as readonly string[]).includes(item.status);
}

export function NativePermitAction({ item, action, context, onClose, onDone }: {
  item: NativePermit; action: PermitAction; context?: PermitDeclarations['context']; onClose: () => void; onDone: () => Promise<void>;
}) {
  const { can } = useSession();
  const [reason, setReason] = useState(''), [confirmation, confirm] = useState(false);
  const [from, setFrom] = useState(context ? appointmentLocal(context.from) : ''), [until, setUntil] = useState(context ? appointmentLocal(context.until) : '');
  const release = action === 'release', observation = action === 'observations', needsReason = ['suspend', 'cancel', 'observations', 'release'].includes(action);
  const limit = release ? 2000 : observation ? 4000 : 1000;
  async function perform(signal: AbortSignal) {
    if (!permitActionAllowed(item, action, can)) throw new NativeFormError('Confira seus acessos e atualize a PT antes desta operação.');
    if (needsReason && (!reason.trim() || reason.trim().length > limit)) throw new NativeFormError(`Preencha o texto solicitado, com até ${limit.toLocaleString('pt-BR')} caracteres.`);
    if (!confirmation) throw new NativeFormError('Confirme a operação antes de continuar.');
    const start = appointmentInstant(from), end = appointmentInstant(until);
    if (release && (!context || !start || !end || Date.parse(end) <= Date.parse(start) || Date.parse(end) <= Date.now()
      || Date.parse(start) < Date.parse(context.from) || Date.parse(end) > Date.parse(context.until))) throw new NativeFormError('Informe uma janela válida dentro do agendamento, com término futuro, em Brasília.');
    const payload = release ? { expectedVersion: item.version, conditions: reason.trim(), authorizedFrom: start, authorizedUntil: end, confirmation: true }
      : observation ? { expectedVersion: item.version, observation: reason.trim() }
      : needsReason ? { expectedVersion: item.version, reason: reason.trim() } : { expectedVersion: item.version };
    const updated = checkedPermit(await api.post<unknown>(`/work-permits/${item.id}/${action}`, payload, { signal }), item.id);
    if (updated.version !== item.version + 1 || updated.contentVersion !== item.contentVersion || updated.companyId !== item.companyId
      || updated.appointmentId !== item.appointmentId || updated.title !== item.title || updated.serviceCode !== item.serviceCode
      || !same(updated.templateVersionIds, item.templateVersionIds) || !same(updated.participants.map(person => person.userId), item.participants.map(person => person.userId))
      || updated.status !== (permitActions[action].to ?? item.status)
      || release && (!updated.releasedAt || updated.releaseConditions !== reason.trim() || Date.parse(updated.authorizedFrom ?? '') !== Date.parse(start!) || Date.parse(updated.authorizedUntil ?? '') !== Date.parse(end!))
      || action === 'start' && !updated.startedAt
      || action === 'suspend' && (!updated.suspendedAt || updated.suspensionReason !== reason.trim())
      || action === 'cancel' && (!updated.cancelledAt || updated.cancellationReason !== reason.trim())
      || observation && ((updated.observations ?? []).length !== (item.observations ?? []).length + 1 || updated.observations?.at(-1)?.text !== reason.trim())) throw new InvalidReadResponse();
  }
  return <NativeCommandDialog title={permitActions[action].label} dirty={Boolean(reason || confirmation || release && (from !== appointmentLocal(context?.from ?? '') || until !== appointmentLocal(context?.until ?? '')))} onClose={onClose} onDone={onDone} perform={perform} submitLabel="Confirmar operação">{busy => <>
    <p>{item.title} · versão {item.version}</p>
    {release && <><Field label="Autorizada de (Brasília)" required><input type="datetime-local" value={from} disabled={busy} onChange={event => setFrom(event.target.value)}/></Field><Field label="Autorizada até (Brasília)" required><input type="datetime-local" value={until} disabled={busy} onChange={event => setUntil(event.target.value)}/></Field></>}
    {needsReason && <Field label={release ? 'Condições da liberação' : observation ? 'Observação' : 'Motivo'} required><textarea value={reason} maxLength={limit} disabled={busy} onChange={event => setReason(event.target.value)}/></Field>}
    <label><input type="checkbox" checked={confirmation} disabled={busy} onChange={event => confirm(event.target.checked)}/> Confirmo {release ? 'as condições e a janela de autorização' : 'esta operação na PT selecionada'}.</label>
  </>}</NativeCommandDialog>;
}

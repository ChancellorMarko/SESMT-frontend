import { useState } from 'react';
import { Link } from 'react-router';
import { z } from 'zod';
import { api, ApiError } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import { formatDate } from '../../shared/lib/format';
import { InvalidReadResponse, useVerifiedRead } from '../../shared/lib/verified-read';
import { Feedback, Field, Spinner } from '../../shared/ui';
import { NativeCommandDialog, NativeContextConflict, NativeFormError } from '../native-operations/NativeCommandDialog';

// TeamsController + TeamDeactivationService, backend PR #53.
const id = z.guid().transform(value => value.toLowerCase());
const instant = z.string().refine(value => !Number.isNaN(Date.parse(value)) && /Z|[+-]\d{2}:\d{2}$/.test(value));
const blocker = z.strictObject({ appointmentId: id, startsAt: instant, endsAt: instant, status: z.enum(['REQUESTED', 'CONFIRMED']),
  workPermitStatus: z.enum(['EM_VERIFICACAO', 'LIBERADA', 'EM_EXECUCAO', 'SUSPENSA', 'CONCLUIDA', 'CANCELADA']).nullable() });
const impact = z.strictObject({ teamId: id, name: z.string().trim().min(1).max(200), version: z.number().int().min(1), canDeactivate: z.boolean(),
  blockingAppointmentCount: z.number().int().nonnegative(), blockingAppointments: z.array(blocker).max(20), activeInviteCount: z.number().int().nonnegative() });
export type TeamDeactivationImpact = z.infer<typeof impact>;

export function checkedTeamDeactivationImpact(value: unknown, teamId: string): TeamDeactivationImpact {
  const parsed = impact.safeParse(value);
  if (!parsed.success) throw new InvalidReadResponse();
  const data = parsed.data;
  if (data.teamId !== teamId.toLowerCase() || data.canDeactivate !== (data.blockingAppointmentCount === 0)
    || data.blockingAppointments.length !== Math.min(data.blockingAppointmentCount, 20)
    || new Set(data.blockingAppointments.map(item => item.appointmentId)).size !== data.blockingAppointments.length) throw new InvalidReadResponse();
  return data;
}

const appointmentLabels = { REQUESTED: 'Solicitado', CONFIRMED: 'Confirmado' } as const;
const permitLabels = { EM_VERIFICACAO: 'PT em verificação', LIBERADA: 'PT liberada', EM_EXECUCAO: 'PT em execução', SUSPENSA: 'PT suspensa', CONCLUIDA: 'PT concluída', CANCELADA: 'PT cancelada' } as const;

function Blockers({ data }: { data: TeamDeactivationImpact }) {
  const { can } = useSession(), linked = can('agenda:ler');
  return <div className="stack">
    <Feedback tone="warning">A equipe tem {data.blockingAppointmentCount} agendamento(s) futuro(s) ou com PT em andamento. Cancele ou transfira esses agendamentos para outra equipe antes de desativar.</Feedback>
    <ul aria-label="Agendamentos que impedem a desativação">{data.blockingAppointments.map(item => <li key={item.appointmentId}>
      {linked ? <Link to={`/app/agenda/${item.appointmentId}`}>{formatDate(item.startsAt)}</Link> : formatDate(item.startsAt)} · {appointmentLabels[item.status]}{item.workPermitStatus && ` · ${permitLabels[item.workPermitStatus]}`}
    </li>)}</ul>
    {data.blockingAppointmentCount > data.blockingAppointments.length && <p>Mais {data.blockingAppointmentCount - data.blockingAppointments.length} agendamento(s) não listado(s).</p>}
  </div>;
}

/** Reads the impacts first; deactivation sends the reviewed revision and a reason, and the API re-checks everything. */
export function NativeTeamDeactivation({ team, onClose, onDone }: { team: { id: string; name: string }; onClose: () => void; onDone: (name: string) => Promise<void> }) {
  const { sessionKey } = useSession(), [reason, setReason] = useState('');
  const read = useVerifiedRead({ queryKey: ['native-team-deactivation', sessionKey, team.id], scope: ['native-team-deactivation', sessionKey, team.id], enabled: true,
    request: signal => api.get<unknown>(`/teams/${encodeURIComponent(team.id)}/deactivation-impact`, { signal }), validate: value => checkedTeamDeactivationImpact(value, team.id) });
  const data = read.data, trimmed = reason.trim();
  async function perform(signal: AbortSignal) {
    if (!data?.canDeactivate) throw new NativeContextConflict('Esta equipe ainda tem agendamentos pendentes.');
    if (trimmed.length < 3 || trimmed.length > 200) throw new NativeFormError('Informe o motivo da desativação, entre 3 e 200 caracteres.');
    try { await api.post<unknown>(`/teams/${encodeURIComponent(team.id)}/deactivate`, { expectedVersion: data.version, reason: trimmed }, { signal }); }
    catch (failure) {
      if (failure instanceof ApiError && failure.status === 409 && failure.code === 'TEAM_HAS_PENDING_APPOINTMENTS') {
        await read.refetch();
        throw new NativeContextConflict('Surgiram agendamentos pendentes para esta equipe. Confira a lista acima.');
      }
      throw failure;
    }
  }
  return <NativeCommandDialog title="Desativar equipe" dirty={Boolean(trimmed)} submitLabel="Confirmar desativação"
    disabled={!data?.canDeactivate} onClose={onClose} perform={perform} onDone={() => onDone(team.name)}>
    {busy => <div className="stack">
      <p>Desativar a equipe <strong>{team.name}</strong>?</p>
      {read.isPending ? <Spinner/> : read.isError ? <Feedback tone="danger">{read.error instanceof ApiError && [403, 404].includes(read.error.status) ? 'A API não autorizou ou não encontrou esta equipe. Atualize a lista.' : 'Não foi possível conferir os impactos da desativação. Feche e tente novamente.'}</Feedback>
        : data && (data.canDeactivate ? <>
          <Feedback tone="warning">A equipe deixa de aparecer nas consultas e não pode ser escolhida em novos agendamentos. Agendamentos já encerrados mantêm a equipe no histórico.{data.activeInviteCount > 0 && ` ${data.activeInviteCount} convite(s) ativo(s) desta equipe serão revogados.`}</Feedback>
          <Field label="Motivo da desativação" required><textarea value={reason} minLength={3} maxLength={200} disabled={busy} onChange={event => setReason(event.target.value)}/></Field>
          <small>O motivo fica registrado na auditoria.</small>
        </> : <Blockers data={data}/>)}
    </div>}
  </NativeCommandDialog>;
}

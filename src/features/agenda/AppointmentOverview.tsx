import { useId, type ReactNode } from 'react';
import { BriefcaseBusiness, Clock3, History, MapPin, UserRound, UsersRound } from 'lucide-react';
import type { AppointmentDto } from '../../shared/contracts/work-permits';
import { formatDate } from '../../shared/lib/format';
import { Badge, Feedback } from '../../shared/ui';
import { appointmentLabels } from './support';

const eventLabels: Record<string, string> = { CREATED: 'Agendamento solicitado', APPOINTMENT_CREATED: 'Agendamento solicitado', APPOINTMENT_REQUESTED: 'Agendamento solicitado', CONFIRMED: 'Agendamento confirmado', CONFIRM: 'Agendamento confirmado', APPOINTMENT_CONFIRMED: 'Agendamento confirmado', RESCHEDULED: 'Serviço reagendado', RESCHEDULE: 'Serviço reagendado', APPOINTMENT_RESCHEDULED: 'Serviço reagendado', CANCELED: 'Agendamento cancelado', CANCEL: 'Agendamento cancelado', APPOINTMENT_CANCELED: 'Agendamento cancelado', ATTENDANCE_OPENED: 'Atendimento aberto em campo', OPEN_PERMIT: 'Atendimento aberto em campo', EVIDENCE_UPLOADED: 'Evidência enviada', EVIDENCE_SUBMITTED: 'Evidência enviada', EVIDENCE_REVIEWED: 'Conferência documental registrada' };

export function AppointmentSummary({ appointment: data, actions }: { appointment: AppointmentDto; actions: ReactNode[] }) {
  const titleId = useId();
  const hasActions = actions.some(Boolean);
  const requestedPeriod = data.requestedStartsAt && data.requestedEndsAt
    ? `${formatDate(data.requestedStartsAt)} até ${formatDate(data.requestedEndsAt)}`
    : `${formatDate(data.startsAt)} até ${formatDate(data.endsAt)}`;
  const confirmedPeriod = data.confirmedStartsAt && data.confirmedEndsAt
    ? `${formatDate(data.confirmedStartsAt)} até ${formatDate(data.confirmedEndsAt)}`
    : data.status !== 'REQUESTED' && data.status !== 'CANCELED' ? `${formatDate(data.startsAt)} até ${formatDate(data.endsAt)}` : undefined;
  const hasTimeAdjustment = Boolean(confirmedPeriod && data.requestedStartsAt && data.confirmedStartsAt && (data.requestedStartsAt !== data.confirmedStartsAt || data.requestedEndsAt !== data.confirmedEndsAt));
  const metadata = [
    { label: 'Equipe', value: data.teamName, icon: UsersRound },
    { label: 'Responsável pelo atendimento', value: data.responsibleName, icon: UserRound },
    { label: 'Local do serviço', value: data.location, icon: MapPin },
    { label: 'Participantes', value: `${data.participants.length} pessoa(s)`, icon: UsersRound },
  ];

  return <section className="panel flex flex-col gap-6" aria-labelledby={titleId}>
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 id={titleId} className="!m-0 !text-base text-[#315884]">Dados do atendimento</h2><Badge tone={data.status === 'CANCELED' ? 'neutral' : data.status === 'REQUESTED' ? 'warning' : 'success'}>{appointmentLabels[data.status]}</Badge></div>
    <div className="grid gap-4 rounded-2xl border border-slate-100 bg-slate-50/65 p-4 sm:grid-cols-2 sm:p-5">
      <div className="min-w-0"><span className="mb-2 flex items-start gap-1.5 text-[11px] leading-5 text-slate-500"><Clock3 size={14} className="mt-0.5 shrink-0" aria-hidden="true" />Horário solicitado pela equipe</span><strong className="block text-[13px] font-medium leading-6 text-slate-600 [overflow-wrap:anywhere]">{requestedPeriod}</strong></div>
      <div className="min-w-0"><span className="mb-2 block text-[11px] leading-5 text-slate-500">Horário operacional confirmado</span>{confirmedPeriod ? <><strong className="block text-[13px] font-semibold leading-6 text-[#315884] [overflow-wrap:anywhere]">{confirmedPeriod}</strong>{hasTimeAdjustment && <div className="mt-2"><Badge tone="info">Ajustado na confirmação</Badge></div>}</> : <span className="block text-[12px] leading-6 text-slate-500">{data.status === 'CANCELED' ? 'Agendamento cancelado' : 'Aguardando confirmação operacional'}</span>}</div>
    </div>
    <dl className="m-0 grid gap-x-5 gap-y-5 sm:grid-cols-2">
      {metadata.map(item => <div key={item.label} className="min-w-0"><dt className="mb-1.5 flex items-start gap-1.5 text-[11px] leading-5 text-slate-500"><item.icon size={14} className="mt-0.5 shrink-0" aria-hidden="true" />{item.label}</dt><dd className="m-0 text-[13px] font-medium leading-6 text-slate-700 [overflow-wrap:anywhere]">{item.value}</dd></div>)}
      <div className="min-w-0 sm:col-span-2"><dt className="mb-1.5 flex items-start gap-1.5 text-[11px] leading-5 text-slate-500"><BriefcaseBusiness size={14} className="mt-0.5 shrink-0" aria-hidden="true" />Serviços agendados</dt><dd className="m-0 text-[13px] font-medium leading-6 text-slate-700 [overflow-wrap:anywhere]">{data.serviceLabel}</dd></div>
    </dl>
    {data.notes && <div className="rounded-2xl border border-slate-100 p-4"><h3 className="!mb-2 !text-xs text-slate-600">Observações</h3><p className="!m-0 whitespace-pre-wrap text-[12px] leading-6 text-slate-600 [overflow-wrap:anywhere]">{data.notes}</p></div>}
    {(hasActions || data.status !== 'CANCELED') && <div className="flex flex-col gap-4 border-t border-slate-100 pt-5">{hasActions && <div><h3 className="!mb-3 !text-xs text-slate-600">Ações do atendimento</h3><div className="actions">{actions}</div></div>}{data.status !== 'CANCELED' && <Feedback tone="info">Abrir o atendimento inicia a verificação em campo. A execução exige liberação explícita na PT pelo responsável designado.</Feedback>}</div>}
  </section>;
}

export function AppointmentHistory({ history }: { history: AppointmentDto['history'] }) {
  const titleId = useId();
  return <section className="panel flex min-w-0 flex-col gap-5 self-start" aria-labelledby={titleId}>
    <div><div className="flex items-center gap-2"><History size={16} className="shrink-0 text-[#6582b0]" aria-hidden="true" /><h2 id={titleId} className="!m-0 !text-base text-[#315884]">Histórico do agendamento</h2></div><p className="mt-2 !mb-0 text-[11px] leading-5 text-slate-500">Alterações registradas neste atendimento.</p></div>
    {history.length ? <ol className="m-0 list-none p-0">{history.map((event, index) => <li key={event.id} className={`relative ml-1 border-l border-slate-200 pl-5 ${index < history.length - 1 ? 'pb-6' : ''}`}><span className="absolute -left-1 top-1.5 size-2 rounded-full border-2 border-white bg-[#8aa6c5]" aria-hidden="true" /><strong className="block text-[12px] font-semibold leading-5 text-slate-700 [overflow-wrap:anywhere]">{eventLabels[event.action] || event.action.replaceAll('_', ' ')}</strong><p className="mt-1 !mb-0 text-[11px] leading-5 text-slate-500 [overflow-wrap:anywhere]">{event.actorName}</p><time dateTime={event.occurredAt} className="text-[10px] leading-5 text-slate-500">{formatDate(event.occurredAt)}</time>{event.reason && <p className="mt-2 !mb-0 whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-[12px] leading-6 text-slate-600 [overflow-wrap:anywhere]">{event.reason}</p>}</li>)}</ol> : <p className="!m-0 rounded-2xl bg-slate-50 p-4 text-[12px] leading-6 text-slate-500">Nenhum evento registrado.</p>}
  </section>;
}

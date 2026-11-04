import { ArrowUpRight, CalendarDays } from 'lucide-react';
import { Link } from 'react-router';
import type { AppointmentDto } from '../../shared/contracts/work-permits';
import { formatDate } from '../../shared/lib/format';
import { Badge } from '../../shared/ui';
import { useSession } from '../../shared/auth/SessionProvider';
import { permitAgendaNavigation } from './permit-agenda-navigation';
import { appointmentLabels } from './support';
import styles from './Agenda.module.css';

interface AgendaListProps {
  appointments: AppointmentDto[];
  searchString: string;
  canReadPermits: boolean;
}

const cell = '!align-top [overflow-wrap:anywhere] max-md:!border-0 max-md:!px-4 max-md:!py-2.5';
const label = 'mb-1.5 block text-[11px] font-medium text-slate-500 md:hidden';

/** A single semantic table whose rows become appointment cards on small screens. */
export function AgendaList({ appointments, searchString, canReadPermits }: AgendaListProps) {
  const { sessionKey, unitId } = useSession();
  return (
    <table role="table" aria-label="Atendimentos da agenda" className={`data-table !min-w-0 table-fixed max-md:block ${styles.agendaTable}`}>
      <thead role="rowgroup" className="max-md:sr-only">
        <tr role="row">
          <th role="columnheader" scope="col" className="!whitespace-normal md:w-[25%]">Serviço e equipe</th>
          <th role="columnheader" scope="col" className="!whitespace-normal md:w-[25%]">Período do atendimento</th>
          <th role="columnheader" scope="col" className="!whitespace-normal md:w-[21%]">Local e responsável</th>
          <th role="columnheader" scope="col" className="!whitespace-normal md:w-[12%]">Situação</th>
          <th role="columnheader" scope="col" className="!whitespace-normal md:w-[17%]">Ações</th>
        </tr>
      </thead>
      <tbody role="rowgroup" className="max-md:grid max-md:gap-3 max-md:bg-slate-50/50 max-md:p-3">
        {appointments.map(appointment => {
          const detailsPath = `/app/agenda/${encodeURIComponent(appointment.id)}`;
          const hasAdjustment = Boolean(
            appointment.confirmedStartsAt &&
            appointment.requestedStartsAt &&
            (appointment.confirmedStartsAt !== appointment.requestedStartsAt || appointment.confirmedEndsAt !== appointment.requestedEndsAt)
          );

          return (
            <tr key={appointment.id} role="row" className={`group max-md:grid max-md:grid-cols-2 max-md:rounded-2xl max-md:border max-md:border-slate-100 max-md:bg-white max-md:pb-2 ${styles.appointmentRow}`}>
              <td role="cell" className={`${cell} max-md:col-span-2 max-md:!py-4`}>
                <div className="flex min-w-0 items-start gap-3">
                  <span className={styles.serviceMark}>
                    <CalendarDays size={17} strokeWidth={1.7} aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <div className={styles.serviceCode}>{appointment.code}</div>
                    <Link to={detailsPath} state={{ fromSearch: searchString }} className={styles.serviceLink}>
                      <span className="min-w-0 [overflow-wrap:anywhere]">{appointment.serviceLabel}</span>
                      <ArrowUpRight size={13} className="shrink-0 text-slate-400 transition-colors group-hover:text-indigo-600" aria-hidden="true" />
                    </Link>
                    <small>{appointment.teamName}</small>
                    <small>Participantes: {appointment.participants.length} pessoa(s)</small>
                  </div>
                </div>
              </td>
              <td role="cell" className={`${cell} max-md:col-span-2`}>
                <span aria-hidden="true" className={label}>Período do atendimento</span>
                <div className="grid gap-2 text-[12px] leading-5 text-slate-600 tabular-nums max-md:grid-cols-2">
                  <div>
                    <span className="block text-[11px] text-slate-500">Início</span>
                    <time dateTime={appointment.startsAt}>{formatDate(appointment.startsAt)}</time>
                  </div>
                  <div>
                    <span className="block text-[11px] text-slate-500">Término previsto</span>
                    <time dateTime={appointment.endsAt}>{formatDate(appointment.endsAt)}</time>
                  </div>
                </div>
                {appointment.status === 'REQUESTED' && <small>(Solicitado)</small>}
                {appointment.status === 'CONFIRMED' && <small>(Confirmado)</small>}
                {hasAdjustment && <span className="mt-2 inline-flex"><Badge tone="neutral">Horário ajustado</Badge></span>}
                <details className={`mt-2 text-[11px] leading-5 ${styles.requestDetails}`}>
                  <summary className="w-fit cursor-pointer rounded-sm py-1 text-[#315884] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 max-md:min-h-11 max-md:content-center">
                    Horário de solicitação
                  </summary>
                  <p className="mt-1 mb-0 text-slate-500">
                    {appointment.requestedStartsAt
                      ? `${formatDate(appointment.requestedStartsAt)} até ${formatDate(appointment.requestedEndsAt || appointment.endsAt)}`
                      : `${formatDate(appointment.startsAt)} até ${formatDate(appointment.endsAt)}`}
                  </p>
                </details>
              </td>
              <td role="cell" className={`${cell} max-md:col-span-2`}>
                <span aria-hidden="true" className={label}>Local e responsável</span>
                <span className="block text-[12px] leading-5 text-slate-600">{appointment.location}</span>
                <small>Responsável: {appointment.responsibleName}</small>
              </td>
              <td role="cell" className={`${cell} max-md:col-span-2 [&_.badge]:max-w-full [&_.badge]:whitespace-normal [&_.badge]:text-left [&_.badge]:[overflow-wrap:anywhere]`}>
                <span aria-hidden="true" className={label}>Situação</span>
                <Badge tone={appointment.status === 'CANCELED' ? 'neutral' : appointment.status === 'REQUESTED' ? 'warning' : 'success'}>
                  {appointmentLabels[appointment.status]}
                </Badge>
              </td>
              <td role="cell" className={`${cell} max-md:col-span-2`}>
                <div className="flex min-w-0 flex-wrap items-start gap-2 md:flex-col">
                  <Link className="button button--secondary max-w-full" to={detailsPath} state={{ fromSearch: searchString }}>
                    Consultar atendimento
                  </Link>
                  {appointment.permitId && canReadPermits && (
                    <Link className="button button--ghost max-w-full" to={`/app/pts/${encodeURIComponent(appointment.permitId)}`} state={permitAgendaNavigation({ permitAgendaReturnTo: { permitId: appointment.permitId, appointmentId: appointment.id, unitId, sessionKey, source: 'agenda', search: searchString } }, sessionKey, unitId, appointment.permitId)}>
                      Ver PT →
                    </Link>
                  )}
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowUpRight, Clock3, LockKeyhole, MapPin, ShieldCheck, UserRound, UsersRound } from 'lucide-react';
import type { ParticipantEligibilityDto } from '../../shared/contracts/work-permits';
import { isWorkerIntegrationItem } from '../../shared/lib/eligibility-source';
import { formatDate } from '../../shared/lib/format';
import { Badge, Feedback } from '../../shared/ui';
import { statusLabels, type ReadinessGroup } from './readiness';

export interface ReadinessAppointmentProps {
  group: ReadinessGroup;
  canReadAppointments: boolean;
  canManageEligibility: boolean;
  canReadPermits: boolean;
  renderIntegrationLink: (person: ParticipantEligibilityDto) => ReactNode;
  appointmentState?: unknown;
}

/** Read-only administrative summary: eligibility and each requirement's status come from the API. */
export function ReadinessAppointment({ group: { row, people }, canReadAppointments, canManageEligibility, canReadPermits, renderIntegrationLink, appointmentState }: ReadinessAppointmentProps) {
  const appointmentAction = canManageEligibility ? 'Abrir conferência' : 'Consultar atendimento';

  return (
    <section
      aria-label={`Pendências de ${row.appointmentCode}`}
      className="min-w-0 overflow-hidden rounded-[24px] border border-slate-200/80 bg-white [&_.badge]:max-w-full [&_.badge]:whitespace-normal [&_.badge]:text-center [&_.badge]:[overflow-wrap:anywhere]"
    >
      <header className="flex min-w-0 flex-col gap-5 border-b border-slate-100 px-4 py-5 sm:px-6 sm:py-6">
        <div className="min-w-0 [overflow-wrap:anywhere]">
          <p className="!m-0 text-[11px] font-semibold leading-5 tracking-[0.12em] text-[#6582a5]">{row.appointmentCode}</p>
          <h2 className="mt-2 !mb-0 !text-[18px] font-semibold leading-7 text-[#244a77]">{row.serviceLabel}</h2>
        </div>
        <dl className="m-0 grid min-w-0 gap-x-6 gap-y-4 sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="mb-1 flex items-center gap-1.5 text-[11px] leading-5 text-slate-500"><UsersRound size={14} className="shrink-0" aria-hidden="true" />Equipe</dt>
            <dd className="!m-0 text-[13px] font-medium leading-6 text-slate-700 [overflow-wrap:anywhere]">{row.teamName}</dd>
          </div>
          <div className="min-w-0">
            <dt className="mb-1 flex items-center gap-1.5 text-[11px] leading-5 text-slate-500"><MapPin size={14} className="shrink-0" aria-hidden="true" />Local do serviço</dt>
            <dd className="!m-0 text-[13px] font-medium leading-6 text-slate-700 [overflow-wrap:anywhere]">{row.location}</dd>
          </div>
          <div className="min-w-0 sm:col-span-2">
            <dt className="mb-1 flex items-center gap-1.5 text-[11px] leading-5 text-slate-500"><Clock3 size={14} className="shrink-0" aria-hidden="true" />Período do serviço · Horários de Brasília</dt>
            <dd className="!m-0 text-[13px] font-medium leading-6 text-slate-700 [overflow-wrap:anywhere]"><time dateTime={row.startsAt}>{formatDate(row.startsAt)}</time> → <time dateTime={row.endsAt}>{formatDate(row.endsAt)}</time></dd>
          </div>
        </dl>
        {canReadAppointments && (
          <div className="flex min-w-0 flex-wrap border-t border-slate-100 pt-4">
            <Link
              className="button button--secondary min-h-11 max-w-full whitespace-normal text-center [overflow-wrap:anywhere]"
              aria-label={`${appointmentAction} de ${row.appointmentCode}`}
              to={`/app/agenda/${encodeURIComponent(row.appointmentId)}`}
              state={appointmentState}
            >
              {appointmentAction}<ArrowUpRight size={15} className="shrink-0" aria-hidden="true" />
            </Link>
          </div>
        )}
      </header>

      <div className="grid min-w-0 gap-4 bg-slate-50/55 px-3 py-4 sm:px-5 sm:py-5">
        {people.map(person => (
          <article key={person.workerId} className="min-w-0 overflow-hidden rounded-[22px] border border-slate-200/80 bg-white">
            <header className="flex min-w-0 flex-wrap items-start gap-3 border-b border-slate-100 px-4 py-4 sm:px-5">
              <span className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${person.eligible ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`} aria-hidden="true">
                {person.eligible ? <ShieldCheck size={18} /> : <UserRound size={18} />}
              </span>
              <div className="min-w-0 flex-1 basis-40 [overflow-wrap:anywhere]">
                <h3 className="!m-0 !text-[14px] font-semibold leading-6 text-slate-900">{person.name}</h3>
                <p className="mt-1 !mb-0 text-xs leading-5 text-slate-500">Função no serviço: <span className="font-medium text-slate-700">{person.serviceFunction}</span></p>
              </div>
              <Badge tone={person.eligible ? 'success' : 'warning'}>{person.eligible ? 'Documentação conferida' : 'Pendência documental'}</Badge>
            </header>

            {person.items.length ? (
              <ul className="!m-0 list-none divide-y divide-slate-100 !p-0">
                {person.items.map(item => (
                  <li key={item.requirementId} className="flex min-w-0 flex-wrap items-start gap-x-4 gap-y-2 px-4 py-4 sm:px-5">
                    <div className="min-w-0 flex-1 basis-44 [overflow-wrap:anywhere]">
                      <strong className="block text-[13px] font-semibold leading-6 text-slate-800">{item.label}</strong>
                      {item.restricted ? (
                        <p className="mt-2 !mb-0 flex items-start gap-1.5 text-xs leading-5 text-slate-500"><LockKeyhole size={13} className="mt-1 shrink-0" aria-hidden="true" /><span>Conferência restrita por profissional autorizado.</span></p>
                      ) : item.reason && (
                        <p className="mt-1 !mb-0 whitespace-pre-wrap text-xs leading-5 text-slate-500">{item.reason}</p>
                      )}
                    </div>
                    <Badge tone={item.status === 'APPROVED' ? 'success' : item.status === 'REJECTED' || item.status === 'EXPIRED' ? 'danger' : 'warning'}>{statusLabels[item.status]}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="px-4 py-4 sm:px-5"><Feedback tone="warning">A matriz não definiu requisitos aplicáveis. Confira a configuração antes de liberar.</Feedback></div>
            )}

            {person.items.some(item => !item.restricted && isWorkerIntegrationItem(item)) && (
              <div className="flex min-w-0 flex-wrap items-start border-t border-slate-100 px-4 py-3 sm:px-5 [&_a]:min-h-11 [&_a]:max-w-full [&_a]:whitespace-normal [&_a]:text-center [&_a]:[overflow-wrap:anywhere] [&_p]:min-w-0 [&_p]:text-xs [&_p]:leading-5 [&_p]:[overflow-wrap:anywhere]">
                {renderIntegrationLink(person)}
              </div>
            )}
          </article>
        ))}
      </div>

      <footer className="flex min-w-0 flex-wrap items-center justify-between gap-x-5 gap-y-2 border-t border-slate-100 px-4 py-3 sm:px-6">
        <small className="min-w-0 text-[11px] leading-5 text-slate-500 [overflow-wrap:anywhere]">Matriz {row.eligibility.requirementVersion} · Consulta em {formatDate(row.eligibility.checkedAt)}</small>
        {row.permitId && canReadPermits && <Link className="inline-flex min-h-11 max-w-full items-center gap-2 text-xs font-semibold leading-5 text-[#315884] [overflow-wrap:anywhere] hover:text-blue-700" to={`/app/pts/${encodeURIComponent(row.permitId)}`}>Acompanhar PT <ArrowUpRight size={14} className="shrink-0" aria-hidden="true" /></Link>}
      </footer>
    </section>
  );
}

import type { ReactNode } from 'react';
import { LockKeyhole, ShieldCheck, UserRound } from 'lucide-react';
import type { EligibilityItemDto, ParticipantEligibilityDto } from '../../shared/contracts/work-permits';
import { isWorkerIntegrationItem } from '../../shared/lib/eligibility-source';
import { formatDate } from '../../shared/lib/format';
import { Badge } from '../../shared/ui';
import { evidenceLabels } from './support';

export interface ParticipantRequirementsProps {
  person: ParticipantEligibilityDto;
  canReadWorkers: boolean;
  renderActions: (person: ParticipantEligibilityDto, item: EligibilityItemDto) => ReactNode;
}

/** Presentation only: the API remains responsible for each participant's eligibility. */
export function ParticipantRequirements({ person, canReadWorkers, renderActions }: ParticipantRequirementsProps) {
  return (
    <article
      aria-label={person.name}
      className="min-w-0 overflow-hidden rounded-[22px] border border-slate-200/80 bg-white [&_.badge]:max-w-full [&_.badge]:whitespace-normal [&_.badge]:text-center [&_.badge]:[overflow-wrap:anywhere]"
    >
      <header className="flex min-w-0 flex-wrap items-start gap-3 border-b border-slate-100 px-4 py-5 sm:px-5">
        <span className={`flex size-10 shrink-0 items-center justify-center rounded-2xl ${person.eligible ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`} aria-hidden="true">
          {person.eligible ? <ShieldCheck size={19} /> : <UserRound size={19} />}
        </span>
        <div className="min-w-0 flex-1 basis-40 [overflow-wrap:anywhere]">
          <h3 className="!m-0 text-[15px] font-semibold leading-6 text-slate-900">{person.name}</h3>
          <p className="mt-1 !mb-0 text-xs leading-5 text-slate-500">Função neste serviço: <span className="font-medium text-slate-700">{person.serviceFunction}</span></p>
        </div>
        <Badge tone={person.eligible ? 'success' : 'warning'}>
          {person.eligible ? 'Documentação conferida' : 'Pendência documental'}
        </Badge>
      </header>

      {person.items.length ? (
        <div className="divide-y divide-slate-100">
          {person.items.map(item => {
            const canReadEvidence = !isWorkerIntegrationItem(item) || canReadWorkers;
            return (
              <div key={item.requirementId} className="min-w-0 px-4 py-5 sm:px-5">
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-2.5">
                  <h4 className="!m-0 min-w-0 flex-1 basis-40 text-sm font-semibold leading-6 text-slate-800 [overflow-wrap:anywhere]">{item.label}</h4>
                  <Badge tone={item.status === 'APPROVED' ? 'success' : item.status === 'REJECTED' || item.status === 'EXPIRED' ? 'danger' : 'warning'}>
                    {evidenceLabels[item.status]}
                  </Badge>
                </div>

                {item.restricted ? (
                  <p className="mt-3 !mb-0 flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-xs leading-5 text-slate-500 [overflow-wrap:anywhere]">
                    <LockKeyhole size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
                    <span>Conferência restrita por profissional autorizado. Apenas a situação operacional é exibida.</span>
                  </p>
                ) : (
                  <>
                    <div className="mt-2 flex flex-col gap-2 text-xs leading-5 text-slate-500 [overflow-wrap:anywhere] [&_p]:m-0">
                      <p>{item.description}</p>
                      {canReadEvidence && item.fileName && <p className="text-slate-600">Arquivo: {item.fileName}</p>}
                      {canReadEvidence && (item.validFrom || item.validUntil) && (
                        <p>Período da evidência: {item.validFrom ? formatDate(item.validFrom) : 'Início não informado'} → {item.validUntil ? formatDate(item.validUntil) : 'Sem término informado'}</p>
                      )}
                      {item.reason && <p>Conferência: {item.reason}</p>}
                    </div>
                    <div className="mt-3 flex min-w-0 flex-wrap items-start gap-2 empty:hidden [&_a]:min-h-11 [&_a]:max-w-full [&_a]:whitespace-normal [&_a]:text-center [&_a]:[overflow-wrap:anywhere] [&_button]:min-h-11 [&_button]:max-w-full [&_button]:whitespace-normal [&_button]:text-center [&_button]:[overflow-wrap:anywhere] [&_p]:min-w-0 [&_p]:basis-full [&_p]:text-xs [&_p]:leading-5 [&_p]:[overflow-wrap:anywhere]">
                      {renderActions(person, item)}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="!m-0 px-4 py-5 text-sm leading-6 text-slate-500 sm:px-5">Nenhum requisito documental aplicável nesta matriz.</p>
      )}
    </article>
  );
}

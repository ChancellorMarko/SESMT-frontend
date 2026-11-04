import { useEffect, useState } from 'react';
import { z } from 'zod';
import type { WorkAuthorizationStatus } from '../../shared/contracts/work-authorizations';
import type { Tone } from '../../shared/ui';

export const authorizationLabels: Record<WorkAuthorizationStatus, string> = { DRAFT: 'Rascunho', AUTHORIZED: 'Autorizada', SUSPENDED: 'Suspensa', CLOSED: 'Encerrada', CANCELED: 'Cancelada' };
export const authorizationTones: Record<WorkAuthorizationStatus, Tone> = { DRAFT: 'warning', AUTHORIZED: 'success', SUSPENDED: 'warning', CLOSED: 'neutral', CANCELED: 'danger' };
export const authorizationKey = (session: string, unit?: string, id?: string) => ['work-authorization', session, unit, id];
export const authorizationEventLabels: Record<string, string> = {
  AUTHORIZATION_CREATED: 'AT criada', AUTHORIZATION_UPDATED: 'Rascunho salvo', AUTHORIZATION_SCIENCE_COLLECTED: 'Ciência registrada',
  AUTHORIZATION_AUTHORIZED: 'AT autorizada', AUTHORIZATION_REVALIDATED: 'AT revalidada', AUTHORIZATION_SUSPENDED: 'AT suspensa',
  AUTHORIZATION_CLOSED: 'AT encerrada', AUTHORIZATION_CANCELED: 'AT cancelada',
  AUTHORIZATION_ADMIN_CANCELED: 'AT cancelada administrativamente',
};
export function useAuthorizationClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(interval);
  }, []);
  return now;
}
export const identificationLabels = {
  serviceManagement: 'Gerência do serviço', serviceProvider: 'Fornecedor do serviço', activityDescription: 'Descrição da atividade',
  workFront: 'Frente de trabalho', areaManagement: 'Gerência da área', riskAnalysisReference: 'Referência da análise de risco', notes: 'Observações',
};
/** Repete a restrição temporal do contrato; a confirmação do servidor continua obrigatória. */
export function authorizationWindowError(validUntil: string, appointment: { startsAt: string; endsAt: string }, now = Date.now()): string | undefined {
  const end = Date.parse(validUntil), plannedStart = Date.parse(appointment.startsAt), plannedEnd = Date.parse(appointment.endsAt);
  if (![end, plannedStart, plannedEnd, now].every(Number.isFinite) || plannedStart >= plannedEnd) return 'Confira as datas do atendimento e o fim da autorização.';
  if (plannedEnd <= now) return 'O período previsto deste atendimento já terminou. Confira o agendamento antes de autorizar ou revalidar.';
  if (end <= Math.max(now, plannedStart)) return 'O fim da autorização deve ser posterior ao horário atual e ao início previsto do atendimento.';
  if (end > plannedEnd) return 'O fim da autorização não pode ultrapassar o término previsto do atendimento.';
  return undefined;
}
const text = z.string().max(2000, 'Use até 2.000 caracteres.');
export const authorizationDraftSchema = z.object({
  identification: z.object({ serviceManagement: text, serviceProvider: text, activityDescription: text, workFront: text, areaManagement: text, riskAnalysisReference: text, notes: text }),
  foremanId: z.string().max(100), controls: z.array(z.string()).max(15), additionalControls: z.string().max(4000, 'Use até 4.000 caracteres.'),
  checks: z.array(z.object({ id: z.string(), section: z.string(), label: z.string(), answer: z.enum(['YES', 'NO', 'NA']).nullable(), note: z.string().max(1000, 'Use até 1.000 caracteres.').optional(), sourceCell: z.string().optional() })),
  permitId: z.string().nullable().optional(),
});
export function authorizationError(error: unknown) {
  const value = error as { status?: number; message?: string };
  if (value?.status === 403) return 'Seu acesso não permite esta ação na AT desta unidade.';
  if (value?.status === 404) return 'AT não encontrada ou fora do seu alcance.';
  if ([412, 428].includes(value?.status || 0)) return 'A AT mudou. Seu preenchimento foi preservado; confira o registro atual antes de confirmar novamente.';
  return value?.message || 'Não foi possível concluir a ação. Tente novamente.';
}
export function useAuthorizationContextGuard(dirty: boolean, busy: boolean, report: (message: string) => void) {
  useEffect(() => {
    if (!dirty && !busy) return;
    const guard = (event: Event) => {
      if (event.defaultPrevented) return;
      if (busy) { event.preventDefault(); report('Aguarde a confirmação da ação antes de mudar de unidade.'); }
      else if (!window.confirm('Há alterações da AT ainda não enviadas. Deseja trocar de unidade e descartá-las?')) event.preventDefault();
    };
    window.addEventListener('sesmt:before-context-change', guard);
    return () => window.removeEventListener('sesmt:before-context-change', guard);
  }, [dirty, busy, report]);
}

import { z } from 'zod';
import type { AppointmentStatus, EligibilityItemDto, EvidenceStatus, PermitOptionsDto, ParticipantDto } from '../../shared/contracts/work-permits';

export const appointmentLabels: Record<AppointmentStatus, string> = {
  REQUESTED: 'Solicitado', CONFIRMED: 'Confirmado', ATTENDANCE_OPENED: 'Atendimento aberto', CANCELED: 'Cancelado',
};
export const evidenceLabels: Record<EvidenceStatus, string> = {
  MISSING: 'Não enviado', PENDING: 'Aguardando conferência', APPROVED: 'Conferido', REJECTED: 'Rejeitado', EXPIRED: 'Vencido',
};

/** O agendamento usa o horário da unidade em São Paulo, mesmo em outro fuso do navegador. */
export function appointmentInstant(local: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return undefined;
  const [civil, clock] = local.split('T');
  const calendar = new Date(`${civil}T12:00:00Z`);
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== civil) return undefined;
  const [hour, minute] = clock.split(':').map(Number);
  if (hour > 23 || minute > 59) return undefined;
  const date = new Date(`${local}:00-03:00`);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

export function appointmentLocal(instant: string): string {
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: string) => parts.find(part => part.type === type)?.value || '';
  return `${value('year')}-${value('month')}-${value('day')}T${value('hour')}:${value('minute')}`;
}

export function appointmentDateOnly(instant: string): string {
  const local = appointmentLocal(instant);
  return local ? local.slice(0, 10) : '';
}

export function appointmentTimeOnly(instant: string): string {
  const local = appointmentLocal(instant);
  return local ? local.slice(11, 16) : '';
}

export const appointmentFormSchema = z.object({
  teamId: z.string().min(1, 'Selecione a equipe.'),
  serviceTypeId: z.string().min(1, 'Selecione pelo menos um serviço.'),
  serviceTypeIds: z.array(z.string().trim().min(1, 'Selecione serviços válidos.')).min(1, 'Selecione pelo menos um serviço.').max(7, 'Selecione até sete serviços.').optional(),
  responsibleId: z.string().min(1, 'Selecione o responsável pelo atendimento.'),
  location: z.string().trim().min(3, 'Informe o local do serviço.').max(200, 'Use até 200 caracteres.'),
  startsAt: z.string().refine(value => Boolean(appointmentInstant(value)), 'Informe uma data e hora de início válidas.'),
  endsAt: z.string().refine(value => Boolean(appointmentInstant(value)), 'Informe uma data e hora de término válidas.'),
  notes: z.string().trim().max(2000, 'Use até 2.000 caracteres.'),
}).superRefine((value, context) => {
  if (value.serviceTypeIds) {
    if (new Set(value.serviceTypeIds).size !== value.serviceTypeIds.length) context.addIssue({ code: 'custom', path: ['serviceTypeIds'], message: 'Selecione cada serviço uma única vez.' });
    if (value.serviceTypeIds.length && value.serviceTypeId !== value.serviceTypeIds[0]) context.addIssue({ code: 'custom', path: ['serviceTypeIds'], message: 'Confira os serviços selecionados.' });
  }
  const start = appointmentInstant(value.startsAt);
  const end = appointmentInstant(value.endsAt);
  if (start && end && start >= end) context.addIssue({ code: 'custom', path: ['endsAt'], message: 'O término deve ocorrer depois do início.' });
});
export type AppointmentFormValues = z.infer<typeof appointmentFormSchema>;

export function participantError(participants: ParticipantDto[], teamId: string, unitId: string | undefined, options: PermitOptionsDto) {
  const team = options.teams.find(item => item.id === teamId && item.unitId === unitId);
  if (!team) return 'Selecione uma equipe da unidade atual.';
  if (!participants.length) return 'Selecione pelo menos um participante para o serviço.';
  if (new Set(participants.map(item => item.workerId)).size !== participants.length) return 'Cada participante deve aparecer uma única vez.';
  if (participants.some(item => !team.members.some(member => member.workerId === item.workerId))) return 'Um participante não pertence à equipe selecionada.';
  if (participants.some(item => !item.serviceFunction.trim() || item.serviceFunction.trim().length > 100)) return 'Informe a função de cada participante neste serviço, com até 100 caracteres.';
  return undefined;
}

export function evidenceFileError(file?: File) {
  if (!file) return 'Selecione um arquivo.';
  if (file.size === 0) return 'O arquivo está vazio.';
  if (file.size > 5 * 1024 * 1024) return 'Use um arquivo de até 5 MB.';
  if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type) || !/\.(pdf|jpe?g|png)$/i.test(file.name)) return 'Use PDF, JPG ou PNG.';
  return undefined;
}

export function evidenceDatesError(item: Pick<EligibilityItemDto, 'validFromRequired' | 'validUntilRequired'>, validFrom: string, validUntil: string) {
  if (item.validFromRequired && !validFrom) return 'A matriz deste requisito exige a data inicial da vigência.';
  if (item.validUntilRequired && !validUntil) return 'A matriz deste requisito exige a data final da vigência.';
  const validCivil = (value: string) => !value || Boolean(appointmentInstant(`${value}T12:00`));
  if (!validCivil(validFrom) || !validCivil(validUntil)) return 'Informe datas de vigência válidas.';
  if (validFrom && validUntil && validFrom > validUntil) return 'A data final da evidência deve ser igual ou posterior à inicial.';
  return undefined;
}

export { isDownloadUrlAllowed as evidenceDownloadAllowed } from '../../shared/lib/downloads';

export function errorMessage(error: unknown) {
  const candidate = error as { status?: number; message?: string };
  if (candidate?.status === 403) return 'Seu acesso não permite esta operação neste atendimento.';
  if (candidate?.status === 404) return 'Atendimento não encontrado ou indisponível no seu escopo.';
  if (candidate?.status === 409 || candidate?.status === 412) return `${candidate.message || 'Os dados foram alterados.'} Recarregue e revise antes de tentar novamente.`;
  return candidate?.message || 'Não foi possível concluir a operação. Tente novamente.';
}

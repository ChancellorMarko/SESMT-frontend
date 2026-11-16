import { z } from 'zod';
import { api, readNativeWorker } from '../../shared/api/client';
import { InvalidReadResponse } from '../../shared/lib/verified-read';
import { checkedNativeAppointment, checkedNativeServices, nativeId, nativeIds, type NativeAppointment } from '../native-operations/contracts';
import { NativeContextConflict, NativeFormError } from '../native-operations/NativeCommandDialog';
import { checkedTemplates, type NativeTemplate } from './checklists';
import { checkedPermit, same, type NativePermit } from './contracts';

export class OpeningIssue extends Error {}
const browserWorker = z.object({ id: nativeId, companyId: nativeId, fullName: z.string().trim().min(1), registration: z.string().min(1), status: z.literal('ACTIVE') });
const nativeWorker = z.object({ id: nativeId, companyId: nativeId, userId: nativeId.nullable(), active: z.boolean() });
const openingPerson = z.object({ workerId: nativeId, userId: nativeId, companyId: nativeId, fullName: z.string().trim().min(1), registration: z.string().min(1) });
export type OpeningPerson = z.infer<typeof openingPerson>;
type Services = ReturnType<typeof checkedNativeServices>;
export type OpeningContext = { kind: 'existing'; permit: NativePermit } | { kind: 'create'; people: OpeningPerson[]; templates: NativeTemplate[]; services: Services };
export function appointmentCanOpen(item: NativeAppointment) {
  return item.status === 'CONFIRMED' && Boolean(item.locationId && item.teamId && item.participantIds.length && item.serviceCodes.length) && Date.parse(item.endsAt) > Date.now();
}
export function existingAppointmentPermit(value: unknown, appointment: NativeAppointment) {
  if (!Array.isArray(value)) throw new InvalidReadResponse();
  const records = value.map(item => checkedPermit(item));
  if (new Set(records.map(item => item.id)).size !== records.length) throw new InvalidReadResponse();
  const matching = records.filter(item => item.appointmentId === appointment.id);
  if (matching.length > 1 || matching.some(item => item.companyId !== appointment.companyId)) throw new InvalidReadResponse();
  return matching[0];
}
function checkedBrowserWorker(value: unknown, workerId: string, companyId: string) {
  const parsed = browserWorker.safeParse(value);
  if (!parsed.success || parsed.data.id !== workerId || parsed.data.companyId !== companyId) throw new InvalidReadResponse();
  return parsed.data;
}
export function checkedOpeningContext(value: unknown, appointment: NativeAppointment): OpeningContext {
  if (!value || typeof value !== 'object' || !('kind' in value)) throw new InvalidReadResponse();
  if (value.kind === 'existing' && 'permit' in value) {
    const permit = checkedPermit(value.permit);
    if (permit.appointmentId !== appointment.id || permit.companyId !== appointment.companyId) throw new InvalidReadResponse();
    return { kind: 'existing', permit };
  }
  if (value.kind !== 'create' || !('people' in value) || !('templates' in value) || !('services' in value)) throw new InvalidReadResponse();
  const people = z.array(openingPerson).safeParse(value.people), templates = checkedTemplates(value.templates, appointment.companyId), services = checkedNativeServices(value.services);
  if (!people.success || !same(people.data.map(person => person.workerId), appointment.participantIds) || new Set(people.data.map(person => person.userId)).size !== people.data.length
    || people.data.some(person => person.companyId !== appointment.companyId) || new Set(services.map(service => service.code)).size !== services.length
    || appointment.serviceCodes.some(code => !services.some(service => service.code === code))
    || templates.some(template => !same(template.servicoIds, services.filter(service => template.serviceCodes.includes(service.code)).map(service => service.id)))) throw new InvalidReadResponse();
  return { kind: 'create', people: people.data, templates, services };
}
export async function loadOpeningContext(appointment: NativeAppointment, signal: AbortSignal): Promise<OpeningContext> {
  // The API filters by appointment in the database; the local check below still rejects any other permit it returns.
  const existing = existingAppointmentPermit(await api.get<unknown>('/work-permits', { signal, query: { appointmentId: appointment.id } }), appointment);
  if (existing) return { kind: 'existing', permit: existing };
  if (!appointmentCanOpen(appointment)) throw new OpeningIssue('Confirme o agendamento e confira local, equipe, período, serviços e participantes antes de abrir a PT.');
  // All IDs must pass the scoped browser read before any native worker read is attempted.
  const workers = await Promise.all(appointment.participantIds.map(async id => checkedBrowserWorker(await api.get<unknown>(`/workers/${id}`, { signal }), id, appointment.companyId)));
  const [rawTemplates, rawServices] = await Promise.all([api.get<unknown>('/work-permits/pt-templates', { query: { companyId: appointment.companyId }, signal }), api.get<unknown>('/work-permits/services', { signal })]);
  const templates = checkedTemplates(rawTemplates, appointment.companyId), services = checkedNativeServices(rawServices);
  const people: OpeningPerson[] = [];
  for (let offset = 0; offset < workers.length; offset += 4) {
    people.push(...await Promise.all(workers.slice(offset, offset + 4).map(async worker => {
      const parsed = nativeWorker.safeParse(await readNativeWorker<unknown>(worker.id, { signal }));
      if (!parsed.success || parsed.data.id !== worker.id || parsed.data.companyId !== appointment.companyId || !parsed.data.active) throw new InvalidReadResponse();
      if (!parsed.data.userId) throw new OpeningIssue(`${worker.fullName} não possui usuário vinculado. Solicite a atualização do cadastro antes de abrir a PT.`);
      // Only this small mapping reaches the query cache; CPF, birth date and native DTO extras do not.
      return { workerId: worker.id, userId: parsed.data.userId, companyId: worker.companyId, fullName: worker.fullName, registration: worker.registration };
    })));
  }
  return checkedOpeningContext({ kind: 'create', people, templates, services }, appointment);
}
export function openingSelection(context: Extract<OpeningContext, { kind: 'create' }>, appointment: NativeAppointment, ids: string[]) {
  const selected = ids.map(id => context.templates.find(template => template.id === id));
  if (!ids.length || new Set(ids).size !== ids.length || selected.some(item => !item)) throw new NativeFormError('Escolha as versões dos modelos para abrir a PT.');
  const models = selected as NativeTemplate[];
  if (new Set(models.map(model => model.templateId)).size !== models.length || !same([...new Set(models.flatMap(model => model.serviceCodes))], appointment.serviceCodes)) throw new NativeFormError('Escolha uma versão por modelo, cobrindo exatamente os serviços do agendamento.');
  if (models.some(model => !model.closingQuestions.length)) throw new NativeFormError('Os modelos escolhidos precisam conter verificações de encerramento.');
  for (const questions of [models.flatMap(model => model.perguntas), models.flatMap(model => model.closingQuestions)]) {
    if (new Set(questions.map(question => question.id)).size !== questions.length) throw new NativeFormError('Os modelos escolhidos possuem perguntas duplicadas. Solicite a correção do cadastro.');
  }
  return { models, userIds: context.people.map(person => person.userId), serviceIds: context.services.filter(service => appointment.serviceCodes.includes(service.code)).map(service => service.id) };
}
export function assertSameAppointment(value: unknown, original: NativeAppointment) {
  const current = checkedNativeAppointment(value, original.id);
  if (!appointmentCanOpen(current) || current.version !== original.version || current.companyId !== original.companyId || current.locationId !== original.locationId
    || current.teamId !== original.teamId || current.title !== original.title || current.responsibleId !== original.responsibleId
    || Date.parse(current.startsAt) !== Date.parse(original.startsAt) || Date.parse(current.endsAt) !== Date.parse(original.endsAt)
    || !same(current.participantIds, original.participantIds) || !same(current.serviceCodes, original.serviceCodes)) throw new NativeContextConflict('O agendamento foi alterado. Seus dados foram mantidos. Feche a janela e atualize o agendamento antes de continuar.');
  return current;
}
const openingReceipt = z.object({ id: nativeId, numero: z.string(), statusOperacional: z.literal('em_verificacao'), statusRevisao: z.literal('nao_enviada'),
  versao: z.number().int().min(1), servicoIds: nativeIds, participanteIds: nativeIds, templateVersionIds: nativeIds, respostas: z.array(z.unknown()).length(0) });
export function checkedOpeningReceipt(value: unknown, selection: ReturnType<typeof openingSelection>) {
  const parsed = openingReceipt.safeParse(value);
  if (!parsed.success || parsed.data.numero.toLowerCase() !== parsed.data.id || !same(parsed.data.servicoIds, selection.serviceIds)
    || !same(parsed.data.participanteIds, selection.userIds) || !same(parsed.data.templateVersionIds, selection.models.map(model => model.id))) throw new InvalidReadResponse();
  return parsed.data;
}
export function checkedOpenedPermit(value: unknown, appointment: NativeAppointment, receipt: ReturnType<typeof checkedOpeningReceipt>, selection: ReturnType<typeof openingSelection>) {
  const permit = checkedPermit(value, receipt.id);
  if (permit.appointmentId !== appointment.id || permit.companyId !== appointment.companyId || permit.title !== appointment.title || permit.version !== receipt.versao
    || permit.status !== 'EM_VERIFICACAO' || permit.reviewStatus !== 'NAO_ENVIADA' || permit.checklistAnswers.length
    || !same(permit.serviceCode.split(','), appointment.serviceCodes) || !same(permit.templateVersionIds, selection.models.map(model => model.id))
    || !same(permit.participants.map(person => person.userId), selection.userIds)) throw new InvalidReadResponse();
  return permit;
}

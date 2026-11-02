import { beforeEach, expect, it, vi } from 'vitest';
import { api, ApiError, readNativeWorker } from '../../shared/api/client';
import { assertSameAppointment, checkedOpenedPermit, checkedOpeningContext, checkedOpeningReceipt, existingAppointmentPermit, loadOpeningContext, openingSelection } from './opening';
import { templateFixture, laterTemplateFixture, checklistIds as ids } from '../../../tests/connection-ui/fixtures/native-checklists';
import { openingAppointmentFixture, openingBrowserWorker, openingNativeWorker, openedPermitFixture, openingReceiptFixture } from '../../../tests/connection-ui/fixtures/native-opening';
import { nativeServicesFixture } from '../../../tests/connection-ui/fixtures/native-operations';

vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn() }, readNativeWorker: vi.fn() }));
const appointment = openingAppointmentFixture();
const context = () => checkedOpeningContext({ kind: 'create', people: [{ workerId: ids.worker, userId: ids.user, companyId: ids.company, fullName: 'Alice Trabalhadora', registration: 'MAT-01' }], templates: [templateFixture(), laterTemplateFixture()], services: nativeServicesFixture }, appointment);
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockImplementation(async path => {
    if (path === '/work-permits') return [] as never;
    if (path === `/workers/${ids.worker}`) return openingBrowserWorker as never;
    if (path === '/work-permits/pt-templates') return [templateFixture(), laterTemplateFixture()] as never;
    if (path === '/work-permits/services') return nativeServicesFixture as never;
    throw new Error('Rota inesperada: ' + path);
  });
  vi.mocked(readNativeWorker).mockResolvedValue(openingNativeWorker);
});
it('verifica o trabalhador na projeção autorizada antes de ler UserId e guarda somente o vínculo necessário', async () => {
  const result = await loadOpeningContext(appointment, new AbortController().signal);
  expect(result.kind).toBe('create'); if (result.kind !== 'create') throw new Error();
  expect(result.people[0]).toEqual({ workerId: ids.worker, userId: ids.user, companyId: ids.company, fullName: 'Alice Trabalhadora', registration: 'MAT-01' });
  expect(JSON.stringify(result)).not.toMatch(/cpfMasked|dateOfBirth|1990-01-01/);
  expect(vi.mocked(api.get).mock.invocationCallOrder[1]).toBeLessThan(vi.mocked(readNativeWorker).mock.invocationCallOrder[0]);
});
it('não chama a rota nativa se o browser negar o participante', async () => {
  vi.mocked(api.get).mockImplementation(async path => { if (path === '/work-permits') return [] as never; throw new ApiError(403, { code: 'FORBIDDEN', message: 'Privado', requestId: 'test' }); });
  await expect(loadOpeningContext(appointment, new AbortController().signal)).rejects.toMatchObject({ status: 403 }); expect(readNativeWorker).not.toHaveBeenCalled();
});
it('recusa empresa ou ID incompatível antes da leitura nativa', async () => {
  vi.mocked(api.get).mockResolvedValueOnce([] as never).mockResolvedValueOnce({ ...openingBrowserWorker, companyId: ids.otherCompany } as never);
  await expect(loadOpeningContext(appointment, new AbortController().signal)).rejects.toThrow(); expect(readNativeWorker).not.toHaveBeenCalled();
});
it('não tenta inferir usuário por nome, e recusa trabalhador sem vínculo', async () => {
  vi.mocked(readNativeWorker).mockResolvedValueOnce({ ...openingNativeWorker, userId: null });
  await expect(loadOpeningContext(appointment, new AbortController().signal)).rejects.toThrow('não possui usuário vinculado');
  expect(api.get).not.toHaveBeenCalledWith('/users', expect.anything());
});
it('rejeita vínculo nativo de outro trabalhador ou empresa', async () => {
  vi.mocked(readNativeWorker).mockResolvedValueOnce({ ...openingNativeWorker, id: ids.responsible }); await expect(loadOpeningContext(appointment, new AbortController().signal)).rejects.toThrow();
});
it('reutiliza PT existente sem carregar participantes ou modelos', async () => {
  vi.mocked(api.get).mockResolvedValueOnce([openedPermitFixture()] as never); const result = await loadOpeningContext(appointment, new AbortController().signal);
  expect(result.kind).toBe('existing'); expect(api.get).toHaveBeenCalledTimes(1); expect(readNativeWorker).not.toHaveBeenCalled();
  expect(() => existingAppointmentPermit([openedPermitFixture(), { ...openedPermitFixture(), id: ids.event }], appointment)).toThrow();
});
it('escolhe explicitamente a versão e envia TemplateId separado do ID do registro de versão', () => {
  const data = context(); if (data.kind !== 'create') throw new Error();
  const selected = openingSelection(data, appointment, [ids.templateVersion]); expect(selected.models[0]).toMatchObject({ id: ids.templateVersion, templateId: ids.template, versao: 2 }); expect(selected.userIds).toEqual([ids.user]); expect(selected.userIds).not.toEqual([ids.worker]);
  for (const idsToChoose of [[], [ids.templateVersion, ids.laterVersion], [ids.worker]]) expect(() => openingSelection(data, appointment, idsToChoose)).toThrow();
});
it('não deixa abrir com serviços diferentes ou modelo sem encerramento', () => {
  const data = context(); if (data.kind !== 'create') throw new Error();
  expect(() => openingSelection(data, { ...appointment, serviceCodes: ['QUENTE'] }, [ids.templateVersion])).toThrow('exatamente');
  expect(() => openingSelection({ ...data, templates: [{ ...templateFixture(), closingQuestions: [] }] }, appointment, [ids.templateVersion])).toThrow('encerramento');
});
it('verifica conjunto completo de trabalhadores e não aceita usuários repetidos', () => {
  const data = context(); if (data.kind !== 'create') throw new Error();
  expect(() => checkedOpeningContext({ ...data, people: [] }, appointment)).toThrow();
  expect(() => checkedOpeningContext({ ...data, people: [...data.people, { ...data.people[0], workerId: ids.responsible }] }, { ...appointment, participantIds: [ids.worker, ids.responsible] })).toThrow();
});
it.each([{ version: 3 }, { status: 'CANCELLED' }, { title: 'Outra tarefa' }, { participantIds: [] }, { serviceCodes: ['QUENTE'] }])('detecta mudança do agendamento antes de abrir: %j', patch => expect(() => assertSameAppointment({ ...appointment, ...patch }, appointment)).toThrow('agendamento foi alterado'));
it('confere o recibo português e o registro persistido antes de abrir a tela de detalhe', () => {
  const data = context(); if (data.kind !== 'create') throw new Error(); const selection = openingSelection(data, appointment, [ids.templateVersion]);
  const receipt = checkedOpeningReceipt(openingReceiptFixture(), selection); expect(checkedOpenedPermit(openedPermitFixture(), appointment, receipt, selection).id).toBe(ids.permit);
  for (const patch of [{ participanteIds: [ids.worker] }, { servicoIds: [] }, { statusOperacional: 'LIBERADA' }, { templateVersionIds: [ids.laterVersion] }]) expect(() => checkedOpeningReceipt({ ...openingReceiptFixture(), ...patch }, selection)).toThrow();
  expect(() => checkedOpenedPermit({ ...openedPermitFixture(), appointmentId: ids.event }, appointment, receipt, selection)).toThrow();
});

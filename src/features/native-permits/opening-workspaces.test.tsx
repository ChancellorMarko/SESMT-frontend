import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import { api, ApiError, readNativeWorker } from '../../shared/api/client';
import { NativeOpenPermit } from './NativeOpenPermit';
import { openingAppointmentFixture, openingBrowserWorker, openingNativeWorker, openedPermitFixture, openingReceiptFixture } from '../../../tests/connection-ui/fixtures/native-opening';
import { templateFixture, laterTemplateFixture, checklistIds as ids } from '../../../tests/connection-ui/fixtures/native-checklists';
import { nativeServicesFixture } from '../../../tests/connection-ui/fixtures/native-operations';

const state = vi.hoisted(() => ({ grants: ['pt:criar', 'workers.read'] }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ sessionKey: 'open-test', can: (permission: string) => state.grants.includes(permission) }) }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn(), post: vi.fn() }, readNativeWorker: vi.fn() }));
let appointment = openingAppointmentFixture(), existing = false, created = false, userId: string | null = ids.user, denyModels = false;
function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } }), done = vi.fn();
  render(<QueryClientProvider client={client}><MemoryRouter><NativeOpenPermit appointment={openingAppointmentFixture()} onClose={vi.fn()} onOpened={done}/></MemoryRouter></QueryClientProvider>);
  return done;
}
beforeEach(() => {
  vi.clearAllMocks(); state.grants = ['pt:criar', 'workers.read']; appointment = openingAppointmentFixture(); existing = false; created = false; userId = ids.user; denyModels = false;
  vi.mocked(api.get).mockImplementation(async path => {
    if (path === '/work-permits') return existing || created ? [openedPermitFixture()] as never : [] as never;
    if (path === `/workers/${ids.worker}`) return openingBrowserWorker as never;
    if (path === '/work-permits/pt-templates') { if (denyModels) throw new ApiError(403, { code: 'FORBIDDEN', message: 'Privado', requestId: 'test' }); return [templateFixture(), laterTemplateFixture()] as never; }
    if (path === '/work-permits/services') return nativeServicesFixture as never;
    if (path === `/appointments/${ids.appointment}`) return appointment as never;
    if (path === `/work-permits/${ids.permit}`) return openedPermitFixture() as never;
    throw new Error('Rota inesperada: ' + path);
  });
  vi.mocked(readNativeWorker).mockImplementation(async () => ({ ...openingNativeWorker, userId }) as never);
  vi.mocked(api.post).mockImplementation(async () => { created = true; return openingReceiptFixture() as never; });
});
async function choose() {
  const field = await screen.findByLabelText('Modelo: Manutenção em altura');
  expect(field).toHaveValue(''); fireEvent.change(field, { target: { value: ids.templateVersion } });
  fireEvent.click(screen.getByRole('checkbox', { name: /Confirmo os modelos/ }));
}
it('abre com o contrato português e os usuários vinculados, sem exigir consulta administrativa de usuários', async () => {
  const done = show(); await choose(); fireEvent.click(screen.getByRole('button', { name: 'Abrir PT em verificação' }));
  await waitFor(() => expect(done).toHaveBeenCalledWith(ids.permit));
  expect(api.post).toHaveBeenCalledWith(`/work-permits/appointments/${ids.appointment}/pt`, { templateVersoes: [{ templateId: ids.template, versao: 2 }], participanteIds: [ids.user], expectedAppointmentVersion: appointment.version }, expect.anything());
  expect(api.get).not.toHaveBeenCalledWith('/users', expect.anything()); expect(api.post).toHaveBeenCalledTimes(1);
});
it('não escolhe a versão mais recente nem envia antes da confirmação explícita', async () => {
  show(); const select = await screen.findByLabelText('Modelo: Manutenção em altura'); expect(select).toHaveValue('');
  fireEvent.click(screen.getByRole('button', { name: 'Abrir PT em verificação' })); expect(await screen.findByRole('alert')).toHaveTextContent('Confirme'); expect(api.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('checkbox', { name: /Confirmo os modelos/ })); fireEvent.click(screen.getByRole('button', { name: 'Abrir PT em verificação' })); expect(await screen.findByRole('alert')).toHaveTextContent('Escolha as versões'); expect(api.post).not.toHaveBeenCalled();
});
it('PT existente é aberta sem nova criação nem leitura nativa de trabalhadores', async () => {
  existing = true; const done = show(); fireEvent.click(await screen.findByRole('button', { name: 'Abrir PT existente' })); await waitFor(() => expect(done).toHaveBeenCalledWith(ids.permit)); expect(api.post).not.toHaveBeenCalled(); expect(readNativeWorker).not.toHaveBeenCalled();
});
it('não acessa catálogos nem usa o nome do perfil quando faltam grants explícitos', () => {
  state.grants = []; show(); expect(screen.getByRole('status')).toHaveTextContent('Sua conta precisa'); expect(api.get).not.toHaveBeenCalled(); expect(readNativeWorker).not.toHaveBeenCalled();
});
it('trabalhador sem conta e catálogo negado mantêm o envio indisponível', async () => {
  userId = null; show(); expect(await screen.findByRole('alert')).toHaveTextContent('não possui usuário vinculado'); expect(screen.getByRole('button', { name: 'Abrir PT em verificação' })).toBeDisabled(); expect(api.post).not.toHaveBeenCalled();
});
it('recusa no catálogo evita até mesmo a consulta nativa de UserId', async () => {
  denyModels = true; show(); expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível acessar'); expect(readNativeWorker).not.toHaveBeenCalled();
});
it('mudança da versão do agendamento preserva seleção e bloqueia o POST', async () => {
  show(); await choose(); appointment = { ...appointment, version: 3 }; fireEvent.click(screen.getByRole('button', { name: 'Abrir PT em verificação' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('agendamento foi alterado'); expect(screen.getByLabelText('Modelo: Manutenção em altura')).toHaveValue(ids.templateVersion); expect(screen.getByRole('button', { name: 'Abrir PT em verificação' })).toBeDisabled(); expect(api.post).not.toHaveBeenCalled();
});
it('relê vínculos antes do POST e não substitui silenciosamente o usuário escolhido', async () => {
  show(); await choose(); userId = ids.responsible; fireEvent.click(screen.getByRole('button', { name: 'Abrir PT em verificação' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('vínculos ou modelos foram alterados'); expect(api.post).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'Abrir PT em verificação' })).toBeDisabled();
});
it('detecta PT criada por outra pessoa enquanto o formulário estava aberto', async () => {
  show(); await choose(); existing = true; fireEvent.click(screen.getByRole('button', { name: 'Abrir PT em verificação' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('agendamento já possui uma PT'); expect(api.post).not.toHaveBeenCalled();
});
it('mudança das verificações fixadas no catálogo exige atualizar o contexto antes de repetir', async () => {
  let changed = false; const original = vi.mocked(api.get).getMockImplementation()!;
  vi.mocked(api.get).mockImplementation((path, options) => path === '/work-permits/pt-templates' && changed ? Promise.resolve([{ ...templateFixture(), closingQuestions: [] }]) as never : original(path, options));
  show(); await choose(); changed = true; fireEvent.click(screen.getByRole('button', { name: 'Abrir PT em verificação' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('modelos foram alterados'); expect(api.post).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'Abrir PT em verificação' })).toBeDisabled();
});
it('resposta incompatível não navega nem permite repetição automática', async () => {
  const done = show(); await choose(); vi.mocked(api.post).mockResolvedValueOnce({ ...openingReceiptFixture(), participanteIds: [ids.worker] } as never); fireEvent.click(screen.getByRole('button', { name: 'Abrir PT em verificação' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('A resposta não confirmou'); expect(done).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'Abrir PT em verificação' })).toBeDisabled(); expect(api.post).toHaveBeenCalledTimes(1);
});
it('resultado persistido mas sem confirmação de leitura bloqueia repetição', async () => {
  const original = vi.mocked(api.get).getMockImplementation()!; vi.mocked(api.get).mockImplementation((path, options) => path === `/work-permits/${ids.permit}` ? Promise.reject(new ApiError(503, { code: 'UNAVAILABLE', message: 'Privado', requestId: 'test' })) : original(path, options));
  const done = show(); await choose(); fireEvent.click(screen.getByRole('button', { name: 'Abrir PT em verificação' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível confirmar a conclusão'); expect(created).toBe(true); expect(done).not.toHaveBeenCalled(); expect(api.post).toHaveBeenCalledTimes(1); expect(screen.getByRole('button', { name: 'Abrir PT em verificação' })).toBeDisabled();
});

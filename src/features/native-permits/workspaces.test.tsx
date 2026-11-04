import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import { api, ApiError } from '../../shared/api/client';
import { NativePermitDetail, NativePermitPrintPage } from './NativePermitDetail';
import { NativePermitsPage } from './NativePermitsPage';
import { declarationFixture, historyFixture, permitFixture, permitIds as ids } from '../../../tests/connection-ui/fixtures/native-permits';

const state = vi.hoisted(() => ({ grants: ['pt:editar', 'pt:liberar', 'pt:iniciar'] }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ sessionKey: 'pt-test', unitId: ids.unit, me: { roles: ['ADMIN'], user: { id: ids.user, displayName: 'Pessoa da operação' } }, can: (permission: string) => state.grants.includes(permission) }) }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn(), post: vi.fn() } }));
let current = permitFixture(), ready = true;
function show(path = `/app/pts/${ids.permit}`) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const view = render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><Routes><Route path="/app/pts" element={<NativePermitsPage/>}/><Route path="/app/pts/:id" element={<NativePermitDetail/>}/><Route path="/app/pts/:id/imprimir" element={<NativePermitPrintPage/>}/></Routes></MemoryRouter></QueryClientProvider>);
  return { ...view, client };
}
beforeEach(() => {
  vi.clearAllMocks(); current = permitFixture(); ready = true; state.grants = ['pt:editar', 'pt:liberar', 'pt:iniciar'];
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-31T12:00:00Z'));
  vi.mocked(api.get).mockImplementation(async (path, options) => {
    if (path === '/work-permits/search') return { items: [structuredClone(current)], total: 1, page: options?.query?.page ?? 1, pageSize: 20 } as never;
    if (path === `/work-permits/${ids.permit}`) return structuredClone(current) as never;
    if (path.endsWith('/history')) return historyFixture() as never;
    if (path.endsWith('/declarations')) return declarationFixture(current) as never;
    if (path.endsWith('/eligibility')) return { ready, issues: ready ? [] : [{ code: 'CIENCIA_PENDENTE', participantUserId: ids.user, documentTypeId: null, serviceCode: null }] } as never;
    throw new Error('Endpoint inesperado: ' + path);
  });
});
async function openRelease() {
  const button = await screen.findByRole('button', { name: 'Liberar PT' });
  await waitFor(() => expect(button).toBeEnabled()); fireEvent.click(button);
  fireEvent.change(screen.getByLabelText('Condições da liberação'), { target: { value: 'Isolamento e proteção conferidos' } });
  fireEvent.click(screen.getByRole('checkbox', { name: /Confirmo as condições/ }));
}
it('consulta o endpoint nativo com filtro de local, não unitId ou o envelope legado', async () => {
  show(`/app/pts?locationId=${ids.unit}&q=altura`);
  expect(await screen.findByRole('link', { name: current.title })).toHaveAttribute('href', `/app/pts/${ids.permit}`);
  expect(api.get).toHaveBeenCalledWith('/work-permits/search', expect.objectContaining({ query: expect.objectContaining({ locationId: ids.unit, q: 'altura', page: 1, pageSize: 20 }) }));
  expect(screen.getByRole('checkbox', { name: 'Somente unidade selecionada' })).toBeChecked();
});
it('ADMIN sem permissões explícitas não recebe comandos operacionais', async () => {
  state.grants = []; show(); await screen.findByRole('heading', { name: current.title });
  expect(screen.queryByRole('button', { name: /Liberar PT|Cancelar PT|Iniciar serviço/ })).not.toBeInTheDocument();
});
it('mostra pendências reais e bloqueia a liberação enquanto há ciência pendente', async () => {
  ready = false; show(); await screen.findByText('Ciência pendente');
  expect(screen.getByRole('button', { name: 'Liberar PT' })).toBeDisabled();
  expect(screen.queryByText('Sem pendências nesta consulta')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Mais informações: Ciência pendente' }));
  expect(within(screen.getByRole('dialog', { name: 'Ciência pendente' })).getByText(ids.user, { exact: true })).toBeInTheDocument();
});
it('não depende da avaliação de liberação para oferecer suspensão de um serviço em execução', async () => {
  current = { ...current, status: 'EM_EXECUCAO', startedAt: '2026-10-31T11:00:00Z' };
  const original = vi.mocked(api.get).getMockImplementation()!;
  vi.mocked(api.get).mockImplementation((path, options) => path.endsWith('/eligibility') ? new Promise(() => {}) : original(path, options));
  show();
  expect(await screen.findByRole('button', { name: 'Suspender serviço' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Suspender serviço' }));
  expect(screen.getByRole('dialog', { name: 'Suspender serviço' })).toBeInTheDocument();
});
it('preserva a versão original e as condições preenchidas após nova leitura e conflito', async () => {
  const { client } = show(); await openRelease();
  current = { ...current, version: 5 };
  await act(async () => { await client.invalidateQueries({ queryKey: ['native-permit', 'pt-test', ids.permit] }); });
  vi.mocked(api.post).mockRejectedValueOnce(new ApiError(409, { code: 'DOMAIN_VIOLATION', message: 'privado', requestId: 'test' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar operação' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Seus dados foram mantidos');
  expect(screen.getByLabelText('Condições da liberação')).toHaveValue('Isolamento e proteção conferidos');
  expect(api.post).toHaveBeenCalledWith(`/work-permits/${ids.permit}/release`, expect.objectContaining({ expectedVersion: 4, confirmation: true }), expect.anything());
  expect(screen.getByRole('button', { name: 'Confirmar operação' })).toBeDisabled();
});
it('valida janela e confirmação explícita antes de enviar a liberação', async () => {
  show(); await openRelease();
  fireEvent.change(screen.getByLabelText('Autorizada até (Brasília)'), { target: { value: '2026-10-31T23:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar operação' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('dentro do agendamento'); expect(api.post).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Autorizada até (Brasília)'), { target: { value: '2026-10-31T17:00' } });
  fireEvent.click(screen.getByRole('checkbox', { name: /Confirmo as condições/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar operação' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Confirme a operação'); expect(api.post).not.toHaveBeenCalled();
});
it('libera com expectedVersion, janela UTC e só anuncia sucesso após resposta compatível', async () => {
  vi.mocked(api.post).mockImplementationOnce(async (_path, body) => {
    const payload = body as { authorizedFrom: string; authorizedUntil: string; conditions: string };
    current = { ...current, version: 5, status: 'LIBERADA', releasedAt: '2026-10-31T12:00:00Z', authorizedFrom: payload.authorizedFrom, authorizedUntil: payload.authorizedUntil, releaseConditions: payload.conditions };
    return structuredClone(current) as never;
  });
  show(); await openRelease(); fireEvent.click(screen.getByRole('button', { name: 'Confirmar operação' }));
  expect(await screen.findByText('Operação confirmada pela API.')).toBeInTheDocument();
  expect(api.post).toHaveBeenCalledWith(`/work-permits/${ids.permit}/release`, { expectedVersion: 4, conditions: 'Isolamento e proteção conferidos', authorizedFrom: '2026-10-31T10:00:00.000Z', authorizedUntil: '2026-10-31T20:00:00.000Z', confirmation: true }, expect.anything());
  await waitFor(() => expect(screen.getByRole('button', { name: 'Iniciar serviço' })).toBeEnabled());
});
it('não anuncia sucesso nem repete uma resposta incompatível', async () => {
  show(); await openRelease(); vi.mocked(api.post).mockResolvedValueOnce({ ...current, id: ids.team, version: 5 } as never);
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar operação' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('A resposta não confirmou');
  expect(screen.getByRole('button', { name: 'Confirmar operação' })).toBeDisabled(); expect(screen.queryByText('Operação confirmada pela API.')).not.toBeInTheDocument();
});
it('esconde os dados anteriormente exibidos se uma nova leitura for recusada', async () => {
  const { client } = show(); await screen.findByRole('heading', { name: current.title });
  vi.mocked(api.get).mockRejectedValue(new ApiError(403, { code: 'FORBIDDEN', message: 'privado', requestId: 'test' }));
  await act(async () => { await client.invalidateQueries({ queryKey: ['native-permit', 'pt-test', ids.permit] }); });
  expect(await screen.findByRole('alert')).toHaveTextContent('não autorizada');
  expect(screen.queryByRole('heading', { name: current.title })).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Cancelar PT' })).not.toBeInTheDocument();
});
it('não chama contratos de PDF/snapshots da demonstração na URL antiga de impressão', () => {
  show(`/app/pts/${ids.permit}/imprimir`);
  expect(screen.getByRole('status')).toHaveTextContent('ainda não está disponível'); expect(api.get).not.toHaveBeenCalled();
});

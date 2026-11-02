import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import { api, ApiError } from '../../shared/api/client';
import { NativeTeamFormPage } from './NativeTeamFormPage';
import { NativeTeamsPage } from '../native-operations/NativeTeamsPage';
import { editableTeamFixture, teamContext, teamIds as ids, teamPeople, teamScope, teamSummary } from '../../../tests/connection-ui/fixtures/native-teams';

const session = vi.hoisted(() => ({ grants: ['equipe:ler', 'equipe:criar', 'equipe:editar', 'workers.read'], ownOnly: false }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ sessionKey: 'teams-test', unitId: '62000000-0000-4000-8000-000000000001', me: { roles: ['ADMIN'], scope: { ...teamScope, ownOnly: session.ownOnly } }, can: (p: string) => session.grants.includes(p) }) }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
let current = editableTeamFixture(), context = { ...teamContext }, people = structuredClone(teamPeople);
function Destination() { const location = useLocation(); return <><h1>Lista de equipes</h1><output>{JSON.stringify(location.state)}</output></>; }
function show(edit = false, list = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[{ pathname: list ? '/list' : edit ? `/app/equipes/${ids.team}/editar` : '/app/equipes/novo', state: { nativeTeamReturnTo: { unitId: ids.unit, sessionKey: 'teams-test', page: 3 } } }]}><Routes>
    <Route path="/app/equipes/novo" element={<NativeTeamFormPage/>}/><Route path="/app/equipes/:id/editar" element={<NativeTeamFormPage/>}/><Route path="/app/equipes" element={<Destination/>}/><Route path="/list" element={<NativeTeamsPage/>}/></Routes></MemoryRouter></QueryClientProvider>); return client;
}
beforeEach(() => {
  vi.clearAllMocks(); session.grants = ['equipe:ler', 'equipe:criar', 'equipe:editar', 'workers.read']; session.ownOnly = false;
  current = editableTeamFixture(); context = { ...teamContext }; people = structuredClone(teamPeople);
  vi.mocked(api.get).mockImplementation(async path => {
    if (path === '/teams/management-context') return structuredClone(context) as never;
    if (path === '/teams') return [teamSummary(current)] as never;
    if (path === `/teams/${ids.team}`) return structuredClone(current) as never;
    if (path === '/workers') return { items: people.filter(p => p.status === 'ACTIVE'), page: 1, pageSize: 20, total: people.filter(p => p.status === 'ACTIVE').length } as never;
    const person = people.find(p => path === `/workers/${p.id}`); if (person) return structuredClone(person) as never;
    throw new Error('Rota inesperada: ' + path);
  });
  vi.mocked(api.post).mockImplementation(async (_path, body) => { current = { ...current, ...(body as typeof current) }; return structuredClone(current) as never; });
  vi.mocked(api.patch).mockImplementation(async (_path, body) => { current = { ...current, ...(body as typeof current), version: current.version + 1 }; return structuredClone(current) as never; });
});
async function fill() {
  await screen.findByRole('dialog'); fireEvent.change(screen.getByLabelText(/^Nome da equipe/), { target: { value: 'Equipe de inspeções' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Definir Alice Trabalhadora como chefe' }));
  fireEvent.click(screen.getByRole('button', { name: 'Adicionar Bruno Trabalhador à equipe' }));
}
it('cria com a organização do servidor, Worker IDs e confirmação persistida, retornando à página de origem', async () => {
  const client = show(); client.setQueryData(['native-teams', 'teams-test', ids.unit], { cached: true }); client.setQueryData(['native-teams', 'another-session'], { cached: true });
  await fill(); fireEvent.click(screen.getByRole('button', { name: 'Cadastrar' })); await screen.findByRole('heading', { name: 'Lista de equipes' });
  expect(api.post).toHaveBeenCalledWith('/teams', { name: 'Equipe de inspeções', description: null, chiefId: ids.worker, participantIds: [ids.secondWorker], organizationId: ids.organization, companyId: ids.company, localId: ids.unit }, expect.objectContaining({ idempotencyKey: undefined }));
  expect(screen.getByRole('status')).toHaveTextContent('"page":3'); expect(client.getQueryState(['native-teams', 'teams-test', ids.unit])?.isInvalidated).toBe(true);
  expect(client.getQueryState(['native-teams', 'another-session'])?.isInvalidated).toBe(false);
});
it('edita chefe e integrantes e limpa a descrição com a revisão carregada', async () => {
  show(true); await screen.findByRole('dialog'); fireEvent.change(screen.getByLabelText('Descrição'), { target: { value: '' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Definir Bruno Trabalhador como chefe' })); fireEvent.click(screen.getByRole('button', { name: 'Adicionar Alice Trabalhadora à equipe' }));
  fireEvent.click(screen.getByRole('button', { name: 'Salvar' })); await screen.findByRole('heading', { name: 'Lista de equipes' });
  expect(api.patch).toHaveBeenCalledWith(`/teams/${ids.team}`, { name: current.name, description: null, clearDescription: true, chiefId: ids.secondWorker, participantIds: [ids.worker], expectedVersion: 1 }, expect.objectContaining({ idempotencyKey: undefined }));
});
it('conflito detectado na releitura mantém o formulário e não envia PATCH', async () => {
  show(true); await screen.findByRole('dialog'); fireEvent.change(screen.getByLabelText(/^Nome da equipe/), { target: { value: 'Minha edição' } }); current.version = 2;
  fireEvent.click(screen.getByRole('button', { name: 'Salvar' })); expect(await screen.findByRole('alert')).toHaveTextContent('equipe foi alterada');
  expect(screen.getByLabelText(/^Nome da equipe/)).toHaveValue('Minha edição'); expect(api.patch).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled();
});
it.each([409, 403, 500])('erro HTTP %s preserva os dados sem repetir uma gravação', async status => {
  vi.mocked(api.post).mockRejectedValue(new ApiError(status, { code: 'CONFLICT', message: 'Recusado', requestId: 'test' })); show(); await fill();
  fireEvent.click(screen.getByRole('button', { name: 'Cadastrar' })); await screen.findByRole('alert'); expect(screen.getByLabelText(/^Nome da equipe/)).toHaveValue('Equipe de inspeções');
  expect(screen.getByRole('button', { name: 'Cadastrar' })).toBeDisabled(); expect(api.post).toHaveBeenCalledTimes(1);
});
it('nome duplicado permite correção sem tratar a equipe como salva', async () => {
  vi.mocked(api.post).mockRejectedValue(new ApiError(409, { code: 'DUPLICATE', message: 'Duplicado', requestId: 'test' })); show(); await fill();
  fireEvent.click(screen.getByRole('button', { name: 'Cadastrar' })); expect(await screen.findByRole('alert')).toHaveTextContent('outro nome'); expect(screen.getByRole('button', { name: 'Cadastrar' })).toBeEnabled();
});
it('alteração do contexto impede criar com organização obsoleta', async () => {
  show(); await fill(); context.organizationId = ids.company; fireEvent.click(screen.getByRole('button', { name: 'Cadastrar' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('contexto da unidade foi alterado'); expect(api.post).not.toHaveBeenCalled();
});
it('vínculo encerrado entre seleção e envio impede gravar', async () => {
  show(); await fill(); people[1].status = 'TERMINATED'; fireEvent.click(screen.getByRole('button', { name: 'Cadastrar' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('vínculo encerrado'); expect(api.post).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'Cadastrar' })).toBeEnabled();
});
it.each([{ companyId: ids.otherCompany }, { version: 9 }, { participantIds: [] }])('recibo incompatível não confirma sucesso %j', changes => {
  vi.mocked(api.post).mockResolvedValue({ ...editableTeamFixture(), name: 'Equipe de inspeções', description: null, participantIds: [ids.secondWorker], ...changes } as never);
  return (async () => { show(); await fill(); fireEvent.click(screen.getByRole('button', { name: 'Cadastrar' })); expect(await screen.findByRole('alert')).toHaveTextContent('resposta não confirmou'); expect(screen.getByRole('button', { name: 'Cadastrar' })).toBeDisabled(); })();
});
it('recusa uma API sem revisão para edição', async () => {
  current = { ...current, version: undefined as never }; show(true); expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível conferir a equipe'); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it.each(['equipe:ler', 'equipe:criar', 'workers.read'])('ADMIN não substitui o grant ausente %s', missing => {
  session.grants = session.grants.filter(grant => grant !== missing); show(); expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(api.get).not.toHaveBeenCalled();
});
it('escopo pessoal não habilita o cadastro de uma equipe', () => { session.ownOnly = true; show(); expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(api.get).not.toHaveBeenCalled(); });
it('lista de leitura mantém a tabela sem ações de escrita', async () => {
  session.grants = ['equipe:ler', 'workers.read']; show(false, true); await screen.findByRole('table'); expect(screen.queryByRole('link', { name: 'Nova equipe' })).not.toBeInTheDocument(); expect(screen.queryByRole('link', { name: /Editar equipe/ })).not.toBeInTheDocument();
});
it('Enter na busca consulta o catálogo sem submeter a equipe', async () => {
  show(); await fill(); const search = screen.getByLabelText('Buscar trabalhador'); fireEvent.change(search, { target: { value: 'Bruno' } }); fireEvent.keyDown(search, { key: 'Enter' });
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/workers', expect.objectContaining({ query: expect.objectContaining({ q: 'Bruno', page: 1, pageSize: 20 }) })));
  expect(api.post).not.toHaveBeenCalled(); expect(api.patch).not.toHaveBeenCalled();
});

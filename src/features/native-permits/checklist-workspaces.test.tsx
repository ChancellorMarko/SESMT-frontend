import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import { api, ApiError } from '../../shared/api/client';
import { NativePermitDetail } from './NativePermitDetail';
import { declarationFixture, historyFixture, permitFixture } from '../../../tests/connection-ui/fixtures/native-permits';
import { checklistIds as ids, templateFixture, laterTemplateFixture } from '../../../tests/connection-ui/fixtures/native-checklists';

const state = vi.hoisted(() => ({ grants: ['pt:editar', 'pt:concluir'] }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ sessionKey: 'checklist-test', can: (permission: string) => state.grants.includes(permission) }) }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn(), patch: vi.fn(), post: vi.fn() } }));
let current = permitFixture(), denied = false, models = [templateFixture(), laterTemplateFixture()];
function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/app/pts/${ids.permit}`]}><Routes><Route path="/app/pts/:id" element={<NativePermitDetail/>}/></Routes></MemoryRouter></QueryClientProvider>);
  return client;
}
beforeEach(() => {
  vi.clearAllMocks(); current = permitFixture(); denied = false; models = [templateFixture(), laterTemplateFixture()]; state.grants = ['pt:editar', 'pt:concluir'];
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-31T12:00:00Z'));
  vi.mocked(api.get).mockImplementation(async path => {
    if (path === `/work-permits/pts/${ids.permit}`) return { id: current.id, versao: current.version, statusOperacional: current.status.toLowerCase(), statusRevisao: current.reviewStatus.toLowerCase(), participanteIds: current.participants.map(p => p.userId), templateVersionIds: current.templateVersionIds } as never;
    if (path === '/work-permits/pt-templates') { if (denied) throw new ApiError(403, { code: 'FORBIDDEN', message: 'Privado', requestId: 'test' }); return structuredClone(models) as never; }
    if (path.endsWith('/history')) return historyFixture() as never;
    if (path.endsWith('/declarations')) return declarationFixture(current) as never;
    if (path.endsWith('/eligibility')) return { ready: false, issues: [{ code: 'CIENCIA_PENDENTE', participantUserId: ids.user, documentTypeId: null, serviceCode: null }] } as never;
    if (path === `/work-permits/${ids.permit}`) return structuredClone(current) as never;
    throw new Error('Rota inesperada: ' + path);
  });
});
async function load() { fireEvent.click(await screen.findByRole('button', { name: 'Carregar checklists' })); await screen.findByRole('button', { name: 'Abertura' }); }
async function fill() { await load(); fireEvent.click(screen.getByRole('button', { name: 'Preencher checklist' })); }

it('carrega somente sob demanda e usa perguntas da versão fixada, mesmo havendo nova versão', async () => {
  show(); await screen.findByRole('heading', { name: current.title });
  expect(api.get).not.toHaveBeenCalledWith('/work-permits/pt-templates', expect.anything());
  await fill(); expect(api.get).toHaveBeenCalledWith('/work-permits/pt-templates', expect.objectContaining({ query: { companyId: ids.company } }));
  expect(screen.getByLabelText('Isolamento realizado?')).toBeInTheDocument(); expect(screen.queryByText('Pergunta da versão posterior')).not.toBeInTheDocument();
  expect(screen.queryByRole('option', { name: /Não aplicável/ })).not.toBeInTheDocument();
});
it('envia PATCH com strings, decimal preciso e versões reais; salvar não libera a PT', async () => {
  vi.mocked(api.patch).mockImplementationOnce(async (_path, body) => { current = { ...current, version: 5, contentVersion: 4, checklistAnswers: (body as { answers: typeof current.checklistAnswers }).answers }; return current as never; });
  show(); await fill(); fireEvent.change(screen.getByLabelText('Isolamento realizado?'), { target: { value: 'false' } }); fireEvent.change(screen.getByLabelText('Medição registrada'), { target: { value: '9007199254740993' } });
  fireEvent.click(screen.getByRole('button', { name: 'Salvar respostas' })); await screen.findByText('Operação confirmada pela API.');
  expect(api.patch).toHaveBeenCalledWith(`/work-permits/${ids.permit}/checklist`, { expectedVersion: 4, answers: [{ perguntaId: ids.boolean, valor: 'false', justificativa: null }, { perguntaId: ids.number, valor: '9007199254740993', justificativa: null }] }, expect.anything());
  expect(current.status).toBe('EM_VERIFICACAO'); expect(api.post).not.toHaveBeenCalled();
});
it('salva abertura vazia como preenchimento parcial e não inventa respostas', async () => {
  vi.mocked(api.patch).mockImplementationOnce(async () => { current = { ...current, version: 5, contentVersion: 4 }; return current as never; });
  show(); await fill(); fireEvent.click(screen.getByRole('button', { name: 'Salvar respostas' })); await screen.findByText('Operação confirmada pela API.');
  expect(api.patch).toHaveBeenCalledWith(`/work-permits/${ids.permit}/checklist`, { expectedVersion: 4, answers: [] }, expect.anything());
});
it('mantém respostas e a versão original depois de atualização em segundo plano e conflito', async () => {
  const client = show(); await fill(); fireEvent.change(screen.getByLabelText('Condições observadas'), { target: { value: 'Preenchimento em andamento' } });
  current = { ...current, version: 5 }; await act(async () => { await client.invalidateQueries({ queryKey: ['native-permit', 'checklist-test', ids.permit] }); });
  vi.mocked(api.patch).mockRejectedValueOnce(new ApiError(409, { code: 'DOMAIN_VIOLATION', message: 'Privado', requestId: 'test' }));
  fireEvent.click(screen.getByRole('button', { name: 'Salvar respostas' })); expect(await screen.findByRole('alert')).toHaveTextContent('Seus dados foram mantidos');
  expect(screen.getByLabelText('Condições observadas')).toHaveValue('Preenchimento em andamento'); expect(screen.getByRole('button', { name: 'Salvar respostas' })).toBeDisabled();
  expect(api.patch).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ expectedVersion: 4 }), expect.anything());
});
it('recusa ao ler modelos não esconde os demais dados da PT nem usa perguntas estáticas', async () => {
  denied = true; show(); fireEvent.click(await screen.findByRole('button', { name: 'Carregar checklists' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('não autorizou a leitura dos modelos');
  expect(screen.getByRole('heading', { name: current.title })).toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Preencher checklist' })).not.toBeInTheDocument();
  expect(screen.queryByText('Isolamento realizado?')).not.toBeInTheDocument();
});
it('modelo fixado ausente impede edição, sem trocar pela última versão', async () => {
  models = [laterTemplateFixture()]; show(); fireEvent.click(await screen.findByRole('button', { name: 'Carregar checklists' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível conferir as versões fixadas'); expect(screen.queryByRole('button', { name: 'Preencher checklist' })).not.toBeInTheDocument();
});
it('aplica grants explícitos ao checklist e encerramento, sem herança por perfil', async () => {
  state.grants = []; show(); await load(); expect(screen.queryByRole('button', { name: /Preencher checklist|Encerrar serviço/ })).not.toBeInTheDocument();
});
it('encerramento requer verificações, resumo, término válido e confirmação antes de enviar', async () => {
  current = { ...current, status: 'EM_EXECUCAO', startedAt: '2026-10-31T11:00:00Z' }; show(); await load(); fireEvent.click(screen.getByRole('button', { name: 'Encerrar serviço' }));
  const dialog = within(screen.getByRole('dialog', { name: 'Encerrar serviço' }));
  fireEvent.click(dialog.getByRole('button', { name: 'Confirmar encerramento' })); expect(await screen.findByRole('alert')).toHaveTextContent('obrigatória'); expect(api.post).not.toHaveBeenCalled();
  fireEvent.change(dialog.getByLabelText('Área conferida após o serviço?'), { target: { value: 'false' } }); fireEvent.change(dialog.getByLabelText('Quantidade conferida'), { target: { value: '0' } }); fireEvent.change(dialog.getByLabelText('Condição final'), { target: { value: 'Área limpa' } });
  fireEvent.click(dialog.getByRole('button', { name: 'Confirmar encerramento' })); expect(await screen.findByRole('alert')).toHaveTextContent('impede o encerramento'); expect(api.post).not.toHaveBeenCalled();
  fireEvent.change(dialog.getByLabelText('Área conferida após o serviço?'), { target: { value: 'true' } }); fireEvent.change(dialog.getByLabelText('Resumo do encerramento'), { target: { value: 'Serviço encerrado' } }); fireEvent.change(dialog.getByLabelText('Término efetivo (Brasília)'), { target: { value: '2026-10-31T08:30' } }); fireEvent.click(dialog.getByRole('checkbox', { name: /Confirmo as verificações/ }));
  vi.mocked(api.post).mockImplementationOnce(async (_path, body) => { const payload = body as { actualEnd: string; summary: string; closingAnswers: typeof current.checklistAnswers }; current = { ...current, version: 5, status: 'CONCLUIDA', reviewStatus: 'AGUARDANDO_REVISAO', completedAt: '2026-10-31T12:00:00Z', actualEnd: payload.actualEnd, completionSummary: payload.summary, closingAnswers: payload.closingAnswers }; return current as never; });
  fireEvent.click(dialog.getByRole('button', { name: 'Confirmar encerramento' })); await screen.findByText('Operação confirmada pela API.');
  expect(api.post).toHaveBeenCalledWith(`/work-permits/${ids.permit}/complete`, expect.objectContaining({ expectedVersion: 4, actualEnd: '2026-10-31T11:30:00.000Z', summary: 'Serviço encerrado' }), expect.anything());
  expect(current.contentVersion).toBe(3); expect(await screen.findByText('Aguardando revisão')).toBeInTheDocument();
});
it('não oferece conclusão quando algum modelo fixado não possui verificações de encerramento', async () => {
  current = { ...current, status: 'EM_EXECUCAO', startedAt: '2026-10-31T11:00:00Z' }; models = [{ ...templateFixture(), closingQuestions: [] }]; show(); await load();
  expect(screen.getByRole('button', { name: 'Encerrar serviço' })).toBeDisabled(); fireEvent.click(screen.getByRole('button', { name: 'Encerramento' }));
  expect(screen.getByRole('status')).toHaveTextContent('Há modelo sem verificações de encerramento'); expect(api.post).not.toHaveBeenCalled();
});
it('registra término dentro do mesmo minuto do início, sem truncar segundos', async () => {
  current = { ...current, status: 'EM_EXECUCAO', startedAt: '2026-10-31T11:59:30Z' }; show(); await load(); fireEvent.click(screen.getByRole('button', { name: 'Encerrar serviço' }));
  const dialog = within(screen.getByRole('dialog', { name: 'Encerrar serviço' }));
  fireEvent.change(dialog.getByLabelText('Área conferida após o serviço?'), { target: { value: 'true' } }); fireEvent.change(dialog.getByLabelText('Quantidade conferida'), { target: { value: '0' } }); fireEvent.change(dialog.getByLabelText('Condição final'), { target: { value: 'Área limpa' } });
  fireEvent.change(dialog.getByLabelText('Resumo do encerramento'), { target: { value: 'Conferência encerrada' } }); fireEvent.change(dialog.getByLabelText('Término efetivo (Brasília)'), { target: { value: '2026-10-31T08:59:45' } }); fireEvent.click(dialog.getByRole('checkbox', { name: /Confirmo as verificações/ }));
  vi.mocked(api.post).mockImplementationOnce(async (_path, body) => { const payload = body as { actualEnd: string; summary: string; closingAnswers: typeof current.checklistAnswers }; current = { ...current, version: 5, status: 'CONCLUIDA', reviewStatus: 'AGUARDANDO_REVISAO', completedAt: '2026-10-31T12:00:00Z', actualEnd: payload.actualEnd, completionSummary: payload.summary, closingAnswers: payload.closingAnswers }; return current as never; });
  fireEvent.click(dialog.getByRole('button', { name: 'Confirmar encerramento' })); await screen.findByText('Operação confirmada pela API.');
  expect(api.post).toHaveBeenCalledWith(`/work-permits/${ids.permit}/complete`, expect.objectContaining({ actualEnd: '2026-10-31T11:59:45.000Z' }), expect.anything());
});
it('resposta com versão de conteúdo incorreta não confirma o salvamento nem permite repetição', async () => {
  show(); await fill(); vi.mocked(api.patch).mockResolvedValueOnce({ ...current, version: 5, contentVersion: 3 } as never);
  fireEvent.click(screen.getByRole('button', { name: 'Salvar respostas' })); expect(await screen.findByRole('alert')).toHaveTextContent('A resposta não confirmou'); expect(screen.getByRole('button', { name: 'Salvar respostas' })).toBeDisabled();
});

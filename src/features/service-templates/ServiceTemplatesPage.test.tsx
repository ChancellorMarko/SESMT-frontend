import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../../shared/api/client';
import type { ServiceCatalogDto, ServiceTemplateDto } from '../../shared/contracts/service-templates';
import { PT_SERVICE_TYPES } from '../../shared/lib/service-types';
import { ServiceTemplatesPage } from './ServiceTemplatesPage';

const state = vi.hoisted(() => ({ catalog: null as ServiceCatalogDto | null, write: true, read: true, unitId: 'unit' }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ sessionKey: 'session', unitId: state.unitId, can: (permission: string) => permission === 'requirements.write' ? state.write : permission === 'requirements.read' && state.read }) }));
vi.mock('../../shared/api/client', async original => {
  const actual = await original<typeof import('../../shared/api/client')>();
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } };
});

const serviceId = PT_SERVICE_TYPES[0].id;
function example(): ServiceCatalogDto {
  return { unitId: 'unit', templates: PT_SERVICE_TYPES.map(service => {
    const questions = [{ id: `${service.id}:context`, label: `Pergunta demonstrativa de ${service.name}`, required: true, blockingAnswers: ['NO' as const] }];
    const published = { serviceTypeId: service.id, serviceName: service.name, version: service.templateVersion, activityIds: service.activityIds || [], questions, publishedAt: '2026-10-12T12:00:00Z', publishedBy: 'manager', reason: 'Template inicial de demonstração.' };
    return { unitId: 'unit', service, revision: 4, published, draft: { questions, savedAt: '2026-10-12T12:00:00Z', savedBy: 'manager' }, versions: [published], availableActions: ['EDIT_DRAFT', 'PUBLISH'], history: [] };
  }) };
}
function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/app/configuracoes/servicos']}><ServiceTemplatesPage /></MemoryRouter></QueryClientProvider>);
  return client;
}
beforeEach(() => {
  state.catalog = example(); state.write = true; state.read = true; state.unitId = 'unit'; vi.clearAllMocks();
  vi.mocked(api.get).mockImplementation(async () => structuredClone(state.catalog) as never);
  vi.mocked(api.patch).mockImplementation(async (path, input) => {
    const index = state.catalog!.templates.findIndex(template => path.includes(template.service.id));
    const original = state.catalog!.templates[index];
    const saved = { ...original, revision: original.revision + 1, draft: { questions: (input as { questions: ServiceTemplateDto['published']['questions'] }).questions, savedAt: '2026-10-12T13:00:00Z', savedBy: 'manager' } };
    state.catalog!.templates[index] = saved; return structuredClone(saved) as never;
  });
  vi.mocked(api.post).mockImplementation(async (path, input) => {
    const index = state.catalog!.templates.findIndex(template => path.includes(template.service.id));
    const original = state.catalog!.templates[index];
    const published = { ...original.published, version: 'TEMPLATE-2', reason: (input as { reason: string }).reason, questions: original.draft!.questions };
    const saved = { ...original, revision: original.revision + 1, published, draft: null, versions: [...original.versions, published], availableActions: ['EDIT_DRAFT'] };
    state.catalog!.templates[index] = saved; return structuredClone(saved) as never;
  });
});

describe('catálogo de serviços e templates por unidade', () => {
  it('consulta os cinco serviços, publicação e versões sem oferecer edição a leitor', async () => {
    state.write = false; show();
    const navigation = await screen.findByRole('navigation', { name: 'Selecionar serviço' });
    expect(within(navigation).getAllByRole('button')).toHaveLength(5);
    await userEvent.click(screen.getByText('Consultar perguntas em uso'));
    expect(within(screen.getByRole('region', { name: 'Template publicado' })).getByText('Pergunta demonstrativa de Trabalho em altura')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Versões do template' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Salvar rascunho' })).not.toBeInTheDocument();
    await userEvent.click(within(navigation).getByRole('button', { name: /Trabalho a frio/ }));
    expect(screen.getByRole('region', { name: 'Template publicado' })).toHaveTextContent('Trabalho a frio');
  });
  it('salva rascunho com identificação preservada e ETag, sem publicar ou alterar a prévia em uso', async () => {
    const user = userEvent.setup(); show();
    const text = await screen.findByLabelText('Texto da pergunta 1 *');
    await user.clear(text); await user.type(text, 'Pergunta alterada somente no rascunho');
    expect(screen.getByRole('button', { name: 'Publicar rascunho salvo' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
    expect(await screen.findByText(/Rascunho salvo. O template publicado/)).toBeInTheDocument();
    expect(api.patch).toHaveBeenCalledWith(`/service-templates/${serviceId}/draft`, { questions: [{ id: `${serviceId}:context`, label: 'Pergunta alterada somente no rascunho', required: true, blockingAnswers: ['NO'] }] }, { etag: '"4"', query: { unitId: 'unit' } });
    expect(api.post).not.toHaveBeenCalled();
    await user.click(screen.getByText('Consultar perguntas em uso'));
    expect(within(screen.getByRole('region', { name: 'Template publicado' })).getByText('Pergunta demonstrativa de Trabalho em altura')).toBeInTheDocument();
  });
  it('permite adicionar/remover pergunta e configurar obrigatoriedade e resposta bloqueadora', async () => {
    const user = userEvent.setup(); show(); await screen.findByLabelText('Texto da pergunta 1 *');
    await user.click(screen.getByLabelText('Pergunta 1 obrigatória'));
    await user.selectOptions(screen.getByLabelText('Resposta bloqueadora da pergunta 1'), 'YES');
    await user.click(screen.getByRole('button', { name: 'Adicionar pergunta' }));
    await user.type(screen.getByLabelText('Texto da pergunta 2 *'), 'Pergunta adicionada');
    await user.click(screen.getByRole('button', { name: 'Remover pergunta 2' }));
    await user.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
    expect(await screen.findByText(/Rascunho salvo. O template publicado/)).toBeInTheDocument();
    expect(api.patch).toHaveBeenCalledWith(expect.anything(), { questions: [expect.objectContaining({ required: false, blockingAnswers: ['YES'] })] }, expect.anything());
  });
  it('publicação exige motivo e confirmação explícita e preserva versões anteriores na consulta', async () => {
    const user = userEvent.setup(); show();
    await user.click(await screen.findByRole('button', { name: 'Publicar rascunho salvo' }));
    const dialog = screen.getByRole('dialog', { name: 'Publicar template do serviço' });
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar publicação' }));
    expect(api.post).not.toHaveBeenCalled();
    expect(within(dialog).getByText(/pelo menos 10 caracteres/)).toBeInTheDocument();
    expect(within(dialog).getByText('Confirme a publicação deste rascunho.')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Motivo da publicação *'), 'Revisão fictícia do template deste serviço.');
    await user.click(within(dialog).getByRole('checkbox'));
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar publicação' }));
    expect(await screen.findByText(/Template publicado. Novas PTs/)).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith(`/service-templates/${serviceId}/publish`, { reason: 'Revisão fictícia do template deste serviço.' }, { etag: '"4"', query: { unitId: 'unit' } });
    expect(screen.getByRole('region', { name: 'Versões do template' })).toHaveTextContent(PT_SERVICE_TYPES[0].templateVersion);
    expect(screen.getByRole('region', { name: 'Versões do template' })).toHaveTextContent('TEMPLATE-2');
  });
  it('preserva texto ao refazer consulta, e bloqueia gravação até conferência explícita da revisão atual', async () => {
    const user = userEvent.setup(); const client = show();
    const text = await screen.findByLabelText('Texto da pergunta 1 *');
    fireEvent.change(text, { target: { value: 'Meu preenchimento preservado' } });
    state.catalog!.templates[0] = { ...state.catalog!.templates[0], revision: 7, draft: { ...state.catalog!.templates[0].draft!, questions: [{ ...state.catalog!.templates[0].draft!.questions[0], label: 'Conteúdo concorrente' }] } };
    await act(async () => { await client.refetchQueries({ queryKey: ['service-templates'] }); });
    expect(text).toHaveValue('Meu preenchimento preservado');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar rascunho' })).toBeDisabled());
    await user.click(screen.getByRole('button', { name: 'Conferir template atual' }));
    expect(await screen.findByRole('region', { name: 'Conferência do template atual' })).toHaveTextContent('revisão 7');
    await user.click(screen.getByRole('button', { name: 'Usar revisão atual e manter meu preenchimento' }));
    expect(text).toHaveValue('Meu preenchimento preservado');
    await user.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
    expect(await screen.findByText(/Rascunho salvo. O template publicado/)).toBeInTheDocument();
    expect(api.patch).toHaveBeenCalledWith(expect.anything(), expect.anything(), { etag: '"7"', query: { unitId: 'unit' } });
  });
  it('mantém preenchimento após falha de consulta ou erro de campo na gravação', async () => {
    const user = userEvent.setup(); const client = show();
    const text = await screen.findByLabelText('Texto da pergunta 1 *');
    fireEvent.change(text, { target: { value: 'Pergunta mantida após falha' } });
    vi.mocked(api.get).mockRejectedValue(new Error('Consulta interrompida.'));
    await act(async () => { await client.refetchQueries({ queryKey: ['service-templates'] }); });
    expect(text).toHaveValue('Pergunta mantida após falha');
    vi.mocked(api.patch).mockRejectedValueOnce(new ApiError(422, { code: 'VALIDATION_FAILED', message: 'Pergunta rejeitada.', fieldErrors: [{ field: 'questions.0.label', code: 'INVALID', message: 'Texto rejeitado no teste.' }], requestId: 'test' }));
    await user.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
    expect(await screen.findByText('Texto rejeitado no teste.')).toBeInTheDocument();
    expect(text).toHaveValue('Pergunta mantida após falha'); expect(text).toHaveFocus();
  });
  it('protege troca de serviço/unidade e bloqueia navegação enquanto a gravação está pendente', async () => {
    const user = userEvent.setup(); show();
    const text = await screen.findByLabelText('Texto da pergunta 1 *');
    fireEvent.change(text, { target: { value: 'Edição local protegida' } });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await user.click(screen.getByRole('button', { name: /Trabalho a quente/ }));
    expect(text).toHaveValue('Edição local protegida'); expect(confirm).toHaveBeenCalledOnce();
    let changed = true; act(() => { changed = window.dispatchEvent(new Event('sesmt:before-context-change', { cancelable: true })); });
    expect(changed).toBe(false); expect(confirm).toHaveBeenCalledTimes(2);
    let resolveSave!: (value: ServiceTemplateDto) => void;
    vi.mocked(api.patch).mockImplementationOnce(() => new Promise(resolve => { resolveSave = resolve; }));
    await user.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
    expect(screen.getByRole('button', { name: /Trabalho a quente/ })).toBeDisabled();
    act(() => { changed = window.dispatchEvent(new Event('sesmt:before-context-change', { cancelable: true })); });
    expect(changed).toBe(false); expect(confirm).toHaveBeenCalledTimes(2);
    await act(async () => { resolveSave({ ...state.catalog!.templates[0], revision: 5 }); });
  });
  it('bloqueia confirmação de publicação que mudou e preserva motivo para nova conferência', async () => {
    const user = userEvent.setup(); const client = show();
    await user.click(await screen.findByRole('button', { name: 'Publicar rascunho salvo' }));
    const dialog = screen.getByRole('dialog', { name: 'Publicar template do serviço' });
    await user.type(within(dialog).getByLabelText('Motivo da publicação *'), 'Motivo mantido para conferir novamente.');
    await user.click(within(dialog).getByRole('checkbox'));
    await act(async () => { client.setQueryData(['service-templates', 'session', 'unit'], { ...state.catalog, templates: state.catalog!.templates.map((template, index) => index ? template : { ...template, revision: 7 }) }); });
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Confirmar publicação' })).toBeDisabled());
    expect(within(dialog).getByLabelText('Motivo da publicação *')).toHaveValue('Motivo mantido para conferir novamente.');
    expect(api.post).not.toHaveBeenCalled();
  });
  it('não consulta sem permissão e rejeita catálogo de unidade diferente', async () => {
    state.write = false; state.read = false; const client = show();
    expect(screen.getByRole('heading', { name: 'Acesso restrito' })).toBeInTheDocument(); expect(api.get).not.toHaveBeenCalled();
    client.clear();
  });
  it('não apresenta detalhes quando a API entrega catálogo de outra unidade', async () => {
    state.catalog!.unitId = 'another-unit'; show();
    expect(await screen.findByRole('heading', { name: 'Catálogo de outra unidade' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Texto da pergunta 1 *')).not.toBeInTheDocument();
  });
});

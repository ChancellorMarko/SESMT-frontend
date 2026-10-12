import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequirementMatrixDto } from '../../shared/contracts/requirements';
import { api, ApiError } from '../../shared/api/client';
import { RequirementMatrixPage } from './RequirementMatrixPage';

const state = vi.hoisted(() => ({ matrix: null as RequirementMatrixDto | null, write: true, read: true, unitId: 'unit' }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ sessionKey: 'session', unitId: state.unitId, can: (permission: string) => permission === 'requirements.write' ? state.write : permission === 'requirements.read' && state.read }) }));
vi.mock('../../shared/api/client', async original => {
  const actual = await original<typeof import('../../shared/api/client')>();
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } };
});

function example(): RequirementMatrixDto {
  const rule = { id: 'rule-1', label: 'Capacitação demonstrativa', description: 'Documento administrativo de exemplo para este serviço.', serviceTypeId: 'service', serviceFunction: '*', locationContains: '', restricted: false, validFromRequired: true, validUntilRequired: true };
  return { unitId: 'unit', revision: 4, services: [{ id: 'service', name: 'Manutenção de exemplo', description: 'Serviço de teste', templateVersion: 'template', requirementVersion: 'matrix' }],
    published: { version: 'MATRIZ-1', publishedAt: '2026-10-10T12:00:00Z', publishedBy: 'manager', reason: 'Publicação de demonstração inicial.', rules: [rule] },
    draft: { rules: [rule], savedAt: '2026-10-10T13:00:00Z', savedBy: 'manager' }, versions: [], availableActions: ['EDIT_DRAFT', 'PUBLISH'], history: [],
  };
}
function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/app/configuracoes/requisitos']}><Routes><Route path="/app/configuracoes/requisitos" element={<RequirementMatrixPage />} /><Route path="/app/agenda" element={<h1>Agenda de teste</h1>} /></Routes></MemoryRouter></QueryClientProvider>);
  return client;
}
beforeEach(() => {
  state.matrix = example(); state.write = true; state.read = true; state.unitId = 'unit'; vi.clearAllMocks();
  vi.mocked(api.get).mockImplementation(async () => structuredClone(state.matrix) as never);
  vi.mocked(api.patch).mockImplementation(async (_path, input) => {
    state.matrix = { ...state.matrix!, revision: state.matrix!.revision + 1, draft: { rules: (input as { rules: typeof state.matrix.published.rules }).rules.map((rule, index) => ({ ...rule, id: rule.id || `new-${index}` })), savedAt: '2026-10-10T14:00:00Z', savedBy: 'manager' } };
    return structuredClone(state.matrix) as never;
  });
  vi.mocked(api.post).mockImplementation(async (_path, input) => {
    state.matrix = { ...state.matrix!, revision: state.matrix!.revision + 1, published: { ...state.matrix!.published, version: 'MATRIZ-2', rules: state.matrix!.draft!.rules, reason: (input as { reason: string }).reason }, draft: null, availableActions: ['EDIT_DRAFT'] };
    return structuredClone(state.matrix) as never;
  });
});

describe('matriz de requisitos por unidade', () => {
  it('mantém o rascunho local quando uma atualização da matriz falha', async () => {
    const client = show();
    fireEvent.change(await screen.findByLabelText('Título da regra 1 *'), { target: { value: 'Rascunho preservado' } });
    vi.mocked(api.get).mockRejectedValue(new Error('Conexão interrompida.'));
    await act(async () => { await client.refetchQueries({ queryKey: ['requirement-matrix'] }); });
    expect(screen.getByLabelText('Título da regra 1 *')).toHaveValue('Rascunho preservado');
    expect(screen.getByRole('button', { name: 'Salvar rascunho' })).toBeInTheDocument();
  });

  it('consulta publicada e versões sem edição ou descrição clínica de regra restrita', async () => {
    state.write = false;
    state.matrix!.published.rules[0] = { ...state.matrix!.published.rules[0], restricted: true, description: 'Descrição clínica que não deve aparecer.', validFromRequired: false, validUntilRequired: false };
    show();
    await userEvent.click(await screen.findByText('Consultar requisitos em uso'));
    expect(within(screen.getByRole('region', { name: 'Matriz publicada' })).getByText(/Somente a situação administrativa/)).toBeInTheDocument();
    expect(screen.queryByText('Descrição clínica que não deve aparecer.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Salvar rascunho' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Versões da matriz' })).toBeInTheDocument();
  });
  it('salva rascunho com revisão sem publicar e mantém alterações no erro de campo', async () => {
    const user = userEvent.setup(); show();
    const title = await screen.findByLabelText('Título da regra 1 *');
    await user.clear(title); await user.type(title, 'Exigência editada');
    expect(screen.getByRole('button', { name: 'Publicar rascunho salvo' })).toBeDisabled();
    vi.mocked(api.patch).mockRejectedValueOnce(new ApiError(422, { code: 'VALIDATION_FAILED', message: 'Confira o requisito.', fieldErrors: [{ field: 'rules.0.label', code: 'INVALID', message: 'Título rejeitado no teste.' }], requestId: 'test' }));
    await user.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
    expect(await screen.findByText('Título rejeitado no teste.')).toBeInTheDocument();
    expect(title).toHaveValue('Exigência editada');
    expect(title).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
    expect(await screen.findByText(/Rascunho salvo. A matriz publicada continua/)).toBeInTheDocument();
    expect(api.patch).toHaveBeenLastCalledWith('/requirement-matrix/draft', { rules: [expect.objectContaining({ id: 'rule-1', label: 'Exigência editada' })] }, { etag: '"4"', query: { unitId: 'unit' } });
    expect(api.post).not.toHaveBeenCalled();
  });
  it('remove exigências de datas ao marcar regra restrita e permite adicionar/remover regras', async () => {
    const user = userEvent.setup(); show();
    await user.click(await screen.findByLabelText('Conferência restrita da regra 1'));
    expect(screen.queryByLabelText('Exigir início da vigência na regra 1')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Exigir fim da vigência na regra 1')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Adicionar regra' }));
    expect(screen.getByLabelText('Função da regra 2 *')).toHaveValue('*');
    await user.click(screen.getByRole('button', { name: 'Remover regra 2' }));
    await user.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
    expect(await screen.findByText(/Rascunho salvo. A matriz publicada continua/)).toBeInTheDocument();
    expect(api.patch).toHaveBeenCalledWith('/requirement-matrix/draft', { rules: [expect.objectContaining({ restricted: true, validFromRequired: false, validUntilRequired: false })] }, expect.anything());
  });
  it('publica somente rascunho salvo com motivo válido e confirmação explícita', async () => {
    const user = userEvent.setup(); show();
    await user.click(await screen.findByRole('button', { name: 'Publicar rascunho salvo' }));
    const dialog = screen.getByRole('dialog', { name: 'Publicar matriz de requisitos' });
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar publicação' }));
    expect(api.post).not.toHaveBeenCalled();
    expect(within(dialog).getByText(/pelo menos 10 caracteres/)).toBeInTheDocument();
    expect(within(dialog).getByText('Confirme a publicação deste rascunho.')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Motivo da publicação *'), 'Critérios administrativos revisados para o teste.');
    await user.click(within(dialog).getByRole('checkbox'));
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar publicação' }));
    expect(await screen.findByText(/Matriz publicada. A prontidão/)).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/requirement-matrix/publish', { reason: 'Critérios administrativos revisados para o teste.' }, { etag: '"4"', query: { unitId: 'unit' } });
  });
  it('bloqueia publicação se a revisão mudar enquanto a confirmação está aberta e preserva motivo', async () => {
    const user = userEvent.setup(); const client = show();
    await user.click(await screen.findByRole('button', { name: 'Publicar rascunho salvo' }));
    const dialog = screen.getByRole('dialog', { name: 'Publicar matriz de requisitos' });
    await user.type(within(dialog).getByLabelText('Motivo da publicação *'), 'Meu motivo permanece no formulário.');
    await user.click(within(dialog).getByRole('checkbox'));
    await act(async () => { client.setQueryData(['requirement-matrix', 'session', 'unit'], { ...state.matrix, revision: 5 }); });
    expect(await within(dialog).findByText(/A matriz mudou enquanto esta janela/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Confirmar publicação' })).toBeDisabled();
    expect(within(dialog).getByLabelText('Motivo da publicação *')).toHaveValue('Meu motivo permanece no formulário.');
    expect(within(dialog).getByText(/A matriz mudou enquanto esta janela/)).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });
  it('preserva preenchimento em conflito e só muda ETag após conferência explícita', async () => {
    const user = userEvent.setup(); show();
    const title = await screen.findByLabelText('Título da regra 1 *');
    await user.clear(title); await user.type(title, 'Meu requisito preservado');
    vi.mocked(api.patch).mockRejectedValueOnce(new ApiError(412, { code: 'REVISION_CONFLICT', message: 'Conflito de teste.', requestId: 'test' }));
    await user.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
    expect(await screen.findByRole('button', { name: 'Conferir matriz atual' })).toBeEnabled();
    expect(title).toHaveValue('Meu requisito preservado');
    expect(screen.getByRole('button', { name: 'Salvar rascunho' })).toBeDisabled();
    state.matrix = { ...state.matrix!, revision: 7, draft: { ...state.matrix!.draft!, rules: [{ ...state.matrix!.draft!.rules[0], label: 'Conteúdo concorrente' }] } };
    await user.click(screen.getByRole('button', { name: 'Conferir matriz atual' }));
    expect(await screen.findByRole('region', { name: 'Conferência da matriz atual' })).toHaveTextContent('revisão 7');
    expect(api.patch).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Usar revisão atual e manter meu preenchimento' }));
    expect(title).toHaveValue('Meu requisito preservado');
    await user.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
    expect(await screen.findByText(/Rascunho salvo. A matriz publicada continua/)).toBeInTheDocument();
    expect(api.patch).toHaveBeenLastCalledWith('/requirement-matrix/draft', expect.anything(), { etag: '"7"', query: { unitId: 'unit' } });
  });
  it('protege mudança de unidade na rota fixa e bloqueia saída enquanto salva', async () => {
    const user = userEvent.setup(); show();
    const title = await screen.findByLabelText('Título da regra 1 *');
    await user.type(title, ' editado');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    let changed = true;
    act(() => { changed = window.dispatchEvent(new Event('sesmt:before-context-change', { cancelable: true })); });
    expect(changed).toBe(false);
    expect(confirm).toHaveBeenCalledOnce();
    let resolveSave!: (value: RequirementMatrixDto) => void;
    vi.mocked(api.patch).mockImplementationOnce(() => new Promise(resolve => { resolveSave = resolve; }));
    await user.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
    act(() => { changed = window.dispatchEvent(new Event('sesmt:before-context-change', { cancelable: true })); });
    expect(changed).toBe(false);
    expect(confirm).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Salvando…' })).toBeDisabled();
    expect(screen.getByText(/Aguarde a confirmação da ação em andamento/)).toBeInTheDocument();
    await act(async () => { resolveSave({ ...state.matrix!, revision: 5 }); });
  });
  it('não consulta conteúdo sem permissão', () => {
    state.write = false; state.read = false; show();
    expect(screen.getByRole('heading', { name: 'Acesso restrito' })).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });
  it('não apresenta dados de uma resposta pertencente a outra unidade', async () => {
    state.matrix!.unitId = 'other-unit'; show();
    expect(await screen.findByRole('heading', { name: 'Matriz de outra unidade' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Título da regra 1 *')).not.toBeInTheDocument();
    expect(screen.queryByText('Capacitação demonstrativa')).not.toBeInTheDocument();
  });
  it('mantém o motivo após conflito, conferência e reabertura sem manter a confirmação anterior', async () => {
    const user = userEvent.setup(); show();
    await user.click(await screen.findByRole('button', { name: 'Publicar rascunho salvo' }));
    const dialog = screen.getByRole('dialog', { name: 'Publicar matriz de requisitos' });
    await user.type(within(dialog).getByLabelText('Motivo da publicação *'), 'Motivo preservado para a nova conferência.');
    await user.click(within(dialog).getByRole('checkbox'));
    vi.mocked(api.post).mockRejectedValueOnce(new ApiError(412, { code: 'REVISION_CONFLICT', message: 'Conflito de publicação.', requestId: 'test' }));
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar publicação' }));
    expect(await within(dialog).findByText(/Seu preenchimento foi preservado/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    state.matrix = { ...state.matrix!, revision: 7 };
    await user.click(screen.getByRole('button', { name: 'Conferir matriz atual' }));
    await screen.findByRole('region', { name: 'Conferência da matriz atual' });
    await user.click(screen.getByRole('button', { name: 'Carregar matriz atual e descartar preenchimento' }));
    await user.click(screen.getByRole('button', { name: 'Publicar rascunho salvo' }));
    const reopened = screen.getByRole('dialog', { name: 'Publicar matriz de requisitos' });
    expect(within(reopened).getByLabelText('Motivo da publicação *')).toHaveValue('Motivo preservado para a nova conferência.');
    expect(within(reopened).getByRole('checkbox')).not.toBeChecked();
    await user.click(within(reopened).getByRole('button', { name: 'Confirmar publicação' }));
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(within(reopened).getByText('Confirme a publicação deste rascunho.')).toBeInTheDocument();
  });
});

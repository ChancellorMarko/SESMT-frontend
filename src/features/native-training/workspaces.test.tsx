import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import { api, ApiError } from '../../shared/api/client';
import { NativeTrainingPage } from './NativeTrainingPage';
import type { Training, TrainingContext } from './contracts';

const ids = { company: '75000000-0000-4000-8000-000000000001', unit: '75000000-0000-4000-8000-000000000002', worker: '75000000-0000-4000-8000-000000000003', record: '75000000-0000-4000-8000-000000000004' };
const state = vi.hoisted(() => ({ ownOnly: false, granted: true }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ sessionKey: 'training-test', unitId: '75000000-0000-4000-8000-000000000002', me: { workerId: '75000000-0000-4000-8000-000000000003', scope: { companyIds: ['75000000-0000-4000-8000-000000000001'], ownOnly: state.ownOnly } }, can: () => state.granted }) }));
vi.mock('../../shared/api/client', async importOriginal => ({ ...await importOriginal<typeof import('../../shared/api/client')>(), api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));
const initial: Training = { id: ids.record, companyId: ids.company, unitId: ids.unit, workerId: ids.worker, workerName: 'Hugo Almeida', title: 'Integração de segurança', reference: null,
  kind: 'INITIAL', completedOn: '2026-01-05', renewalOn: null, durationMinutes: 90, provider: null, instructor: null, venue: null, content: null, notes: null, revokedAt: null, revocationReason: null, revision: 1 };
let context: TrainingContext, records: Training[];
function show(search = '') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/app/treinamentos${search}`]}><NativeTrainingPage/></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => {
  vi.clearAllMocks(); state.ownOnly = false; state.granted = true; records = [];
  context = { unitId: ids.unit, companyId: ids.company, ownOnly: false, canCreate: true, canEdit: true, workers: [{ id: ids.worker, name: 'Hugo Almeida', enrollment: 'MAT-01' }] };
  vi.mocked(api.get).mockImplementation(async (path, options) => {
    if (path === '/trainings/context') return structuredClone(context) as never;
    if (path === `/trainings/${ids.record}/evidence`) return { trainingId: ids.record, unitId: ids.unit, trainingRevision: records[0]?.revision ?? 1, canManage: !state.ownOnly, state: 'EMPTY', evidence: null } as never;
    if (path === `/trainings/${ids.record}/history`) return [{ id: ids.record, action: 'TRAINING_CREATED', revision: 1, actorName: 'Carla Mendes', occurredAt: '2026-01-05T12:00:00Z', reason: null }] as never;
    if (path === `/trainings/${ids.record}`) return structuredClone(records[0]) as never;
    const q = String(options?.query?.q ?? ''); const items = records.filter(r => `${r.title} ${r.workerName}`.toLowerCase().includes(q.toLowerCase()));
    return { items: structuredClone(items), total: items.length, page: 1, pageSize: 20 } as never;
  });
  vi.mocked(api.post).mockImplementation(async (path, body) => {
    const payload = body as Record<string, unknown>;
    if (path.endsWith('/revoke')) records = [{ ...records[0], revision: 2, revokedAt: '2026-11-03T12:00:00Z', revocationReason: String(payload.reason) }];
    else records = [{ ...initial, ...Object.fromEntries(Object.keys(initial).filter(key => key in payload).map(key => [key, payload[key]])) }];
    return structuredClone(records[0]) as never;
  });
  vi.mocked(api.put).mockImplementation(async (_path, body) => { const payload = body as Record<string, unknown>; records = [{ ...records[0], title: String(payload.title), revision: 2 }]; return structuredClone(records[0]) as never; });
});
async function fill() {
  fireEvent.click(await screen.findByRole('button', { name: 'Registrar treinamento' }));
  const form = screen.getByRole('dialog', { name: 'Registrar treinamento' });
  fireEvent.change(within(form).getByLabelText('Trabalhador'), { target: { value: ids.worker } });
  fireEvent.change(within(form).getByLabelText('Nome do curso'), { target: { value: initial.title } });
  fireEvent.change(within(form).getByLabelText('Carga horária (horas)'), { target: { value: '1' } });
  fireEvent.change(within(form).getByLabelText('Minutos adicionais'), { target: { value: '30' } });
  fireEvent.click(within(form).getByRole('checkbox', { name: 'Conferi os dados deste treinamento.' })); return form;
}
it('registra, relê o banco e abre os detalhes com duração em minutos', async () => {
  show(); const form = await fill(); fireEvent.click(within(form).getByRole('button', { name: 'Registrar treinamento' }));
  const detail = await screen.findByRole('dialog', { name: 'Detalhes do treinamento' });
  expect(await within(detail).findByText('1 h 30 min')).toBeInTheDocument();
  expect(api.post).toHaveBeenCalledWith('/trainings', expect.objectContaining({ workerId: ids.worker, durationMinutes: 90, confirmation: true }), expect.anything());
});
it('alterar o preenchimento exige uma nova confirmação', async () => {
  show(); const form = await fill(); fireEvent.change(within(form).getByLabelText('Referência ou NR'), { target: { value: 'Procedimento atualizado' } });
  expect(within(form).getByRole('button', { name: 'Registrar treinamento' })).toBeDisabled();
});
it('mantém o formulário e bloqueia repetição após resultado ambíguo', async () => {
  show(); const form = await fill(); vi.mocked(api.post).mockRejectedValue(new TypeError('network failure'));
  fireEvent.click(within(form).getByRole('button', { name: 'Registrar treinamento' }));
  expect(await within(form).findByRole('alert')).toHaveTextContent('Não foi possível confirmar');
  expect(within(form).getByLabelText('Nome do curso')).toHaveValue(initial.title); expect(within(form).getByRole('button', { name: 'Registrar treinamento' })).toBeDisabled();
});
it('não confirma sucesso com recibo de outra empresa', async () => {
  show(); const form = await fill(); vi.mocked(api.post).mockResolvedValue({ ...initial, companyId: ids.worker });
  fireEvent.click(within(form).getByRole('button', { name: 'Registrar treinamento' }));
  expect(await within(form).findByRole('alert')).toHaveTextContent('resposta não confirmou'); expect(screen.queryByText('Registro salvo.')).not.toBeInTheDocument();
});
it('revalida os trabalhadores elegíveis antes de gravar', async () => {
  show(); const form = await fill(); context.workers = [];
  fireEvent.click(within(form).getByRole('button', { name: 'Registrar treinamento' }));
  expect(await within(form).findByRole('alert')).toHaveTextContent('vínculo mudou'); expect(api.post).not.toHaveBeenCalled();
});
it('acesso próprio lê o registro sem cadastro, edição ou invalidação', async () => {
  state.ownOnly = true; context = { ...context, ownOnly: true, canCreate: false, canEdit: false, workers: [] }; records = [initial]; show(`?registro=${ids.record}`);
  const detail = await screen.findByRole('dialog', { name: 'Detalhes do treinamento' }); expect(await within(detail).findByText('Hugo Almeida')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Registrar treinamento' })).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Editar registro' })).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Invalidar registro' })).not.toBeInTheDocument();
});
it('invalida com revisão e motivo sem perder o registro', async () => {
  records = [initial]; show(`?registro=${ids.record}`); fireEvent.click(await screen.findByRole('button', { name: 'Invalidar registro' }));
  const form = screen.getByRole('dialog', { name: 'Invalidar treinamento' });
  fireEvent.change(within(form).getByLabelText('Motivo da invalidação'), { target: { value: 'Cadastro duplicado' } }); fireEvent.click(within(form).getByRole('checkbox'));
  fireEvent.click(within(form).getByRole('button', { name: 'Confirmar invalidação' }));
  const detail = await screen.findByRole('dialog', { name: 'Detalhes do treinamento' }); expect(await within(detail).findByText('Cadastro duplicado')).toBeInTheDocument();
  expect(api.post).toHaveBeenCalledWith(`/trainings/${ids.record}/revoke`, expect.objectContaining({ expectedRevision: 1, reason: 'Cadastro duplicado' }), expect.anything());
});
it('conflito de edição preserva motivo e não troca a revisão para forçar uma gravação', async () => {
  records = [initial]; show(`?registro=${ids.record}`); fireEvent.click(await screen.findByRole('button', { name: 'Editar registro' }));
  const form = screen.getByRole('dialog', { name: 'Editar treinamento' });
  fireEvent.change(within(form).getByLabelText('Motivo da alteração'), { target: { value: 'Correção da descrição' } }); fireEvent.click(within(form).getByRole('checkbox'));
  vi.mocked(api.put).mockRejectedValue(new ApiError(409, { code: 'TRAINING_CHANGED', message: 'Privado', requestId: 'qa' }));
  fireEvent.click(within(form).getByRole('button', { name: 'Salvar alterações' })); expect(await within(form).findByRole('alert')).toHaveTextContent('Seus dados foram mantidos');
  expect(within(form).getByLabelText('Motivo da alteração')).toHaveValue('Correção da descrição'); expect(within(form).getByRole('button', { name: 'Salvar alterações' })).toBeDisabled();
  expect(api.put).toHaveBeenCalledWith(`/trainings/${ids.record}`, expect.objectContaining({ expectedRevision: 1 }), expect.anything());
});
it('sem concessão não consulta a API e identificadores inválidos não geram rotas arbitrárias', async () => {
  state.granted = false; show('?registro=../../users'); expect(api.get).not.toHaveBeenCalled();
  expect(await screen.findByText('Treinamento não encontrado ou fora do seu acesso.')).toBeInTheDocument();
});
it('filtros ambíguos não consultam a listagem', async () => {
  show('?q=curso&q=outro'); expect(await screen.findByText(/Os filtros do endereço são inválidos/)).toBeInTheDocument();
  expect(vi.mocked(api.get).mock.calls.some(([path]) => path === '/trainings')).toBe(false);
});
it('um endereço de outra unidade não exibe nem consulta os dados da unidade atual', async () => {
  show(`?unitId=${ids.worker}&registro=${ids.record}`);
  expect(await screen.findByText('O endereço se refere a outra unidade. Escolha o contexto antes de consultar.')).toBeInTheDocument();
  expect(api.get).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../../shared/api/client';
import type { DocumentaryReadinessDto } from '../../shared/contracts/requirements';
import { DocumentaryReadinessPage } from './DocumentaryReadinessPage';

const state = vi.hoisted(() => ({ permissions: ['eligibility.read', 'eligibility.write', 'requirements.read', 'appointments.read'], unitId: 'unit-a' as string | undefined, sessionKey: 'session' }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ sessionKey: state.sessionKey, unitId: state.unitId, can: (permission: string) => state.permissions.includes(permission) }) }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn() } }));
const data: DocumentaryReadinessDto = { generatedAt: '2026-10-10T09:00:00-03:00', rows: [{ appointmentId: 'appointment', appointmentCode: 'AG-TESTE', teamId: 'team', teamName: 'Equipe teste', serviceTypeId: 'service', serviceLabel: 'Manutenção demonstrativa', location: 'Área de teste', startsAt: '2026-10-11T09:00:00-03:00', endsAt: '2026-10-11T10:00:00-03:00', eligibility: { appointmentId: 'appointment', requirementVersion: 'DEMO-1', eligible: false, checkedAt: '2026-10-10T09:00:00-03:00', participants: [
  { workerId: 'worker-a', name: 'Bruno Teste', serviceFunction: 'Executante', eligible: false, items: [{ requirementId: 'requirement', label: 'Orientação', description: 'Demonstrativa', status: 'PENDING', restricted: false }, { requirementId: 'restricted', label: 'Conferência restrita', description: 'Administrativa', status: 'MISSING', restricted: true, fileName: 'clinico.pdf', validUntil: '2030-01-01', reason: 'Não revelar detalhe clínico.' }] },
  { workerId: 'worker-b', name: 'Camila Teste', serviceFunction: 'Apoio', eligible: true, items: [{ requirementId: 'requirement', label: 'Orientação', description: 'Demonstrativa', status: 'APPROVED', restricted: false }] },
] } }] };
function Location() { const location = useLocation(); return <output aria-label="Endereço atual">{location.pathname}{location.search}</output>; }
function show(route = '/app/pendencias', client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const tree = () => <QueryClientProvider client={client}><MemoryRouter initialEntries={[route]}><DocumentaryReadinessPage /><Location /></MemoryRouter></QueryClientProvider>;
  const view = render(tree());
  return { client, ...view, update: () => view.rerender(tree()) };
}
beforeEach(() => { vi.clearAllMocks(); state.unitId = 'unit-a'; state.sessionKey = 'session'; state.permissions = ['eligibility.read', 'eligibility.write', 'requirements.read', 'appointments.read']; vi.mocked(api.get).mockResolvedValue(data); });
describe('painel de pendências documentais', () => {
  it('oferece regularização na ficha para integração e preserva a conferência própria da matriz', async () => {
    state.permissions.push('workers.read');
    const updated = structuredClone(data);
    updated.rows[0].eligibility.participants[0].items.push({ source: 'WORKER_INTEGRATION', requirementId: 'integration:worker-a', label: 'Integração administrativa', description: 'Registro administrativo.', status: 'MISSING', restricted: false });
    vi.mocked(api.get).mockResolvedValue(updated); show();
    expect(await screen.findByRole('link', { name: 'Consultar integração de Bruno Teste' })).toHaveAttribute('href', '/app/trabalhadores/worker-a#integracao');
    expect(screen.getByRole('link', { name: 'Abrir conferência de AG-TESTE' })).toHaveAttribute('href', '/app/agenda/appointment');
  });
  it('não oferece ficha de integração sem acesso a pessoas ou para requisito restrito', async () => {
    const updated = structuredClone(data);
    updated.rows[0].eligibility.participants[0].items.push({ source: 'WORKER_INTEGRATION', requirementId: 'integration:worker-a', label: 'Integração administrativa', description: 'Registro administrativo.', status: 'MISSING', restricted: false });
    vi.mocked(api.get).mockResolvedValue(updated); show();
    await screen.findByText('Integração administrativa');
    expect(screen.queryByRole('link', { name: /Consultar integração/ })).not.toBeInTheDocument();
  });
  it('oferece os serviços separadamente e encontra o atendimento pelo serviço secundário', async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockResolvedValue({ ...data, rows: data.rows.map(row => ({ ...row, serviceTypeIds: ['service', 'confined'], services: [{ id: 'service', name: 'Manutenção demonstrativa' }, { id: 'confined', name: 'Espaço confinado' }], serviceLabel: 'Manutenção demonstrativa + Espaço confinado' })) });
    show(); await screen.findByRole('heading', { name: 'Bruno Teste' });
    const filter = screen.getByRole('combobox', { name: 'Serviço' });
    expect(within(filter).getByRole('option', { name: 'Espaço confinado' })).toHaveValue('confined');
    await user.selectOptions(filter, 'confined');
    expect(screen.getByRole('heading', { name: 'Bruno Teste' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Manutenção demonstrativa + Espaço confinado' })).toBeVisible();
  });
  it('encontra o serviço descrito sem depender da lista opcional de IDs', async () => {
    const user = userEvent.setup();
    const response = structuredClone(data);
    response.rows[0].services = [{ id: 'service', name: 'Manutenção demonstrativa' }, { id: 'secondary', name: 'Serviço secundário' }];
    vi.mocked(api.get).mockResolvedValue(response); show();
    await screen.findByRole('heading', { name: 'Bruno Teste' });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Serviço' }), 'secondary');
    expect(screen.getByRole('heading', { name: 'Bruno Teste' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Exportar consulta CSV' })).toBeEnabled();
  });
  it('oferece o serviço principal quando os catálogos opcionais estão vazios', async () => {
    const response = structuredClone(data);
    response.rows[0].services = []; response.rows[0].serviceTypeIds = [];
    vi.mocked(api.get).mockResolvedValue(response); show('/app/pendencias?unitId=unit-a&serviceTypeId=service');
    await screen.findByRole('heading', { name: 'Bruno Teste' });
    const filter = screen.getByRole('combobox', { name: 'Serviço' });
    expect(filter).toHaveValue('service');
    expect(within(filter).getByRole('option', { name: 'Manutenção demonstrativa' })).toHaveValue('service');
  });
  it('mantém um serviço válido sem inventar a descrição que a consulta não forneceu', async () => {
    const response = structuredClone(data); response.rows[0].serviceTypeIds = ['service', 'unnamed'];
    vi.mocked(api.get).mockResolvedValue(response); show('/app/pendencias?unitId=unit-a&serviceTypeId=unnamed');
    await screen.findByRole('heading', { name: 'Bruno Teste' });
    const filter = screen.getByRole('combobox', { name: 'Serviço' });
    expect(filter).toHaveValue('unnamed');
    expect(within(filter).getByRole('option', { name: 'Serviço sem descrição nesta consulta' })).toHaveValue('unnamed');
    expect(screen.getByRole('button', { name: 'Remover filtro: Serviço' })).toHaveTextContent('Serviço sem descrição nesta consulta');
    expect(screen.queryByText('Serviço indisponível nesta consulta')).not.toBeInTheDocument();
  });
  it('consulta escopo, permite filtrar pessoas e vincula a conferência correta', async () => {
    const user = userEvent.setup(); show();
    expect(await screen.findByRole('heading', { name: 'Bruno Teste' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Camila Teste' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Abrir conferência de AG-TESTE' })).toHaveAttribute('href', '/app/agenda/appointment');
    expect(api.get).toHaveBeenCalledWith('/documentary-readiness', expect.objectContaining({ query: { unitId: 'unit-a' }, signal: expect.any(AbortSignal) }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Situação documental' }), 'ready');
    expect(screen.getByRole('heading', { name: 'Camila Teste' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Bruno Teste' })).not.toBeInTheDocument();
    await user.type(screen.getByRole('searchbox'), 'Inexistente');
    expect(screen.getByRole('button', { name: 'Exportar consulta CSV' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(screen.getByRole('heading', { name: 'Bruno Teste' })).toBeVisible();
  });
  it('não apresenta arquivos, datas ou razões clínicas dos itens restritos', async () => {
    show(); await screen.findByRole('heading', { name: 'Bruno Teste' });
    expect(screen.getByText('Conferência restrita por profissional autorizado.')).toBeVisible();
    expect(screen.queryByText('clinico.pdf')).not.toBeInTheDocument();
    expect(screen.queryByText(/detalhe clínico/)).not.toBeInTheDocument();
    expect(screen.queryByText(/2030/)).not.toBeInTheDocument();
  });
  it('oculta resultados antigos quando a atualização falha e permite nova tentativa', async () => {
    const user = userEvent.setup(); show(); await screen.findByRole('heading', { name: 'Bruno Teste' });
    vi.mocked(api.get).mockRejectedValue(new Error('Falha na consulta da API.'));
    await user.click(screen.getByRole('button', { name: 'Atualizar pendências' }));
    const alert = await screen.findByRole('alert'); expect(alert).toHaveTextContent('Falha na consulta da API.');
    expect(screen.queryByRole('heading', { name: 'Bruno Teste' })).not.toBeInTheDocument();
    vi.mocked(api.get).mockResolvedValue(data);
    await user.click(within(alert).getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByRole('heading', { name: 'Bruno Teste' })).toBeVisible();
  });
  it('não consulta sem permissão ou unidade', async () => {
    state.permissions = []; show();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Acesso restrito' })).toBeVisible());
    expect(api.get).not.toHaveBeenCalled();
  });
  it('não consulta sem unidade mesmo com permissão de leitura', () => {
    state.unitId = undefined; show();
    expect(screen.getByRole('heading', { name: 'Selecione uma unidade' })).toBeVisible();
    expect(api.get).not.toHaveBeenCalled();
  });
  it.each(['status=unknown', 'status=', 'q=Bruno&q=Camila', 'unitId=unit-a&unitId=unit-b', 'serviceTypeId=', 'extra=value'])('bloqueia a consulta e exportação até corrigir os critérios: %s', async criteria => {
    const user = userEvent.setup(); show(`/app/pendencias?${criteria}`);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Atualizar pendências' })).toBeDisabled());
    expect(api.get).not.toHaveBeenCalled(); expect(screen.queryByRole('button', { name: 'Exportar consulta CSV' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(await screen.findByRole('heading', { name: 'Bruno Teste' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Camila Teste' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('/app/pendencias?unitId=unit-a');
  });
  it('corrige a unidade do endereço e descarta os filtros de catálogo da unidade anterior', async () => {
    show('/app/pendencias?unitId=unit-b&teamId=outside&serviceTypeId=outside&status=all&q=Teste');
    expect(await screen.findByRole('heading', { name: 'Bruno Teste' })).toBeVisible();
    expect(api.get).toHaveBeenCalledTimes(1);
    const url = screen.getByLabelText('Endereço atual').textContent!;
    expect(url).toContain('unitId=unit-a'); expect(url).toContain('status=all'); expect(url).toContain('q=Teste');
    expect(url).not.toContain('teamId'); expect(url).not.toContain('serviceTypeId');
  });
  it('preserva alterações consecutivas de filtros no mesmo ciclo', async () => {
    show(); await screen.findByRole('heading', { name: 'Bruno Teste' });
    act(() => {
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Camila' } });
      fireEvent.change(screen.getByRole('combobox', { name: 'Situação documental' }), { target: { value: 'ready' } });
    });
    expect(await screen.findByRole('heading', { name: 'Camila Teste' })).toBeVisible();
    expect(screen.getByRole('searchbox')).toHaveValue('Camila');
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('q=Camila&status=ready');
  });
  it('mantém um filtro indisponível visível sem convertê-lo em todas as equipes', async () => {
    show('/app/pendencias?teamId=unavailable');
    await screen.findByRole('heading', { name: 'Nenhum atendimento nesta consulta' });
    expect(screen.getByRole('combobox', { name: 'Equipe' })).toHaveValue('unavailable');
    expect(screen.getByRole('option', { name: 'Equipe indisponível nesta consulta' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Exportar consulta CSV' })).toBeDisabled();
  });
  it.each(['unit', 'appointment', 'items'] as const)('não apresenta nem exporta um retorno inválido: %s', async mismatch => {
    const invalid = structuredClone(data);
    if (mismatch === 'unit') invalid.rows[0].eligibility.unitId = 'unit-b';
    if (mismatch === 'appointment') invalid.rows[0].eligibility.appointmentId = 'another';
    if (mismatch === 'items') Object.assign(invalid.rows[0].eligibility.participants[0], { items: null });
    vi.mocked(api.get).mockResolvedValue(invalid); show();
    expect(await screen.findByRole('alert')).toHaveTextContent('dados inválidos para esta unidade');
    expect(screen.queryByRole('heading', { name: 'Bruno Teste' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Exportar consulta CSV' })).not.toBeInTheDocument();
  });
  it('recusa também dados inválidos já presentes no cache sem repetir a atualização de estado', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(['documentary-readiness', 'session', 'unit-a'], { generatedAt: data.generatedAt, rows: null });
    show('/app/pendencias?unitId=unit-a', client);
    expect(await screen.findByRole('alert')).toHaveTextContent('dados inválidos para esta unidade');
    expect(api.get).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Exportar consulta CSV' })).not.toBeInTheDocument();
  });
  it('oculta nomes e texto restrito do erro de acesso até receber resposta válida, inclusive ao reabrir', async () => {
    const view = show(); await screen.findByRole('heading', { name: 'Bruno Teste' });
    vi.mocked(api.get).mockRejectedValue(new ApiError(403, { code: 'FORBIDDEN', message: 'Bruno Teste: informação restrita', requestId: '' }));
    await act(async () => { await view.client.refetchQueries({ queryKey: ['documentary-readiness'] }); });
    expect(await screen.findByRole('alert')).toHaveTextContent('Seu acesso não permite consultar');
    expect(screen.queryByText(/informação restrita/)).not.toBeInTheDocument();
    view.unmount();
    let resolve!: (value: DocumentaryReadinessDto) => void;
    vi.mocked(api.get).mockImplementation(() => new Promise(done => { resolve = done; }));
    show('/app/pendencias?unitId=unit-a', view.client);
    expect(screen.queryByRole('heading', { name: 'Bruno Teste' })).not.toBeInTheDocument();
    await act(async () => { resolve(data); });
    expect(await screen.findByRole('heading', { name: 'Bruno Teste' })).toBeVisible();
  });
  it('aborta a consulta anterior ao trocar de unidade e ignora uma resposta tardia', async () => {
    let signal!: AbortSignal; let resolve!: (value: DocumentaryReadinessDto) => void;
    vi.mocked(api.get).mockImplementation((_path, options) => {
      if (options?.query?.unitId === 'unit-a') { signal = options.signal!; return new Promise(done => { resolve = done; }); }
      return Promise.resolve({ generatedAt: data.generatedAt, rows: [] });
    });
    const view = show(); await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));
    state.unitId = 'unit-b'; view.update();
    expect(await screen.findByRole('heading', { name: 'Nenhum atendimento nesta consulta' })).toBeVisible();
    expect(signal.aborted).toBe(true);
    await act(async () => { resolve(data); });
    expect(screen.queryByRole('heading', { name: 'Bruno Teste' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Exportar consulta CSV' })).toBeDisabled();
  });
});

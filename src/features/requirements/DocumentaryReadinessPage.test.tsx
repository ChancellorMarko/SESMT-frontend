import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../shared/api/client';
import type { DocumentaryReadinessDto } from '../../shared/contracts/requirements';
import { DocumentaryReadinessPage } from './DocumentaryReadinessPage';

const state = vi.hoisted(() => ({ permissions: ['eligibility.read', 'eligibility.write', 'requirements.read', 'appointments.read'], unitId: 'unit-a' as string | undefined }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ sessionKey: 'session', unitId: state.unitId, can: (permission: string) => state.permissions.includes(permission) }) }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn() } }));
const data: DocumentaryReadinessDto = { generatedAt: '2026-10-10T09:00:00-03:00', rows: [{ appointmentId: 'appointment', appointmentCode: 'AG-TESTE', teamId: 'team', teamName: 'Equipe teste', serviceTypeId: 'service', serviceLabel: 'Manutenção demonstrativa', location: 'Área de teste', startsAt: '2026-10-11T09:00:00-03:00', endsAt: '2026-10-11T10:00:00-03:00', eligibility: { appointmentId: 'appointment', requirementVersion: 'DEMO-1', eligible: false, checkedAt: '2026-10-10T09:00:00-03:00', participants: [
  { workerId: 'worker-a', name: 'Bruno Teste', serviceFunction: 'Executante', eligible: false, items: [{ requirementId: 'requirement', label: 'Orientação', description: 'Demonstrativa', status: 'PENDING', restricted: false }, { requirementId: 'restricted', label: 'Conferência restrita', description: 'Administrativa', status: 'MISSING', restricted: true, fileName: 'clinico.pdf', validUntil: '2030-01-01', reason: 'Não revelar detalhe clínico.' }] },
  { workerId: 'worker-b', name: 'Camila Teste', serviceFunction: 'Apoio', eligible: true, items: [{ requirementId: 'requirement', label: 'Orientação', description: 'Demonstrativa', status: 'APPROVED', restricted: false }] },
] } }] };
function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter><DocumentaryReadinessPage /></MemoryRouter></QueryClientProvider>);
  return client;
}
beforeEach(() => { vi.clearAllMocks(); state.unitId = 'unit-a'; state.permissions = ['eligibility.read', 'eligibility.write', 'requirements.read', 'appointments.read']; vi.mocked(api.get).mockResolvedValue(data); });
describe('painel de pendências documentais', () => {
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
});

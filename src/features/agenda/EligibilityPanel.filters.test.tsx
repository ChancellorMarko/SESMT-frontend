import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AppointmentDto, EligibilityDto } from '../../shared/contracts/work-permits';
import { api } from '../../shared/api/client';
import { EligibilityPanel } from './EligibilityPanel';

vi.mock('../../shared/api/client', () => ({ api: { get: vi.fn(), post: vi.fn() }, revisionEtag: (revision: number) => `"${revision}"` }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ sessionKey: 'session-a', unitId: 'unit-a', can: () => true }) }));

const appointment: AppointmentDto = { id: 'appointment-a', unitId: 'unit-a', code: 'AG-001', teamId: 'team-a', teamName: 'Equipe A', serviceTypeId: 'service-a', serviceLabel: 'Inspeção ilustrativa', location: 'Galpão A', startsAt: '2026-10-09T17:00:00Z', endsAt: '2026-10-09T19:00:00Z', responsibleId: 'operator-a', responsibleName: 'Operador A', participants: [], status: 'CONFIRMED', revision: 4, availableActions: [], history: [] };
let eligibility: EligibilityDto;

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = (appointmentId: string) => <QueryClientProvider client={client}><MemoryRouter><EligibilityPanel appointmentId={appointmentId} /></MemoryRouter></QueryClientProvider>;
  const result = render(view('appointment-a'));
  return { ...result, changeAppointment: (appointmentId: string) => result.rerender(view(appointmentId)) };
}

beforeEach(() => {
  vi.clearAllMocks();
  eligibility = {
    appointmentId: 'appointment-a', unitId: 'unit-a', checkedAt: '2026-10-09T15:00:00Z', requirementVersion: 'MATRIZ-DEMO-1', eligible: false,
    participants: [
      { workerId: 'ana', name: 'Ana Júlia', serviceFunction: 'Técnico de Segurança', eligible: false, items: [{ requirementId: 'training-ana', label: 'Capacitação aplicável', description: 'Evidência conferida para o serviço.', status: 'APPROVED', restricted: false }] },
      { workerId: 'joao', name: 'João Silva', serviceFunction: 'Operador de Máquinas', eligible: true, items: [{ requirementId: 'training-joao', label: 'Capacitação aplicável', description: 'Evidência conferida para o serviço.', status: 'APPROVED', restricted: false }] },
      { workerId: 'marcio', name: 'Márcio Lopes', serviceFunction: 'Eletricista', eligible: false, items: [{ requirementId: 'medical-marcio', label: 'Conferência ocupacional restrita', description: 'Descrição clínica privada', status: 'PENDING', restricted: true, evidenceId: 'medical-secret', evidenceRevision: 1, fileName: 'resultado-clinico-privado.pdf', validUntil: '2030-12-31', reason: 'Diagnóstico privado' }] },
    ],
  };
  vi.mocked(api.get).mockImplementation(async path => {
    const appointmentId = path.includes('/appointment-b') ? 'appointment-b' : 'appointment-a';
    return path.endsWith('/eligibility') ? { ...eligibility, appointmentId } : { ...appointment, id: appointmentId };
  });
});

describe('Filtros locais da conferência documental', () => {
  it('busca por nome e função ignorando acentos, caixa e espaços nas extremidades', async () => {
    const user = userEvent.setup();
    renderPanel();
    const search = await screen.findByLabelText('Buscar participante');
    await user.type(search, '  JOAO  ');
    expect(screen.getByRole('article', { name: 'João Silva' })).toBeVisible();
    expect(screen.queryByRole('article', { name: 'Ana Júlia' })).not.toBeInTheDocument();
    expect(screen.getByText('Exibindo 1 de 3 participantes')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Limpar busca' }));
    expect(search).toHaveValue('');
    expect(screen.getAllByRole('article')).toHaveLength(3);
    await user.type(search, 'SEGURANCA');
    expect(screen.getByRole('article', { name: 'Ana Júlia' })).toBeVisible();
    expect(screen.queryByRole('article', { name: 'João Silva' })).not.toBeInTheDocument();
  });

  it('combina busca com a elegibilidade informada pela API sem deduzi-la dos itens', async () => {
    const user = userEvent.setup();
    renderPanel();
    const search = await screen.findByLabelText('Buscar participante');
    await user.click(screen.getByRole('button', { name: /Com pendências/ }));
    expect(screen.getByRole('button', { name: /Com pendências/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Todos os participantes/ })).toHaveAttribute('aria-pressed', 'false');
    // Ana segue pendente porque person.eligible é false, apesar do item APPROVED.
    expect(screen.getByRole('article', { name: 'Ana Júlia' })).toBeVisible();
    expect(screen.getByRole('article', { name: 'Márcio Lopes' })).toBeVisible();
    expect(screen.queryByRole('article', { name: 'João Silva' })).not.toBeInTheDocument();
    expect(screen.getByText('Exibindo 2 de 3 participantes')).toBeVisible();
    await user.type(search, 'julia');
    expect(screen.getByRole('article', { name: 'Ana Júlia' })).toBeVisible();
    expect(screen.queryByRole('article', { name: 'Márcio Lopes' })).not.toBeInTheDocument();
    expect(screen.getByText('Exibindo 1 de 3 participantes')).toBeVisible();
    await user.click(screen.getByRole('button', { name: /Todos os participantes/ }));
    expect(screen.getByRole('button', { name: /Todos os participantes/ })).toHaveAttribute('aria-pressed', 'true');
    expect(search).toHaveValue('julia');
    await user.click(screen.getByRole('button', { name: 'Limpar busca' }));
    expect(screen.getAllByRole('article')).toHaveLength(3);
  });

  it('filtra somente a apresentação sem novos GETs nem alterar o resumo geral do atendimento', async () => {
    const user = userEvent.setup();
    renderPanel();
    const search = await screen.findByLabelText('Buscar participante');
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    const initialRequests = vi.mocked(api.get).mock.calls.length;
    await user.type(search, 'João');
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByText(/Há requisitos pendentes.*liberar e iniciar a execução ficam bloqueados/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: /Com pendências/ }));
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(screen.getByText('Exibindo 0 de 3 participantes')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Limpar busca' }));
    expect(screen.getAllByRole('article')).toHaveLength(3);
    expect(screen.getByRole('button', { name: /Todos os participantes/ })).toHaveAttribute('aria-pressed', 'true');
    expect(api.get).toHaveBeenCalledTimes(initialRequests);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('zera busca e filtro de pendências ao trocar de atendimento', async () => {
    const user = userEvent.setup();
    const { changeAppointment } = renderPanel();
    await user.type(await screen.findByLabelText('Buscar participante'), 'Ana');
    await user.click(screen.getByRole('button', { name: /Com pendências/ }));
    expect(screen.getAllByRole('article')).toHaveLength(1);
    changeAppointment('appointment-b');
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/appointments/appointment-b/eligibility', expect.anything()));
    const search = await screen.findByLabelText('Buscar participante');
    expect(search).toHaveValue('');
    expect(screen.getByRole('button', { name: /Todos os participantes/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Com pendências/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('Exibindo 3 de 3 participantes')).toBeVisible();
  });

  it('mantém metadados restritos ocultos ao apresentar resultados filtrados', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.type(await screen.findByLabelText('Buscar participante'), 'marcio');
    await user.click(screen.getByRole('button', { name: /Com pendências/ }));
    const participant = screen.getByRole('article', { name: 'Márcio Lopes' });
    expect(within(participant).getByText('Conferência ocupacional restrita')).toBeVisible();
    expect(within(participant).getByText(/Conferência restrita por profissional autorizado/)).toBeVisible();
    expect(screen.queryByText(/Descrição clínica privada|resultado-clinico-privado|Diagnóstico privado|31\/12\/2030/)).not.toBeInTheDocument();
    expect(within(participant).queryByRole('button', { name: /Enviar evidência|Substituir evidência|Conferir evidência/ })).not.toBeInTheDocument();
    expect(screen.getByText('Exibindo 1 de 3 participantes')).toBeVisible();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AppointmentDto, EligibilityDto } from '../../shared/contracts/work-permits';
import { EligibilityPanel } from './EligibilityPanel';
import { api } from '../../shared/api/client';

vi.mock('../../shared/api/client', () => ({ api: { get: vi.fn(), post: vi.fn() }, revisionEtag: (revision: number) => `"${revision}"` }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ sessionKey: 'session-a', unitId: 'unit-a', can: () => true }) }));

const appointment: AppointmentDto = { id: 'appointment-a', unitId: 'unit-a', code: 'AG-001', teamId: 'team-a', teamName: 'Equipe A', serviceTypeId: 'service-a', serviceLabel: 'Serviço ilustrativo', location: 'Galpão A', startsAt: '2026-10-09T17:00:00Z', endsAt: '2026-10-09T19:00:00Z', responsibleId: 'operator-a', responsibleName: 'Operador A', participants: [], status: 'CONFIRMED', revision: 4, availableActions: [], history: [] };
let eligibility: EligibilityDto;
let appointmentData: AppointmentDto;
function renderPanel(readOnly = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return { ...render(<QueryClientProvider client={client}><EligibilityPanel appointmentId="appointment-a" readOnly={readOnly} /></QueryClientProvider>), client };
}

beforeEach(() => {
  vi.clearAllMocks();
  appointmentData = { ...appointment };
  eligibility = {
    appointmentId: 'appointment-a', checkedAt: '2026-10-09T15:00:00Z', requirementVersion: 'MATRIZ-DEMO-1', eligible: false,
    participants: [{ workerId: 'person-a', name: 'Pessoa A', serviceFunction: 'Executante', eligible: false, items: [
      { requirementId: 'restricted-a', label: 'Conferência ocupacional restrita', description: 'Dado clínico que não deve aparecer', status: 'APPROVED', evidenceId: 'medical-a', evidenceRevision: 1, fileName: 'exame-clinico-secreto.pdf', validUntil: '2026-12-31', reason: 'Diagnóstico restrito', restricted: true },
      { requirementId: 'training-a', label: 'Evidência de capacitação aplicável', description: 'Requisito do serviço configurado.', status: 'MISSING', restricted: false },
    ] }],
  };
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/eligibility') ? eligibility : appointmentData);
});

describe('Conferência documental no frontend', () => {
  it('não apresenta evidências devolvidas para outro atendimento ou unidade', async () => {
    eligibility = { ...eligibility, appointmentId: 'appointment-b', unitId: 'unit-b' };
    renderPanel();
    await screen.findByRole('heading', { name: 'Conferência de outro contexto' });
    expect(screen.queryByText('Pessoa A')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enviar evidência' })).not.toBeInTheDocument();
  });
  it('protege o arquivo selecionado ao trocar de unidade e bloqueia a troca enquanto envia', async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    vi.mocked(api.post).mockReturnValue(new Promise(resolve => { finish = () => resolve({ id: 'evidence-a' }); }));
    renderPanel();
    const upload = await screen.findByRole('button', { name: 'Enviar evidência' });
    await waitFor(() => expect(upload).toBeEnabled()); await user.click(upload);
    await user.upload(screen.getByLabelText('Arquivo da evidência *'), new File(['%PDF-1.4'], 'certificado.pdf', { type: 'application/pdf' }));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const changed = new Event('sesmt:before-context-change', { cancelable: true });
    act(() => { window.dispatchEvent(changed); });
    expect(changed.defaultPrevented).toBe(true); expect(confirm).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Enviar para conferência' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    confirm.mockClear();
    const busyChange = new Event('sesmt:before-context-change', { cancelable: true });
    act(() => { window.dispatchEvent(busyChange); });
    expect(busyChange.defaultPrevented).toBe(true); expect(confirm).not.toHaveBeenCalled();
    await act(async () => finish()); confirm.mockRestore();
  });
  it('mostra somente a situação operacional da evidência restrita', async () => {
    renderPanel();
    await screen.findByText('Conferência ocupacional restrita');
    expect(screen.getByText(/Conferência restrita por profissional autorizado/)).toBeInTheDocument();
    expect(screen.queryByText(/Dado clínico|exame-clinico-secreto|Diagnóstico restrito|31\/12\/2026/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Enviar evidência' })).toHaveLength(1);
  });
  it('envia arquivo vinculado à pessoa e ao requisito com revisão do atendimento e mantém o bloqueio até conferência', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockImplementation(async () => {
      eligibility = { ...eligibility, participants: eligibility.participants.map(person => ({ ...person, items: person.items.map(item => item.requirementId === 'training-a' ? { ...item, status: 'PENDING', evidenceId: 'evidence-a', evidenceRevision: 1, fileName: 'certificado.pdf' } : item) })) };
      return { id: 'evidence-a', status: 'PENDING' };
    });
    renderPanel();
    await user.click(await screen.findByRole('button', { name: 'Enviar evidência' }));
    await user.upload(screen.getByLabelText('Arquivo da evidência *'), new File(['%PDF-1.4'], 'certificado.pdf', { type: 'application/pdf' }));
    await user.click(screen.getByRole('button', { name: 'Enviar para conferência' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const [path, body, config] = vi.mocked(api.post).mock.calls[0];
    expect(path).toBe('/appointments/appointment-a/evidence');
    expect((body as FormData).get('workerId')).toBe('person-a');
    expect((body as FormData).get('requirementId')).toBe('training-a');
    expect(config?.etag).toBe('"4"');
    expect(await screen.findByText('Aguardando conferência')).toBeInTheDocument();
    expect(screen.getByText(/liberar e iniciar a execução ficam bloqueados/)).toBeInTheDocument();
  });
  it('suprime envio e conferência quando o atendimento é somente leitura', async () => {
    renderPanel(true);
    await screen.findByText('Conferência ocupacional restrita');
    expect(screen.queryByRole('button', { name: 'Enviar evidência' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Conferir evidência' })).not.toBeInTheDocument();
  });
  it('preserva a revisão capturada ao abrir o envio quando um refetch atualiza o atendimento', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockRejectedValue({ status: 412, message: 'Dados alterados.' });
    const { client } = renderPanel();
    const upload = await screen.findByRole('button', { name: 'Enviar evidência' });
    await waitFor(() => expect(upload).toBeEnabled());
    await user.click(upload);
    await user.upload(screen.getByLabelText('Arquivo da evidência *'), new File(['%PDF-1.4'], 'certificado.pdf', { type: 'application/pdf' }));
    appointmentData = { ...appointmentData, revision: 5 };
    await act(async () => { await client.refetchQueries({ queryKey: ['appointment'] }); });
    expect(client.getQueryData<AppointmentDto>(['appointment', 'session-a', 'unit-a', 'appointment-a'])?.revision).toBe(5);
    await user.click(screen.getByRole('button', { name: 'Enviar para conferência' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.post).mock.calls[0][2]?.etag).toBe('"4"');
    expect(await screen.findByText(/Feche esta janela, atualize a conferência/)).toBeInTheDocument();
  });
});

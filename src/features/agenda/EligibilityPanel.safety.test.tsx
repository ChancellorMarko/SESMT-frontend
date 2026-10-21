import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { AppointmentDto, EligibilityDto } from '../../shared/contracts/work-permits';
import { api } from '../../shared/api/client';
import { EligibilityPanel } from './EligibilityPanel';

vi.mock('../../shared/api/client', () => ({ api: { get: vi.fn(), post: vi.fn() }, revisionEtag: (revision: number) => `"${revision}"` }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ sessionKey: 'session-a', unitId: 'unit-a', can: () => true }) }));

let reviewable = false;

function appointmentFor(id: string): AppointmentDto {
  return { id, unitId: 'unit-a', code: id, teamId: 'team-a', teamName: 'Equipe A', serviceTypeId: 'service-a', serviceLabel: 'Serviço ilustrativo', location: 'Galpão A', startsAt: '2026-10-09T17:00:00Z', endsAt: '2026-10-09T19:00:00Z', responsibleId: 'operator-a', responsibleName: 'Operador A', participants: [], status: 'CONFIRMED', revision: 4, availableActions: [], history: [] };
}

function eligibilityFor(id: string): EligibilityDto {
  return { appointmentId: id, unitId: 'unit-a', checkedAt: '2026-10-09T15:00:00Z', requirementVersion: 'MATRIZ-DEMO-1', eligible: false, participants: [{ workerId: `person-${id}`, name: `Pessoa de ${id}`, serviceFunction: 'Executante', eligible: false, items: [{ source: 'REQUIREMENT_MATRIX', requirementId: 'training-a', label: 'Capacitação aplicável', description: 'Requisito do serviço configurado.', status: reviewable ? 'PENDING' : 'MISSING', restricted: false, ...(reviewable ? { evidenceId: `evidence-${id}`, evidenceRevision: 1, fileName: `certificado-${id}.pdf` } : {}) }] }] };
}

async function queryData(path: string) {
  const id = path.split('/')[2];
  return path.endsWith('/eligibility') ? eligibilityFor(id) : appointmentFor(id);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((complete, fail) => { resolve = complete; reject = fail; });
  return { promise, resolve, reject };
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const content = (id: string) => <QueryClientProvider client={client}><MemoryRouter><EligibilityPanel appointmentId={id} /></MemoryRouter></QueryClientProvider>;
  const view = render(content('appointment-a'));
  return { ...view, changeAppointment: (id: string) => view.rerender(content(id)) };
}

async function openUpload(user: ReturnType<typeof userEvent.setup>) {
  const trigger = await screen.findByRole('button', { name: /^Enviar evidência$/ });
  await waitFor(() => expect(trigger).toBeEnabled());
  await user.click(trigger);
}

async function addFile(user: ReturnType<typeof userEvent.setup>) {
  const file = new File(['%PDF-1.4'], 'certificado.pdf', { type: 'application/pdf' });
  const input = screen.getByLabelText('Arquivo da evidência *') as HTMLInputElement;
  await user.upload(input, file);
  return { file, input };
}

const closers = ['Escape', 'Fechar janela', 'Cancelar'] as const;
async function closeWith(user: ReturnType<typeof userEvent.setup>, method: typeof closers[number]) {
  if (method === 'Escape') await user.keyboard('{Escape}');
  else await user.click(screen.getByRole('button', { name: method }));
}

beforeEach(() => {
  vi.clearAllMocks();
  reviewable = false;
  vi.mocked(api.get).mockImplementation(queryData);
});

describe('Proteção do preenchimento da conferência documental', () => {
  it.each(closers)('preserva o arquivo ao recusar %s e descarta apenas após aceitar', async method => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPanel();
    await openUpload(user);
    const { file, input } = await addFile(user);
    await closeWith(user, method);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(input.files?.[0]).toBe(file);
    expect(api.post).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    await closeWith(user, method);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it.each(closers)('preserva o motivo ao recusar %s e descarta apenas após aceitar', async method => {
    reviewable = true;
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPanel();
    await user.click(await screen.findByRole('button', { name: 'Conferir evidência' }));
    await user.selectOptions(screen.getByLabelText('Decisão da conferência'), 'REJECT');
    const reason = screen.getByLabelText('Motivo da rejeição *');
    await user.type(reason, 'O certificado não corresponde à pessoa vinculada.');
    await closeWith(user, method);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(reason).toHaveValue('O certificado não corresponde à pessoa vinculada.');
    expect(screen.getByLabelText('Decisão da conferência')).toHaveValue('REJECT');
    expect(api.post).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    await closeWith(user, method);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it.each(closers)('fecha um envio vazio por %s sem pedir descarte', async method => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPanel();
    await openUpload(user);
    await closeWith(user, method);
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });
});

describe('Isolamento das operações entre atendimentos', () => {
  it('ignora a conclusão de um POST antigo e permite preencher o atendimento atual', async () => {
    const user = userEvent.setup();
    const oldPost = deferred<{ id: string }>();
    vi.mocked(api.post).mockReturnValue(oldPost.promise);
    const { changeAppointment } = renderPanel();
    await openUpload(user); await addFile(user);
    await user.click(screen.getByRole('button', { name: 'Enviar para conferência' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const oldSignal = vi.mocked(api.post).mock.calls[0][2]?.signal;

    changeAppointment('appointment-b');
    await screen.findByRole('heading', { name: 'Pessoa de appointment-b' });
    expect(oldSignal).toBeDefined(); expect(oldSignal?.aborted).toBe(true);
    await openUpload(user);
    const current = await addFile(user);
    await act(async () => oldPost.resolve({ id: 'old-evidence' }));

    expect(screen.getByRole('dialog')).toBeVisible();
    expect(current.input.files?.[0]).toBe(current.file);
    expect(screen.getByRole('button', { name: 'Enviar para conferência' })).toBeEnabled();
    expect(screen.queryByText('Evidência enviada para conferência. O envio sozinho não libera a pessoa para executar.')).not.toBeInTheDocument();
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('ignora uma rejeição tardia do POST depois da troca de atendimento', async () => {
    const user = userEvent.setup();
    const oldPost = deferred<{ id: string }>();
    vi.mocked(api.post).mockReturnValue(oldPost.promise);
    const { changeAppointment } = renderPanel();
    await openUpload(user); await addFile(user);
    await user.click(screen.getByRole('button', { name: 'Enviar para conferência' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    changeAppointment('appointment-b');
    await screen.findByRole('heading', { name: 'Pessoa de appointment-b' });
    await openUpload(user);
    await act(async () => oldPost.reject(new Error('Falha antiga do atendimento A.')));
    expect(screen.queryByText('Falha antiga do atendimento A.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enviar para conferência' })).toBeEnabled();
    expect(screen.getByRole('dialog')).toBeVisible();
  });

  it.each(['resolve', 'reject'] as const)('aborta e ignora o download antigo que %s após mudar o atendimento', async outcome => {
    reviewable = true;
    const user = userEvent.setup();
    const oldDownload = deferred<{ url: string; fileName: string; expiresAt: string }>();
    vi.mocked(api.get).mockImplementation(path => path.endsWith('/download') ? oldDownload.promise : queryData(path));
    const { changeAppointment } = renderPanel();
    await user.click(await screen.findByRole('button', { name: 'Conferir evidência' }));
    await user.click(screen.getByRole('button', { name: 'Preparar arquivo para consulta' }));
    await waitFor(() => expect(vi.mocked(api.get).mock.calls.some(([path]) => path.endsWith('/download'))).toBe(true));
    const oldSignal = vi.mocked(api.get).mock.calls.find(([path]) => path.endsWith('/download'))?.[1]?.signal;

    changeAppointment('appointment-b');
    await screen.findByRole('heading', { name: 'Pessoa de appointment-b' });
    expect(oldSignal).toBeDefined(); expect(oldSignal?.aborted).toBe(true);
    await user.click(await screen.findByRole('button', { name: 'Conferir evidência' }));
    expect(screen.getByRole('button', { name: 'Preparar arquivo para consulta' })).toBeEnabled();
    await act(async () => {
      if (outcome === 'resolve') oldDownload.resolve({ url: `${window.location.origin}/api/v1/evidence/old/download.pdf`, fileName: 'arquivo-antigo-a.pdf', expiresAt: new Date(Date.now() + 60_000).toISOString() });
      else oldDownload.reject(new Error('Falha antiga ao preparar arquivo A.'));
    });
    expect(screen.queryByRole('link', { name: /arquivo-antigo-a/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Falha antiga ao preparar arquivo A.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preparar arquivo para consulta' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Registrar conferência' })).toBeEnabled();
    expect(api.post).not.toHaveBeenCalled();
  });
});

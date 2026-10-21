import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../shared/api/client';
import type { WorkPermitDto } from '../../shared/contracts/work-permits';
import type { PermitAttachmentCreatedDto, PermitAttachmentDto } from '../../shared/contracts/permit-attachments';
import { PermitDetailPage } from './PermitDetailPage';

const state = vi.hoisted(() => ({ permit: null as WorkPermitDto | null, uploaded: false }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({
  sessionKey: 'session', unitId: 'unit', me: { user: { id: 'technician', displayName: 'Técnico Demo' } },
  can: (permission: string) => ['permits.read', 'permits.operate'].includes(permission),
}) }));
vi.mock('../../shared/api/client', async original => ({
  ...await original<typeof import('../../shared/api/client')>(),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));

const attachment: PermitAttachmentDto = {
  id: 'attachment', permitId: 'permit', version: 1, name: 'foto.png', fileName: 'foto.png',
  mimeType: 'image/png', sizeBytes: 8, caption: 'Registro da área após inspeção.',
  uploadedBy: 'technician', uploadedByName: 'Técnico Demo', uploadedAt: '2026-10-20T12:00:00Z',
};
function example(): WorkPermitDto {
  return {
    id: 'permit', code: 'PT-COORDENACAO', version: 1, revision: 4, templateVersion: 'Modelo escolar v1',
    appointment: {
      id: 'appointment', code: 'AG-COORDENACAO', unitId: 'unit', teamId: 'team', teamName: 'Equipe Demo',
      serviceTypeId: 'service', serviceLabel: 'Serviço ilustrativo', location: 'Local de demonstração',
      startsAt: '2026-10-20T12:00:00Z', endsAt: '2026-10-20T14:00:00Z',
      responsibleId: 'technician', responsibleName: 'Técnico Demo', participants: [],
      status: 'ATTENDANCE_OPENED', revision: 1, availableActions: [], history: [],
    },
    operationStatus: 'EXECUTING', reviewStatus: 'NOT_SUBMITTED', checklist: [], sciences: [],
    eligibility: { appointmentId: 'appointment', eligible: true, checkedAt: '2026-10-20T12:00:00Z', requirementVersion: 'Matriz escolar v1', participants: [] },
    availableActions: ['COMPLETE', 'SUSPEND'], snapshots: [], history: [],
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(complete => { resolve = complete; });
  return { promise, resolve };
}
function show(beforeRequest?: Promise<void>) {
  const client = new QueryClient({ defaultOptions: {
    queries: { retry: false }, mutations: { retry: false, onMutate: () => beforeRequest },
  } });
  render(<QueryClientProvider client={client}>
    <MemoryRouter initialEntries={['/app/pts/permit']}><Routes>
      <Route path="/app/pts/:id" element={<PermitDetailPage />} />
    </Routes></MemoryRouter>
  </QueryClientProvider>);
}
async function fillAttachment(user: ReturnType<typeof userEvent.setup>) {
  const input = await screen.findByLabelText('Arquivo de acompanhamento *');
  await waitFor(() => expect(input).toBeEnabled());
  const file = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'foto.png', { type: 'image/png' });
  await user.upload(input, file);
  await user.type(screen.getByLabelText('Descrição do anexo *'), attachment.caption);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Registrar anexo' })).toBeEnabled());
  return { input: input as HTMLInputElement, file };
}

beforeEach(() => {
  state.permit = example(); state.uploaded = false; vi.clearAllMocks();
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/attachments')
    ? state.uploaded ? [attachment] : []
    : path === '/designation-coverage' ? { unitId: 'unit', items: [], fullyCovered: true }
      : structuredClone(state.permit));
});

describe('coordenação do upload com as outras ações da PT', () => {
  it('mantém o próprio envio autorizado após propagar busy e bloqueia operações concorrentes até a confirmação', async () => {
    const beforeRequest = deferred<void>();
    const request = deferred<PermitAttachmentCreatedDto>();
    vi.mocked(api.post).mockReturnValue(request.promise);
    const user = userEvent.setup(); show(beforeRequest.promise);
    const { input, file } = await fillAttachment(user);
    const complete = screen.getByRole('button', { name: 'Concluir atividade e enviar para revisão' });
    const suspend = screen.getByRole('button', { name: 'Suspender operação' });
    expect(complete).toBeEnabled();
    expect(suspend).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Registrar anexo' }));

    // Let the real parent's onBusyChange rerender before the upload mutation begins.
    await waitFor(() => expect(screen.getByRole('region', { name: 'Permissão de trabalho' })).toHaveAttribute('aria-busy', 'true'));
    expect(api.post).not.toHaveBeenCalled();
    expect(complete).toBeDisabled();
    expect(suspend).toBeDisabled();
    expect(screen.getByLabelText('Resumo do atendimento')).toBeDisabled();
    expect(input).toBeDisabled();
    expect(screen.getByLabelText('Descrição do anexo *')).toBeDisabled();

    await act(async () => { beforeRequest.resolve(undefined); });
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledWith('/work-permits/permit/attachments', expect.any(FormData), { etag: '"4"' });
    const body = vi.mocked(api.post).mock.calls[0][1] as FormData;
    expect(body.get('caption')).toBe(attachment.caption);
    expect(body.get('version')).toBe('1');
    expect((body.get('file') as File).name).toBe(file.name);
    expect(screen.getByRole('button', { name: 'Registrando…' })).toBeDisabled();
    expect(screen.queryByText('Salve as alterações da PT e aguarde a confirmação antes de registrar um anexo.')).not.toBeInTheDocument();
    await user.click(complete);
    await user.click(suspend);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.patch).not.toHaveBeenCalled();

    state.uploaded = true; state.permit!.revision = 5;
    await act(async () => { request.resolve({ attachment, permitRevision: 5, permitVersion: 1 }); });
    expect(await screen.findByText('Anexo registrado nesta versão da PT.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('region', { name: 'Permissão de trabalho' })).toHaveAttribute('aria-busy', 'false'));
    expect(complete).toBeEnabled();
    expect(suspend).toBeEnabled();
    expect(input.files).toHaveLength(0);
    expect(screen.getByLabelText('Descrição do anexo *')).toHaveValue('');
    expect(screen.getByText(attachment.fileName)).toBeInTheDocument();
  });

  it('continua bloqueando o anexo por rascunho externo e preserva o arquivo até desfazer o resumo', async () => {
    const user = userEvent.setup(); show();
    const { input, file } = await fillAttachment(user);
    const summary = screen.getByLabelText('Resumo do atendimento');
    await user.type(summary, 'Resumo ainda não enviado');
    expect(input).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Registrar anexo' })).toBeDisabled();
    expect(screen.getByLabelText('Descrição do anexo *')).toHaveValue(attachment.caption);
    expect(input.files?.[0]).toBe(file);
    expect(api.post).not.toHaveBeenCalled();
    await user.clear(summary);
    expect(input).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Registrar anexo' })).toBeEnabled();
    expect(input.files?.[0]).toBe(file);
    expect(screen.getByLabelText('Descrição do anexo *')).toHaveValue(attachment.caption);
  });
});

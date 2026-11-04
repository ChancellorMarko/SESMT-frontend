import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../../shared/api/client';
import type { WorkPermitDto } from '../../shared/contracts/work-permits';
import type { PermitAttachmentDto } from '../../shared/contracts/permit-attachments';
import { PermitAttachments } from './PermitAttachments';

const state = vi.hoisted(() => ({ permit: null as WorkPermitDto | null, permissions: ['permits.read', 'permits.operate'], userId: 'technician' }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ sessionKey: 'session', unitId: 'unit', me: { user: { id: state.userId } }, can: (permission: string) => state.permissions.includes(permission) }) }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn(), post: vi.fn() } }));
const attachment: PermitAttachmentDto = { id: 'attachment', permitId: 'permit', version: 1, name: 'foto.png', fileName: 'foto.png', mimeType: 'image/png', sizeBytes: 8, caption: 'Área do atendimento.', uploadedBy: 'technician', uploadedByName: 'Técnico Demo', uploadedAt: '2026-10-10T12:00:00Z' };
function example(): WorkPermitDto {
  return { id: 'permit', code: 'PT-TESTE', version: 1, revision: 4, templateVersion: 'Modelo escolar v1',
    appointment: { id: 'appointment', code: 'AG-TESTE', unitId: 'unit', teamId: 'team', teamName: 'Equipe Demo', serviceTypeId: 'service', serviceLabel: 'Serviço ilustrativo', location: 'Local de demonstração', startsAt: '2026-10-10T12:00:00Z', endsAt: '2026-10-10T14:00:00Z', responsibleId: 'technician', responsibleName: 'Técnico Demo', participants: [], status: 'ATTENDANCE_OPENED', revision: 1, availableActions: [], history: [] },
    operationStatus: 'EXECUTING', reviewStatus: 'NOT_SUBMITTED', checklist: [], sciences: [], eligibility: { appointmentId: 'appointment', eligible: true, checkedAt: '2026-10-10T12:00:00Z', requirementVersion: 'Matriz escolar v1', participants: [] }, availableActions: ['COMPLETE'], snapshots: [], history: [] };
}
function Connected() {
  const query = useQuery({ queryKey: ['work-permit', 'session', 'unit', 'permit'], queryFn: () => api.get<WorkPermitDto>('/work-permits/permit') });
  return query.data ? <PermitAttachments permit={query.data} /> : null;
}
function show(disabled = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}>{disabled ? <PermitAttachments permit={state.permit!} disabled /> : <Connected />}</QueryClientProvider>);
  return client;
}
beforeEach(() => {
  state.permit = example(); state.permissions = ['permits.read', 'permits.operate']; state.userId = 'technician'; vi.clearAllMocks();
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/attachments') ? [] : structuredClone(state.permit));
  vi.mocked(api.post).mockResolvedValue({ attachment, permitRevision: 5, permitVersion: 1 });
});
describe('anexos de acompanhamento da PT', () => {
  it('preserva arquivo e descrição após conflito e só reenvia com a revisão atual', async () => {
    const user = userEvent.setup(); show();
    const file = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'foto.png', { type: 'image/png' });
    const input = await screen.findByLabelText('Arquivo de acompanhamento *');
    await user.upload(input, file);
    await user.type(screen.getByLabelText('Descrição do anexo *'), 'Registro da área após inspeção.');
    vi.mocked(api.post).mockRejectedValueOnce(new ApiError(412, { code: 'REVISION_CONFLICT', message: 'A PT mudou.', requestId: 'conflict' }));
    await user.click(screen.getByRole('button', { name: 'Registrar anexo' }));
    expect(await screen.findByRole('button', { name: 'Atualizar PT e preservar anexo' })).toBeInTheDocument();
    expect(screen.getByLabelText('Descrição do anexo *')).toHaveValue('Registro da área após inspeção.');
    expect((input as HTMLInputElement).files?.[0]).toBe(file);
    state.permit!.revision = 6;
    await user.click(screen.getByRole('button', { name: 'Atualizar PT e preservar anexo' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Registrar anexo' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Registrar anexo' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    expect(api.post).toHaveBeenLastCalledWith('/work-permits/permit/attachments', expect.any(FormData), { etag: '"6"' });
    const body = vi.mocked(api.post).mock.calls[1][1] as FormData;
    expect(body.get('caption')).toBe('Registro da área após inspeção.'); expect(body.get('version')).toBe('1');
    expect((body.get('file') as File).name).toBe('foto.png');
  });
  it('recusa link de origem externa para download', async () => {
    vi.mocked(api.get).mockImplementation(async path => path.endsWith('/attachments') ? [attachment] : path.endsWith('/download')
      ? { url: 'https://untrusted.example.test/foto.png', expiresAt: new Date(Date.now() + 60000).toISOString(), fileName: 'foto.png', mimeType: 'image/png' }
      : structuredClone(state.permit));
    const user = userEvent.setup(); show();
    await user.click(await screen.findByRole('button', { name: 'Preparar download de foto.png' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/endereço de download retornado é inválido/);
    expect(screen.queryByRole('link', { name: 'Baixar arquivo' })).not.toBeInTheDocument();
  });
  it('permite consulta do histórico após encerramento e oculta envio', async () => {
    state.permit!.operationStatus = 'COMPLETED'; state.permit!.reviewStatus = 'VALIDATED';
    vi.mocked(api.get).mockImplementation(async path => path.endsWith('/attachments') ? [attachment] : structuredClone(state.permit));
    show();
    expect(await screen.findByText('foto.png')).toBeInTheDocument();
    expect(screen.getByText('Área do atendimento.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Arquivo de acompanhamento *')).not.toBeInTheDocument();
  });
  it('bloqueia envio enquanto a PT tem alterações não salvas no formulário principal', async () => {
    show(true);
    expect(await screen.findByLabelText('Arquivo de acompanhamento *')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Registrar anexo' })).toBeDisabled();
    expect(api.post).not.toHaveBeenCalled();
  });
});

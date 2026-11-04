import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import { api, ApiError } from '../../shared/api/client';
import { NativePermitScience } from './NativePermitScience';
import { permitFixture, permitIds as ids, declarationFixture } from '../../../tests/connection-ui/fixtures/native-permits';
import { scienceFixture, scienceParticipantFixture } from '../../../tests/connection-ui/fixtures/native-science';

vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ sessionKey: 'science-test', me: { user: { id: '65000000-0000-4000-8000-000000000001', displayName: 'Pessoa da operação' } } }) }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn(), post: vi.fn() } }));
let current = permitFixture(), statement = scienceFixture(), done = vi.fn(async () => {});
function show(item = current) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } }); done = vi.fn(async () => {});
  render(<QueryClientProvider client={client}><MemoryRouter><NativePermitScience item={item} refreshing={false} onDone={done}/></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => {
  vi.clearAllMocks(); current = permitFixture(); statement = scienceFixture();
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/declarations') ? structuredClone(statement) as never : structuredClone(current) as never);
});
async function open() { fireEvent.click(screen.getByRole('button', { name: 'Registrar minha ciência' })); return screen.findByRole('dialog', { name: 'Registrar minha ciência' }); }
it('envia somente a própria ciência com hash, versões e confirmação explícita', async () => {
  vi.mocked(api.post).mockImplementation(async (_path, body) => {
    const receipt = scienceParticipantFixture(current, (body as { confirmedName: string }).confirmedName);
    current = { ...current, version: current.version + 1, participants: [receipt] }; return receipt as never;
  });
  show(); const dialog = await open(); await within(dialog).findByText('Declaração fornecida pelo modelo da operação.');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar minha ciência' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('confirme'); expect(api.post).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('checkbox')); fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar minha ciência' }));
  await waitFor(() => expect(done).toHaveBeenCalledOnce());
  expect(api.post).toHaveBeenCalledWith(`/work-permits/${ids.permit}/acknowledge`, expect.objectContaining({ expectedVersion: 4, contentVersion: 3,
    participantUserId: ids.user, confirmedName: 'Pessoa da operação', identificationMethod: 'Sessão autenticada', confirmation: true, contentHash: statement.contentHash }), expect.objectContaining({ idempotencyKey: undefined }));
  expect(current.status).toBe('EM_VERIFICACAO');
});
it('não habilita confirmação no contrato antigo e não inventa o conteúdo ausente', async () => {
  vi.mocked(api.get).mockResolvedValue(declarationFixture()); show(); const dialog = await open();
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('conteúdo integral'); expect(within(dialog).getByRole('button', { name: 'Confirmar minha ciência' })).toBeDisabled(); expect(api.post).not.toHaveBeenCalled();
});
it('mudança de contexto entre a leitura e a confirmação bloqueia o POST e mantém o formulário', async () => {
  show(); const dialog = await open(); await within(dialog).findByText('Declaração fornecida pelo modelo da operação.');
  statement = { ...statement, contentHash: 'a'.repeat(64) }; fireEvent.click(within(dialog).getByRole('checkbox')); fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar minha ciência' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('contexto mudaram'); expect(within(dialog).getByRole('checkbox')).toBeChecked(); expect(api.post).not.toHaveBeenCalled();
});
it('conflito no servidor preserva o nome e exige atualização sem reenviar a ciência', async () => {
  vi.mocked(api.post).mockRejectedValue(new ApiError(409, { code: 'DOMAIN_VIOLATION', message: 'Privado', requestId: 'test' }));
  show(); const dialog = await open(); await within(dialog).findByText('Declaração fornecida pelo modelo da operação.'); fireEvent.change(within(dialog).getByLabelText('Seu nome completo'), { target: { value: 'Pessoa da operação confirmada' } });
  fireEvent.click(within(dialog).getByRole('checkbox')); fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar minha ciência' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('Seus dados foram mantidos'); expect(within(dialog).getByLabelText('Seu nome completo')).toHaveValue('Pessoa da operação confirmada'); expect(within(dialog).getByRole('button', { name: 'Confirmar minha ciência' })).toBeDisabled();
});
it('não oferece ciência por outra pessoa nem depois da liberação', () => {
  show({ ...current, participants: [{ ...current.participants[0], userId: ids.responsible }] }); expect(screen.queryByRole('button', { name: 'Registrar minha ciência' })).not.toBeInTheDocument();
});

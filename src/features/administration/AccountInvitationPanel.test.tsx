import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserDto } from '../../shared/contracts';
import type { AccountInvitationSummaryDto } from '../../shared/contracts/account-invitations';
import { api, ApiError } from '../../shared/api/client';
import { AccountInvitationPanel } from './AccountInvitationPanel';

const runtime = vi.hoisted(() => ({ mode: 'demo', enabled: true, allowed: true, sessionKey: 'session-a', unitId: 'unit-a' }));
vi.mock('../../shared/api/client', async original => ({
  ...await original<typeof import('../../shared/api/client')>(),
  get API_MODE() { return runtime.mode; },
  api: { get: vi.fn() },
}));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ sessionKey: runtime.sessionKey, unitId: runtime.unitId, can: () => runtime.allowed }) }));
vi.mock('../auth/account-invitations', () => ({ accountInvitationsEnabled: () => runtime.enabled }));

const user: UserDto = { id: 'user-1', displayName: 'Pessoa Convidada', email: 'pessoa@example.invalid', roles: ['TECHNICIAN'], status: 'INVITED', mfaRequired: false, revision: 3, scope: { companyIds: ['company-a'], unitIds: ['unit-a'], teamIds: [], sectorIds: [], ownOnly: false } };
const summary: AccountInvitationSummaryDto = { userId: user.id, userRevision: user.revision, status: 'PENDING', expiresAt: '2099-01-01T00:00:00Z', mfaRequired: false, deliveryStatus: 'SIMULATED', demoActivationPath: '/ativar-acesso#token=convite-demo-1234567890' };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function show(record = user) {
  const tree = () => <MemoryRouter><AccountInvitationPanel user={record} /></MemoryRouter>;
  const view = render(tree());
  return { ...view, update: () => view.rerender(tree()) };
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(runtime, { mode: 'demo', enabled: true, allowed: true, sessionKey: 'session-a', unitId: 'unit-a' });
  vi.mocked(api.get).mockResolvedValue(structuredClone(summary) as never);
});

describe('consulta de convite de conta', () => {
  it('explica as etapas, não promete entrega e oferece exploração somente com link demo válido', async () => {
    show();
    expect(await screen.findByRole('heading', { name: 'Pessoa Convidada' })).toBeVisible();
    expect(screen.getByText('Aguardando ativação')).toBeVisible();
    expect(screen.getByRole('list', { name: 'Etapas do primeiro acesso' })).toHaveTextContent('Cadastro');
    expect(screen.getByText('Definir senha').closest('li')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('Envio não realizado')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Definir primeiro acesso' })).toHaveAttribute('href', summary.demoActivationPath);
    expect(screen.queryByLabelText(/senha/i)).not.toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/users/user-1/invitation', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it.each([
    { ...summary, userId: 'another-user' },
    { ...summary, userRevision: 4 },
    { ...summary, mfaRequired: true },
    { ...summary, expiresAt: 'not-a-date' },
    { ...summary, demoActivationPath: 'https://example.invalid/ativar-acesso#token=convite-demo-1234567890' },
    { ...summary, demoActivationPath: '/ativar-acesso#token=convite-demo-1234567890&redirect=https://example.invalid' },
  ])('recusa metadados incompatíveis ou links fora do contrato (%#)', async value => {
    vi.mocked(api.get).mockResolvedValueOnce(value as never);
    show();
    expect(await screen.findByText(/Os dados do convite não correspondem/)).toBeVisible();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Pessoa Convidada' })).not.toBeInTheDocument();
  });

  it.each(['EXPIRED', 'REVOKED', 'ACCEPTED'] as const)('não permite explorar um convite %s', async status => {
    vi.mocked(api.get).mockResolvedValueOnce({ ...summary, status } as never);
    show();
    await screen.findByRole('heading', { name: 'Pessoa Convidada' });
    expect(screen.queryByRole('link', { name: 'Definir primeiro acesso' })).not.toBeInTheDocument();
    expect(screen.getByText(status === 'ACCEPTED' ? /Este convite já foi utilizado/ : /Este convite não pode mais ser utilizado/)).toBeVisible();
  });

  it('reconhece a expiração local mesmo quando o recibo ainda diz PENDING', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ ...summary, expiresAt: '2001-01-01T00:00:00Z' } as never);
    show();
    expect(await screen.findByText('Convite expirado')).toBeVisible();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('não consulta nem apresenta dados sem permissão ou quando o recurso está desabilitado', () => {
    runtime.allowed = false;
    const view = show();
    expect(screen.getByText(/Seu acesso não permite consultar/)).toBeVisible();
    expect(api.get).not.toHaveBeenCalled();
    runtime.allowed = true; runtime.enabled = false; view.update();
    expect(screen.getByText('Consulta de convites de conta indisponível.')).toBeVisible();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('aborta consulta antiga na troca de unidade e não exibe a resposta tardia', async () => {
    const old = deferred<unknown>(), current = deferred<unknown>();
    vi.mocked(api.get).mockReturnValueOnce(old.promise as never).mockReturnValueOnce(current.promise as never);
    const view = show();
    const oldSignal = vi.mocked(api.get).mock.calls[0][1]!.signal!;
    runtime.unitId = 'unit-b'; view.update();
    expect(oldSignal.aborted).toBe(true);
    await act(async () => { old.resolve(summary); });
    expect(screen.queryByRole('heading', { name: 'Pessoa Convidada' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    await act(async () => { current.resolve({ ...summary, status: 'REVOKED' }); });
    expect(await screen.findByText('Convite revogado')).toBeVisible();
  });

  it('limpa um erro de rede ao consultar novamente e revalida a resposta', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('Não foi possível conectar à API.'));
    const interaction = userEvent.setup();
    show();
    await interaction.click(await screen.findByRole('button', { name: 'Consultar convite novamente' }));
    expect(await screen.findByRole('heading', { name: 'Pessoa Convidada' })).toBeVisible();
    expect(screen.queryByText('Não foi possível conectar à API.')).not.toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it('oculta contexto e link após uma negativa de acesso', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new ApiError(403, { code: 'FORBIDDEN', message: 'Negado', requestId: 'test' }));
    show();
    expect(await screen.findByText(/Este convite não está disponível para o seu acesso atual/)).toBeVisible();
    expect(screen.queryByText(user.email)).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('não expõe um token de exploração recebido no modo API', async () => {
    runtime.mode = 'api';
    show();
    expect(await screen.findByText(/Os dados do convite não correspondem/)).toBeVisible();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByText(user.email)).not.toBeInTheDocument();
  });

  it('descreve o envio real sem afirmar entrega nem oferecer link demonstrativo', async () => {
    runtime.mode = 'api';
    const { demoActivationPath: _path, ...safe } = summary;
    vi.mocked(api.get).mockResolvedValueOnce({ ...safe, deliveryStatus: 'SENT' } as never);
    show();
    expect(await screen.findByText('Envio registrado')).toBeVisible();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('explica a exigência de autenticador sem oferecer configuração ou sessão plena', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ ...summary, mfaRequired: true } as never);
    show({ ...user, mfaRequired: true });
    expect(await screen.findByText('Configure e verifique o autenticador para acessar a conta administrativa.')).toBeVisible();
    expect(screen.getByText('Com verificação em duas etapas')).toBeVisible();
    expect(screen.queryByRole('button', { name: /configurar/i })).not.toBeInTheDocument();
  });

  it('explica que uma conta de dados próprios precisa do vínculo com o trabalhador', async () => {
    show({ ...user, scope: { ...user.scope, ownOnly: true } });
    expect(await screen.findByText(/O acesso aos dados próprios depende do vínculo/)).toBeVisible();
  });
});

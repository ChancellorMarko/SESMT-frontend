import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../shared/api/client';
import type { PermitOptionsDto } from '../../shared/contracts/work-permits';
import { DesignationFormPage, designationFormSchema } from './DesignationFormPage';

const state = vi.hoisted(() => ({ unitId: 'unit-a', sessionKey: 'session-a', permissions: ['appointments.write'] }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ ...state, can: (permission: string) => state.permissions.includes(permission) }) }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn(), post: vi.fn() } }));
const options: PermitOptionsDto = { teams: [], responsibles: [{ id: 'responsible', name: 'Técnico Demo' }], services: [{ id: 'service', name: 'Trabalho em altura', description: 'Serviço fictício.', templateVersion: '1', requirementVersion: '1' }] };

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const tree = () => <QueryClientProvider client={client}><MemoryRouter initialEntries={['/app/designacoes/nova']}><Routes><Route path="/app/designacoes/nova" element={<DesignationFormPage />} /><Route path="/app/designacoes" element={<p>Lista de designações</p>} /><Route path="/app/designacoes/:id" element={<p>Designação salva</p>} /></Routes></MemoryRouter></QueryClientProvider>;
  const view = render(tree()); return { ...view, client, update: () => view.rerender(tree()) };
}
async function fill() {
  const user = userEvent.setup();
  await user.selectOptions(await screen.findByLabelText('Responsável *'), 'responsible');
  await user.type(screen.getByLabelText('Local / alcance'), 'Galpão de teste');
  fireEvent.change(screen.getByLabelText('Início da vigência *'), { target: { value: '2026-10-13' } });
  fireEvent.change(screen.getByLabelText('Fim da vigência *'), { target: { value: '2026-12-31' } });
  await user.click(screen.getByRole('checkbox', { name: 'Trabalho em altura' }));
  return user;
}
beforeEach(() => {
  state.unitId = 'unit-a'; state.sessionKey = 'session-a'; state.permissions = ['appointments.write'];
  vi.mocked(api.get).mockReset().mockResolvedValue(structuredClone(options)); vi.mocked(api.post).mockReset();
});

describe('criação protegida de designações', () => {
  it('rejeita datas civis inexistentes e admite 29 de fevereiro no ano bissexto', () => {
    const value = { responsibleId: 'responsible', locationPattern: '', validFrom: '2026-02-31', validUntil: '2026-12-31' };
    expect(designationFormSchema.safeParse(value).success).toBe(false);
    expect(designationFormSchema.safeParse({ ...value, validFrom: '2026-02-29' }).success).toBe(false);
    expect(designationFormSchema.safeParse({ ...value, validFrom: '2028-02-29', validUntil: '2028-12-31' }).success).toBe(true);
    expect(designationFormSchema.safeParse({ ...value, validFrom: '2026-12-31', validUntil: '2026-10-13' }).success).toBe(false);
  });
  it('confirma o descarte ao sair, preservando o preenchimento quando o usuário continua', async () => {
    show(); const user = await fill(); await user.click(screen.getByRole('link', { name: 'Voltar' }));
    const dialog = screen.getByRole('dialog', { name: 'Alterações não salvas' });
    await user.click(within(dialog).getByRole('button', { name: 'Continuar preenchendo' }));
    expect(screen.getByLabelText('Local / alcance')).toHaveValue('Galpão de teste');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const event = new Event('sesmt:before-context-change', { cancelable: true });
    window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true); expect(confirm).toHaveBeenCalledOnce(); confirm.mockRestore();
  });
  it('bloqueia troca de contexto e edição até a criação ser confirmada', async () => {
    let complete!: (value: unknown) => void;
    vi.mocked(api.post).mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    show(); const user = await fill(); await user.click(screen.getByRole('button', { name: 'Criar designação' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledOnce());
    expect(screen.getByLabelText('Local / alcance')).toBeDisabled();
    const event = new Event('sesmt:before-context-change', { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
    await user.click(screen.getByRole('link', { name: 'Voltar' })); expect(screen.queryByText('Lista de designações')).not.toBeInTheDocument();
    await act(async () => { complete({ id: 'created', unitId: 'unit-a' }); });
    expect(await screen.findByText('Designação salva')).toBeInTheDocument();
  });
  it('preserva o preenchimento após erro e ao refazer a consulta de opções', async () => {
    vi.mocked(api.post).mockRejectedValue(new Error('Falha no serviço.'));
    const view = show(); const user = await fill(); await user.click(screen.getByRole('button', { name: 'Criar designação' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Falha no serviço.');
    vi.mocked(api.get).mockRejectedValueOnce(new Error('Falha na consulta.'));
    await act(async () => { await view.client.invalidateQueries({ queryKey: ['permit-options'] }); });
    expect(screen.getByLabelText('Local / alcance')).toHaveValue('Galpão de teste');
    expect(screen.getByRole('checkbox', { name: 'Trabalho em altura' })).toBeChecked();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Criar designação' })).toBeDisabled());
  });
  it('reinicia o formulário em outro contexto e aborta respostas do envio anterior', async () => {
    let complete!: (value: unknown) => void; let signal!: AbortSignal;
    vi.mocked(api.post).mockImplementation((_path, _payload, settings) => { signal = settings!.signal!; return new Promise(resolve => { complete = resolve; }); });
    const view = show(); const user = await fill(); await user.click(screen.getByRole('button', { name: 'Criar designação' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledOnce());
    state.unitId = 'unit-b'; state.sessionKey = 'session-b'; view.update();
    expect(await screen.findByLabelText('Local / alcance')).toHaveValue(''); expect(signal.aborted).toBe(true);
    await act(async () => { complete({ id: 'old-context', unitId: 'unit-a' }); });
    expect(screen.queryByText('Designação salva')).not.toBeInTheDocument();
  });
  it('rejeita serviços removidos do catálogo sem descartar os outros campos e permite corrigir a seleção', async () => {
    const view = show(); const user = await fill();
    vi.mocked(api.get).mockResolvedValue({ ...options, services: [{ ...options.services[0], id: 'new-service', name: 'Inspeção de área' }] });
    await act(async () => { await view.client.invalidateQueries({ queryKey: ['permit-options'] }); });
    await user.click(screen.getByRole('button', { name: 'Criar designação' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/serviço selecionado deixou/); expect(api.post).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Local / alcance')).toHaveValue('Galpão de teste');
    await user.click(screen.getByRole('button', { name: 'Remover serviços indisponíveis' })); await user.click(screen.getByRole('checkbox', { name: 'Inspeção de área' }));
    vi.mocked(api.post).mockResolvedValue({ id: 'created', unitId: 'unit-a' }); await user.click(screen.getByRole('button', { name: 'Criar designação' }));
    expect(await screen.findByText('Designação salva')).toBeInTheDocument();
  });
});

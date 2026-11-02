import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import { ApiError, nativeWorkerProfileApi } from '../../shared/api/client';
import { NativeWorkerProfessionalPage } from './NativeWorkerProfessionalPage';
import { checkedProfessionalContext, checkedProfessionalReceipt } from './professional-profile';
const ids = { worker: '74000000-0000-4000-8000-000000000001', unit: '74000000-0000-4000-8000-000000000002', company: '74000000-0000-4000-8000-000000000003', sector: '74000000-0000-4000-8000-000000000004', position: '74000000-0000-4000-8000-000000000005' };
const state = vi.hoisted(() => ({ grants: ['workers.read','trabalhador:editar'], ownOnly: false }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ sessionKey: 'professional-test', unitId: '74000000-0000-4000-8000-000000000002', me: { scope: { companyIds: ['74000000-0000-4000-8000-000000000003'], unitIds: ['74000000-0000-4000-8000-000000000002'], ownOnly: state.ownOnly } }, can: (permission: string) => state.grants.includes(permission) }) }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), nativeWorkerProfileApi: { context: vi.fn(), update: vi.fn() } }));
const worker = { id: ids.worker, companyId: ids.company, unitId: ids.unit, departmentId: ids.sector, positionId: ids.position, name: 'Pessoa da Equipe', enrollment: 'EX-001', revision: 3 };
const initial = { worker, unitName: 'Unidade da equipe', requiresDepartment: false, departments: [{ id: ids.sector, name: 'Produção' }], positions: [{ id: ids.position, name: 'Operação' }] };
let current = structuredClone(initial);
function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/app/trabalhadores/${ids.worker}/editar`]}><Routes><Route path="/app/trabalhadores/:id/editar" element={<NativeWorkerProfessionalPage/>}/><Route path="/app/trabalhadores/:id" element={<h1>Cadastro profissional salvo</h1>}/></Routes></MemoryRouter></QueryClientProvider>); return client;
}
beforeEach(() => {
  vi.clearAllMocks(); state.grants = ['workers.read','trabalhador:editar']; state.ownOnly = false; current = structuredClone(initial);
  vi.mocked(nativeWorkerProfileApi.context).mockImplementation(async () => structuredClone(current) as never);
  vi.mocked(nativeWorkerProfileApi.update).mockImplementation(async (_id, body) => { const fields = body as Record<string, unknown>; current.worker = { ...current.worker, name: String(fields.name), enrollment: String(fields.enrollment), revision: 4 }; return current.worker as never; });
});
async function edit() {
  await screen.findByLabelText('Nome completo'); fireEvent.change(screen.getByLabelText('Nome completo'), { target: { value: 'Pessoa   Atualizada' } });
  fireEvent.change(screen.getByLabelText('Motivo da alteração'), { target: { value: 'Correção cadastral solicitada' } }); fireEvent.click(screen.getByRole('checkbox', { name: /Confirmo as alterações/ }));
}
it('edita sem solicitar CPF/nascimento e confirma a revisão persistida', async () => {
  const client = show(); await edit(); expect(screen.queryByLabelText(/^CPF|Nascimento/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' })); await screen.findByRole('heading', { name: 'Cadastro profissional salvo' });
  expect(nativeWorkerProfileApi.update).toHaveBeenCalledWith(ids.worker, { name: 'Pessoa Atualizada', enrollment: worker.enrollment, departmentId: ids.sector, positionId: ids.position, reason: 'Correção cadastral solicitada', expectedRevision: 3, confirmation: true }, expect.any(AbortSignal));
  expect(JSON.stringify(client.getQueryCache().getAll().map(query => query.state.data))).not.toContain('dateOfBirth');
});
it('somente leitura e vínculo próprio não abrem o contexto de escrita', () => {
  state.ownOnly = true; show(); expect(nativeWorkerProfileApi.context).not.toHaveBeenCalled(); expect(screen.queryByLabelText('Nome completo')).not.toBeInTheDocument();
});
it('exige confirmação novamente ao mudar um campo', async () => {
  show(); await edit(); expect(screen.getByRole('button', { name: 'Salvar alterações' })).toBeEnabled();
  fireEvent.change(screen.getByLabelText('Matrícula'), { target: { value: 'EX-002' } }); expect(screen.getByRole('checkbox')).not.toBeChecked(); expect(screen.getByRole('button', { name: 'Salvar alterações' })).toBeDisabled();
});
it('não envia uma revisão antiga e conserva o preenchimento', async () => {
  show(); await edit(); current.worker.revision = 4; fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('cadastro mudou'); expect(nativeWorkerProfileApi.update).not.toHaveBeenCalled(); expect(screen.getByLabelText('Nome completo')).toHaveValue('Pessoa   Atualizada'); expect(screen.getByRole('button', { name: 'Salvar alterações' })).toBeDisabled();
});
it('permite corrigir matrícula duplicada sem descartar outros campos', async () => {
  show(); await edit(); vi.mocked(nativeWorkerProfileApi.update).mockRejectedValue(new ApiError(409, { code: 'DUPLICATE_ENROLLMENT', message: 'privado', requestId: 'qa' }));
  fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' })); expect(await screen.findByRole('alert')).toHaveTextContent('matrícula já está em uso'); expect(screen.getByRole('button', { name: 'Salvar alterações' })).toBeEnabled();
});
it('bloqueia repetição quando o resultado da gravação é ambíguo', async () => {
  show(); await edit(); vi.mocked(nativeWorkerProfileApi.update).mockRejectedValue(new TypeError('Failed to fetch'));
  fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' })); expect(await screen.findByRole('alert')).toHaveTextContent('Consulte a lista atualizada'); expect(screen.getByRole('button', { name: 'Salvar alterações' })).toBeDisabled(); expect(nativeWorkerProfileApi.update).toHaveBeenCalledTimes(1);
});
it('não confirma sucesso com um recibo de outra revisão', async () => {
  show(); await edit(); vi.mocked(nativeWorkerProfileApi.update).mockResolvedValue({ ...worker, name: 'Pessoa Atualizada', revision: 9 } as never);
  fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' })); expect(await screen.findByRole('alert')).toHaveTextContent('resposta não confirmou'); expect(screen.queryByRole('heading', { name: 'Cadastro profissional salvo' })).not.toBeInTheDocument();
});
it('um cargo e setor completos são exigidos quando o vínculo muda', async () => {
  show(); await edit(); fireEvent.change(screen.getByLabelText('Cargo'), { target: { value: '' } }); fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' })); expect(await screen.findByRole('alert')).toHaveTextContent('Selecione cargo e setor'); expect(nativeWorkerProfileApi.update).not.toHaveBeenCalled();
});
it('campos extras pessoais não entram no contexto validado', () => {
  const checked = checkedProfessionalContext({ ...initial, worker: { ...worker, cpf: 'private', dateOfBirth: '1990-01-01' } }, { id: ids.worker, unitId: ids.unit, companyIds: [ids.company] });
  expect(JSON.stringify(checked)).not.toContain('private'); expect(JSON.stringify(checked)).not.toContain('dateOfBirth');
});
it.each([{ ...initial, worker: { ...worker, unitId: ids.company } }, { ...initial, departments: [initial.departments[0],initial.departments[0]] }, { ...initial, worker: { ...worker, revision: null } }])('recusa contextos incompatíveis %j', value => {
  expect(() => checkedProfessionalContext(value, { id: ids.worker, unitId: ids.unit, companyIds: [ids.company] })).toThrow();
});
it('recusa um recibo que tenta trocar a empresa do cadastro', () => {
  expect(() => checkedProfessionalReceipt({ ...worker, revision: 4, companyId: ids.unit }, worker, { ...worker, reason: 'Motivo' })).toThrow();
});

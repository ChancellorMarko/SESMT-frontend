import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, type RequestOptions } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { AssigneeDto, DocumentTypeDto, DocumentWriteDto, OrganizationDto, WorkerDto } from '../../shared/contracts';
import { DocumentMetadataForm } from './DocumentMetadataForm';

vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn() } }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: vi.fn() }));
const id = (group: number, number: number) => `${String(group).padStart(8, '0')}-0000-4000-8000-${String(number + 1).padStart(12, '0')}`;
const companyId = id(1, 0);
const unitId = id(1, 1);
const otherUnitId = id(1, 2);
const types: DocumentTypeDto[] = Array.from({ length: 125 }, (_, index) => ({ id: id(2, index), code: `DOC-${index}`, name: `Tipo documental ${index}`, category: 'SST', requiredFields: [], allowedAccessClasses: ['INTERNAL', 'RESTRICTED'], defaultAccessClass: 'INTERNAL', allowedMimeTypes: ['application/pdf'], maxFileSizeBytes: 1024 * 1024, renewalPolicy: { enabled: false, noticeDays: 30 }, retentionPolicyReference: { code: 'REF', version: '1', source: 'test' }, workflow: { reviewRequired: false, signatureRequired: false, allowSelfApproval: false, allowMultipleActiveVersions: false }, revision: 1 }));
const owners: AssigneeDto[] = Array.from({ length: 125 }, (_, index) => ({ id: id(3, index), displayName: `Proprietário ${index}` }));
const responsible: AssigneeDto[] = Array.from({ length: 125 }, (_, index) => ({ id: id(4, index), displayName: `Responsável ${index}` }));
const workers: WorkerDto[] = Array.from({ length: 125 }, (_, index) => ({ id: id(5, index), fullName: `Trabalhador ${index}`, registration: String(index), companyId, unitId, sectorId: id(1, 3), employmentType: 'CLT', admissionDate: '2024-01-01', status: 'ACTIVE', revision: 1 }));
const initial: DocumentWriteDto = { code: 'DOC-TESTE', title: 'Documento em preenchimento', typeId: types[124].id, companyId, unitId, ownerId: owners[124].id, responsibleIds: [responsible[123].id], workerIds: [workers[124].id], accessClass: 'INTERNAL', issueDate: '2026-10-05', keywords: [] };
type Source = 'organization' | 'types' | 'owners' | 'responsible' | 'workers';
let failed: Source | undefined;
let removed: Set<string>;
let organization: OrganizationDto;
let canReadWorkers: boolean;
let requiredTypeFields: Map<string, DocumentTypeDto['requiredFields']>;

beforeEach(() => {
  vi.clearAllMocks(); failed = undefined; removed = new Set(); canReadWorkers = true; requiredTypeFields = new Map();
  organization = { companies: [{ id: companyId, name: 'Empresa autorizada', status: 'ACTIVE', revision: 1 }], units: [{ id: unitId, companyId, name: 'Unidade inicial', status: 'ACTIVE', revision: 1 }, { id: otherUnitId, companyId, name: 'Outra unidade', status: 'ACTIVE', revision: 1 }], sectors: [], establishments: [], jobs: [], jobFunctions: [], workCenters: [] };
  vi.mocked(useSession).mockImplementation(() => ({ me: null, unitId, sessionKey: 'document-metadata-test', can: permission => permission === 'documents.write' || permission === 'workers.read' && canReadWorkers, status: 'authenticated', sessionError: null, setUnitId: vi.fn(), login: vi.fn(), verifyMfa: vi.fn(), logout: vi.fn(), restore: vi.fn(), reloadIdentity: vi.fn() }));
  vi.mocked(api.get).mockImplementation(async <T,>(path: string, options?: RequestOptions): Promise<T> => {
    const query = options?.query ?? {};
    const source: Source = path === '/organization' ? 'organization' : path === '/document-types' ? 'types' : path === '/workers' ? 'workers' : query.purpose === 'DOCUMENT_OWNER' ? 'owners' : 'responsible';
    if (failed === source) throw new ApiError(403, { code: 'FORBIDDEN', message: 'Acesso às opções revogado.', requestId: 'test' });
    if (source === 'organization') return structuredClone(organization) as T;
    const all: { id: string; name?: string; fullName?: string; displayName?: string }[] = source === 'types' ? types.map(type => ({ ...type, requiredFields: requiredTypeFields.get(type.id) ?? type.requiredFields })) : source === 'workers' ? workers : source === 'owners' ? owners : responsible;
    const selected = String(query.ids ?? '').split(',').filter(Boolean);
    const term = String(query.q ?? '').toLowerCase();
    const filtered = all.filter(item => !removed.has(item.id) && (!selected.length || selected.includes(item.id)) && (!term || String(item.name ?? item.fullName ?? item.displayName).toLowerCase().includes(term)));
    const page = Number(query.page ?? 1), pageSize = Number(query.pageSize ?? 20);
    return { items: filtered.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: filtered.length } as T;
  });
});

async function show() {
  const onSave = vi.fn(async (_values: DocumentWriteDto) => {});
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  render(<QueryClientProvider client={client}><MemoryRouter><DocumentMetadataForm initial={initial} pending={false} submitLabel="Salvar documento" onSave={onSave} /></MemoryRouter></QueryClientProvider>);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar documento' })).toBeEnabled());
  return { client, onSave };
}
const selectedValues = (label: string) => [...(screen.getByLabelText(label) as HTMLSelectElement).selectedOptions].map(option => option.value);

describe('opções e vínculos do formulário documental', () => {
  it('anuncia as exigências do tipo e as atualiza sem apagar o preenchimento ou os vínculos', async () => {
    requiredTypeFields.set(types[124].id, ['sectorId', 'validFrom', 'validUntil', 'keywords', 'responsibleIds', 'workerIds']);
    organization.sectors.push({ id: id(1, 3), unitId, name: 'Setor disponível', status: 'ACTIVE', revision: 1 });
    const user = userEvent.setup();
    const { onSave } = await show();
    const sector = screen.getByRole('combobox', { name: /^Setor/ });
    const validFrom = screen.getByLabelText(/^Início da validade/);
    const validUntil = screen.getByLabelText(/^Fim da validade/);
    const keywords = screen.getByRole('textbox', { name: /^Palavras-chave/ });
    const responsibleSelect = screen.getByRole('listbox', { name: /^Responsáveis/ });
    const workerSelect = screen.getByRole('listbox', { name: /^Trabalhadores vinculados/ });
    const dynamicFields = [sector, validFrom, validUntil, keywords, responsibleSelect, workerSelect];
    await waitFor(() => dynamicFields.forEach(field => expect(field).toHaveAttribute('aria-required', 'true')));
    dynamicFields.forEach(field => expect(field).not.toHaveAttribute('required'));
    expect(screen.getByLabelText('Buscar responsáveis')).not.toHaveAttribute('aria-required', 'true');
    expect(screen.getByLabelText('Buscar trabalhadores')).not.toHaveAttribute('aria-required', 'true');
    await user.selectOptions(sector, id(1, 3));
    fireEvent.change(validFrom, { target: { value: '2026-10-01' } });
    fireEvent.change(validUntil, { target: { value: '2027-10-01' } });
    await user.type(keywords, 'registro, preservado');
    await user.selectOptions(screen.getByLabelText('Tipo documental *'), types[0].id);
    await waitFor(() => dynamicFields.forEach(field => expect(field).not.toHaveAttribute('aria-required', 'true')));
    expect(sector).toHaveValue(id(1, 3));
    expect(validFrom).toHaveValue('2026-10-01');
    expect(validUntil).toHaveValue('2027-10-01');
    expect(keywords).toHaveValue('registro, preservado');
    expect([...(responsibleSelect as HTMLSelectElement).selectedOptions].map(option => option.value)).toEqual(initial.responsibleIds);
    expect([...(workerSelect as HTMLSelectElement).selectedOptions].map(option => option.value)).toEqual(initial.workerIds);
    expect(screen.getByLabelText('Título *')).toHaveAttribute('aria-required', 'true');
    await user.click(screen.getByRole('button', { name: 'Salvar documento' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ typeId: types[0].id, sectorId: id(1, 3), validFrom: '2026-10-01', validUntil: '2027-10-01', keywords: ['registro', 'preservado'], responsibleIds: initial.responsibleIds, workerIds: initial.workerIds })));
  });

  it('hidrata seleções além do item 100 e mantém trabalhadores selecionados entre páginas e buscas', async () => {
    const user = userEvent.setup();
    const { onSave } = await show();
    expect(screen.getByLabelText('Tipo documental *')).toHaveValue(types[124].id);
    expect(screen.getByLabelText('Proprietário *')).toHaveValue(owners[124].id);
    expect(selectedValues('Responsáveis')).toEqual([responsible[123].id]);
    expect(selectedValues('Trabalhadores vinculados')).toEqual([workers[124].id]);
    await user.selectOptions(screen.getByLabelText('Trabalhadores vinculados'), workers[0].id);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar documento' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Próxima: trabalhadores' }));
    await waitFor(() => expect(within(screen.getByLabelText('Trabalhadores vinculados')).getByRole('option', { name: 'Trabalhador 20 · 20' })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText('Trabalhadores vinculados'), workers[20].id);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar documento' })).toBeEnabled());
    await user.type(screen.getByLabelText('Buscar trabalhadores'), 'Trabalhador 100');
    await user.click(screen.getByRole('button', { name: 'Pesquisar trabalhadores' }));
    await waitFor(() => expect(within(screen.getByLabelText('Trabalhadores vinculados')).getByRole('option', { name: 'Trabalhador 100 · 100' })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText('Trabalhadores vinculados'), workers[100].id);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar documento' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Salvar documento' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ typeId: types[124].id, ownerId: owners[124].id, responsibleIds: [responsible[123].id], workerIds: expect.arrayContaining([workers[124].id, workers[0].id, workers[20].id, workers[100].id]) })));
    expect(onSave.mock.calls[0][0].workerIds).toHaveLength(4);
    expect(api.get).toHaveBeenCalledWith('/workers', expect.objectContaining({ query: expect.objectContaining({ ids: workers[124].id, pageSize: 100 }) }));
    expect(api.get).toHaveBeenCalledWith('/workers', expect.objectContaining({ query: expect.objectContaining({ q: 'Trabalhador 100', page: 1, pageSize: 20 }) }));
  });

  it('busca e escolhe um tipo documental além da primeira centena sem perder os vínculos atuais', async () => {
    const user = userEvent.setup();
    const { onSave } = await show();
    await user.type(screen.getByLabelText('Buscar tipos documentais'), 'Tipo documental 100');
    await user.click(screen.getByRole('button', { name: 'Pesquisar tipos documentais' }));
    await waitFor(() => expect(within(screen.getByLabelText('Tipo documental *')).getByRole('option', { name: 'Tipo documental 100' })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText('Tipo documental *'), types[100].id);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar documento' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Salvar documento' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ typeId: types[100].id, ownerId: initial.ownerId, responsibleIds: initial.responsibleIds, workerIds: initial.workerIds })));
  });

  it.each(['organization', 'types', 'owners', 'workers'] as const)('esconde opções após 403 em %s, mantém o preenchimento e recupera por retry', async source => {
    const user = userEvent.setup();
    const { onSave } = await show();
    await user.clear(screen.getByLabelText('Título *'));
    await user.type(screen.getByLabelText('Título *'), 'Meu preenchimento preservado');
    failed = source;
    await user.click(screen.getByRole('button', { name: 'Atualizar opções do formulário' }));
    await screen.findByText(/Não foi possível verificar as opções/);
    const label = source === 'organization' ? 'Empresa *' : source === 'types' ? 'Tipo documental *' : source === 'owners' ? 'Proprietário *' : 'Trabalhadores vinculados';
    const hiddenName = source === 'organization' ? 'Empresa autorizada' : source === 'types' ? 'Tipo documental 124' : source === 'owners' ? 'Proprietário 124' : 'Trabalhador 124 · 124';
    expect(within(screen.getByLabelText(label)).queryByRole('option', { name: hiddenName })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Título *')).toHaveValue('Meu preenchimento preservado');
    expect(screen.getByRole('button', { name: 'Salvar documento' })).toBeDisabled();
    expect(onSave).not.toHaveBeenCalled();
    failed = undefined;
    await user.click(screen.getByRole('button', { name: 'Atualizar opções do formulário' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar documento' })).toBeEnabled());
    expect(screen.getByLabelText('Proprietário *')).toHaveValue(initial.ownerId);
    expect(selectedValues('Trabalhadores vinculados')).toEqual(initial.workerIds);
    await user.click(screen.getByRole('button', { name: 'Salvar documento' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ title: 'Meu preenchimento preservado', ownerId: initial.ownerId, workerIds: initial.workerIds })));
  });

  it('exige revisão explícita de trabalhador removido e só grava depois de removê-lo da seleção', async () => {
    const user = userEvent.setup();
    const { onSave } = await show();
    removed.add(workers[124].id);
    await user.click(screen.getByRole('button', { name: 'Atualizar opções do formulário' }));
    const remove = await screen.findByRole('button', { name: `Remover ${workers[124].id}` });
    await waitFor(() => expect(remove).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Salvar documento' })).toBeDisabled();
    expect(selectedValues('Trabalhadores vinculados')).toEqual(initial.workerIds);
    expect(onSave).not.toHaveBeenCalled();
    await user.click(remove);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar documento' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Salvar documento' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ workerIds: [] })));
  });

  it('recusa unidade que se tornou inativa durante o preenchimento', async () => {
    const user = userEvent.setup();
    const { onSave } = await show();
    organization.units[0].status = 'INACTIVE';
    await user.click(screen.getByRole('button', { name: 'Atualizar opções do formulário' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar documento' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Salvar documento' }));
    expect(await screen.findByText('Selecione uma unidade ativa da empresa.')).toBeVisible();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('preserva IDs sem consultar trabalhadores quando falta leitura e impede transferir vínculos ocultos', async () => {
    canReadWorkers = false;
    const user = userEvent.setup();
    const { onSave } = await show();
    expect(screen.queryByLabelText('Trabalhadores vinculados')).not.toBeInTheDocument();
    expect(vi.mocked(api.get).mock.calls.some(([path]) => path === '/workers')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Salvar documento' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ workerIds: initial.workerIds })));
    await user.selectOptions(screen.getByLabelText('Unidade *'), otherUnitId);
    await waitFor(() => expect(within(screen.getByLabelText('Proprietário *')).getByRole('option', { name: 'Proprietário 0' })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText('Proprietário *'), owners[0].id);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar documento' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Salvar documento' }));
    expect(await screen.findByText('A mudança de unidade exige a revisão dos vínculos por um perfil com acesso aos trabalhadores.')).toBeVisible();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.get).mock.calls.some(([path]) => path === '/workers')).toBe(false);
  });
});

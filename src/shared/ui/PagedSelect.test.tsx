import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../api/client';
import { usePagedLookup } from '../lib/use-paged-lookup';
import { PagedSelect } from './PagedSelect';

vi.mock('../api/client', async original => ({ ...await original<typeof import('../api/client')>(), api: { get: vi.fn() } }));
type Person = { id: string; name: string };
const id = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const people = Array.from({ length: 121 }, (_, index) => ({ id: id(index + 1), name: `Pessoa ${String(index + 1).padStart(3, '0')}` }));
let forbidden = false;
function pageResponse(options?: Parameters<typeof api.get>[1]) {
  const query = options?.query ?? {};
  let items = query.unitId === 'unit-b' ? [{ id: id(201), name: 'Pessoa da outra unidade' }] : people;
  if (query.ids) items = items.filter(item => String(query.ids).split(',').includes(item.id));
  if (query.q) items = items.filter(item => item.name.toLowerCase().includes(String(query.q).toLowerCase()));
  const page = Number(query.page || 1), pageSize = Number(query.pageSize || 20);
  return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, pageSize };
}
beforeEach(() => {
  vi.clearAllMocks(); forbidden = false;
  vi.mocked(api.get).mockImplementation(async (_path, options) => {
    if (forbidden) throw new ApiError(403, { code: 'FORBIDDEN', message: 'Permissão alterada.', requestId: 'lookup-test' });
    return pageResponse(options);
  });
});
function Harness({ initial = [id(101)], submit = vi.fn() }: { initial?: string[]; submit?: () => void }) {
  const [unit, setUnit] = useState('unit-a');
  const [selected, setSelected] = useState(initial);
  const lookup = usePagedLookup<Person>({ queryKey: ['lookup-test', 'session', unit], path: '/people', query: { unitId: unit }, selectedIds: selected });
  return <><form onSubmit={event => { event.preventDefault(); submit(); }}>
    <PagedSelect lookup={lookup} label="Pessoas vinculadas" noun="pessoas" value={selected} onChange={value => setSelected(value as string[])} getLabel={person => person.name} multiple />
    <output aria-label="Valores preservados">{JSON.stringify(selected)}</output>
    <output aria-label="Seleção conferida">{String(lookup.verified)}</output>
  </form><button onClick={() => setUnit('unit-b')}>Trocar unidade</button><button onClick={() => lookup.setPage(1)}>Abrir página já armazenada</button></>;
}
function show(element = <Harness />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  render(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
  return client;
}

describe('opções pesquisáveis e paginadas', () => {
  it('resolve item 101 sem baixar todas as páginas e conserva seleções ao pesquisar e paginar', async () => {
    const submit = vi.fn(); const user = userEvent.setup(); show(<Harness submit={submit} />);
    await waitFor(() => expect(screen.getByLabelText('Seleção conferida')).toHaveTextContent('true'));
    expect(screen.getByRole('option', { name: 'Pessoa 101' })).toBeInTheDocument();
    expect(vi.mocked(api.get).mock.calls).toHaveLength(2);
    expect(vi.mocked(api.get).mock.calls.map(([, options]) => options?.query?.page)).toEqual([1, 1]);
    await user.selectOptions(screen.getByRole('listbox', { name: 'Pessoas vinculadas' }), id(2));
    await waitFor(() => expect(screen.getByLabelText('Seleção conferida')).toHaveTextContent('true'));
    await user.click(screen.getByRole('button', { name: 'Próxima: pessoas' }));
    await screen.findByRole('option', { name: 'Pessoa 021' });
    expect(screen.getByRole('option', { name: 'Pessoa 101' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Pessoa 002' })).toBeInTheDocument();
    await user.type(screen.getByRole('searchbox', { name: 'Buscar pessoas' }), 'Pessoa 121{Enter}');
    await screen.findByRole('option', { name: 'Pessoa 121' });
    expect(submit).not.toHaveBeenCalled();
    expect(api.get).toHaveBeenCalledWith('/people', expect.objectContaining({ query: expect.objectContaining({ q: 'Pessoa 121', page: 1, pageSize: 20 }) }));
    await user.selectOptions(screen.getByRole('listbox', { name: 'Pessoas vinculadas' }), id(121));
    expect(JSON.parse(screen.getByLabelText('Valores preservados').textContent!)).toEqual(expect.arrayContaining([id(101), id(2), id(121)]));
    await waitFor(() => expect(screen.getByLabelText('Seleção conferida')).toHaveTextContent('true'));
    await user.click(screen.getByRole('button', { name: 'Remover Pessoa 002' }));
    expect(JSON.parse(screen.getByLabelText('Valores preservados').textContent!)).toEqual(expect.arrayContaining([id(101), id(121)]));
    expect(screen.getByLabelText('Valores preservados')).not.toHaveTextContent(id(2));
  });

  it('retira nomes em cache após negativa de acesso e recupera os mesmos valores com retry', async () => {
    const user = userEvent.setup(); const client = show();
    await waitFor(() => expect(screen.getByLabelText('Seleção conferida')).toHaveTextContent('true'));
    forbidden = true;
    await act(async () => { await client.invalidateQueries({ queryKey: ['lookup-test', 'session', 'unit-a'] }); });
    await screen.findByRole('button', { name: 'Tentar carregar pessoas novamente' });
    expect(screen.queryByRole('option', { name: 'Pessoa 101' })).not.toBeInTheDocument();
    expect(screen.queryByText('Pessoa 101', { exact: true })).not.toBeInTheDocument();
    expect(screen.getByRole('listbox')).toHaveValue([id(101)]);
    expect(screen.getByLabelText('Seleção conferida')).toHaveTextContent('false');
    forbidden = false;
    await user.click(screen.getByRole('button', { name: 'Tentar carregar pessoas novamente' }));
    await waitFor(() => expect(screen.getByLabelText('Seleção conferida')).toHaveTextContent('true'));
    expect(screen.getByRole('option', { name: 'Pessoa 101' })).toBeInTheDocument();
    expect(screen.getByRole('listbox')).toHaveValue([id(101)]);
  });

  it('cancela busca antiga e inicia a nova unidade na primeira página sem reaproveitar nomes', async () => {
    const original = vi.mocked(api.get).getMockImplementation()!;
    let finish!: () => void; let oldSignal: AbortSignal | undefined;
    vi.mocked(api.get).mockImplementation(async (path, options) => {
      if (options?.query?.q === 'Pessoa 121') return new Promise(resolve => {
        oldSignal = options.signal;
        finish = () => resolve(pageResponse(options));
      });
      return original(path, options);
    });
    const user = userEvent.setup(); show(<Harness initial={[]} />);
    await screen.findByRole('option', { name: 'Pessoa 001' });
    await user.click(screen.getByRole('button', { name: 'Próxima: pessoas' }));
    await screen.findByRole('option', { name: 'Pessoa 021' });
    await user.type(screen.getByRole('searchbox', { name: 'Buscar pessoas' }), 'Pessoa 121{Enter}');
    await waitFor(() => expect(oldSignal).toBeDefined());
    await user.click(screen.getByRole('button', { name: 'Trocar unidade' }));
    await screen.findByRole('option', { name: 'Pessoa da outra unidade' });
    expect(oldSignal?.aborted).toBe(true);
    await act(async () => { finish(); });
    expect(screen.queryByRole('option', { name: 'Pessoa 121' })).not.toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/people', expect.objectContaining({ query: expect.objectContaining({ unitId: 'unit-b', page: 1, q: undefined }) }));
  });

  it('resolve mais de 100 selecionados em lotes autorizados de no máximo 100 IDs', async () => {
    function Probe() {
      const lookup = usePagedLookup<Person>({ queryKey: ['many', 'session'], path: '/people', selectedIds: people.map(person => person.id) });
      return <output aria-label="Resolvidos">{lookup.verified && lookup.selectedItems.length}</output>;
    }
    show(<Probe />);
    await waitFor(() => expect(screen.getByLabelText('Resolvidos')).toHaveTextContent('121'));
    const batches = vi.mocked(api.get).mock.calls.map(([, options]) => options?.query?.ids).filter(Boolean).map(value => String(value).split(','));
    expect(batches.map(batch => batch.length)).toEqual([100, 21]);
    expect(vi.mocked(api.get).mock.calls).toHaveLength(3);
  });

  it('mantém IDs de registros removidos explícitos, sem inventar nome ou conferir a seleção', async () => {
    show(<Harness initial={[id(999)]} />);
    expect(await screen.findByText('Alguns itens selecionados não estão disponíveis neste contexto. Confira os vínculos antes de salvar.')).toBeVisible();
    expect(screen.getByRole('listbox')).toHaveValue([id(999)]);
    expect(screen.getByLabelText('Seleção conferida')).toHaveTextContent('false');
    expect(screen.getByRole('option', { name: `Selecionado; identificação indisponível: ${id(999)}` })).toBeInTheDocument();
  });

  it('não recupera páginas em cache após 403 nem ao remontar, até uma nova verificação bem-sucedida', async () => {
    const user = userEvent.setup(); const client = show(<Harness initial={[]} />);
    await screen.findByRole('option', { name: 'Pessoa 001' });
    forbidden = true;
    await user.click(screen.getByRole('button', { name: 'Próxima: pessoas' }));
    await screen.findByRole('button', { name: 'Tentar carregar pessoas novamente' });
    expect(screen.getByRole('button', { name: 'Anterior: pessoas' })).toBeDisabled();
    const before = vi.mocked(api.get).mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'Abrir página já armazenada' }));
    expect(screen.queryByRole('option', { name: 'Pessoa 001' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Seleção conferida')).toHaveTextContent('false');
    cleanup();
    render(<QueryClientProvider client={client}><Harness initial={[]} /></QueryClientProvider>);
    expect(screen.queryByRole('option', { name: 'Pessoa 001' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Seleção conferida')).toHaveTextContent('false');
    expect(vi.mocked(api.get).mock.calls).toHaveLength(before);
    forbidden = false;
    await user.click(screen.getByRole('button', { name: 'Tentar carregar pessoas novamente' }));
    expect(await screen.findByRole('option', { name: 'Pessoa 001' })).toBeInTheDocument();
    expect(screen.getByLabelText('Seleção conferida')).toHaveTextContent('true');
  });
});

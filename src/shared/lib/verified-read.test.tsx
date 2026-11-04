import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import { InvalidReadResponse, useVerifiedRead } from './verified-read';

describe('consulta validada após negativa de acesso', () => {
  it('não restaura página pelo cache, exigindo uma nova resposta válida do serviço', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const key = (page: number) => ['checked-test', 'session-a', 'unit-a', page];
    client.setQueryData(key(1), { id: 'row-1' }); client.setQueryData(key(2), { id: 'row-2' });
    let denied = true;
    function Harness() {
      const [page, setPage] = useState(1);
      const query = useVerifiedRead({ queryKey: key(page), scope: key(page).slice(0, 3), enabled: true,
        request: async () => { if (denied) throw new ApiError(403, { code: 'FORBIDDEN', message: 'Acesso revogado.', requestId: 'test' }); return { id: `fresh-${page}` }; },
        validate: (value: unknown) => { if (!value || typeof value !== 'object' || !('id' in value) || typeof value.id !== 'string') throw new InvalidReadResponse(); return value as { id: string }; } });
      return <><button onClick={() => void query.refetch()}>Atualizar</button><button onClick={() => setPage(2)}>Outra página</button>{query.isError && <p role="alert">Leitura bloqueada</p>}{query.data && <p>{query.data.id}</p>}</>;
    }
    render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>);
    expect(await screen.findByText('row-1')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar' }));
    await screen.findByRole('alert');
    expect(screen.queryByText('row-1')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Outra página' }));
    expect(screen.queryByText('row-2')).not.toBeInTheDocument();
    act(() => client.setQueryData(key(2), { id: 'old-cache-inserted' }));
    expect(screen.queryByText('old-cache-inserted')).not.toBeInTheDocument();
    denied = false; fireEvent.click(screen.getByRole('button', { name: 'Atualizar' }));
    await screen.findByText('fresh-2');
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});

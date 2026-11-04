import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { describe, expect, it } from 'vitest';
import { AppQueryNavigationProvider, useAppQueryParams } from './app-query-params';

function QueryProbe() {
  const [params, setParams] = useAppQueryParams();
  const location = useLocation(), navigate = useNavigate();
  return <>
    <output aria-label="Location">{JSON.stringify({ pathname: location.pathname, search: location.search, hash: location.hash, state: location.state, tags: params.getAll('tag') })}</output>
    <button onClick={() => setParams(previous => {
      const next = new URLSearchParams(previous); next.append('tag', 'three'); next.set('q', 'filtered'); return next;
    }, { flushSync: true, state: { origin: 'applied' } })}>Apply</button>
    <button onClick={() => setParams(previous => {
      const next = new URLSearchParams(previous); next.set('q', 'replaced'); return next;
    }, { replace: true, flushSync: true, state: { origin: 'replaced' } })}>Replace</button>
    <button onClick={() => setParams(undefined, { flushSync: true })}>Clear</button>
    <button onClick={() => navigate(-1)}>Back</button>
  </>;
}

function show(provided: boolean) {
  const initialEntries = ['/sentinel', '/items?tag=one&tag=two#details'];
  if (!provided) return { ...render(<MemoryRouter initialEntries={initialEntries} initialIndex={1}><QueryProbe /></MemoryRouter>), dispose: () => {} };
  const router = createMemoryRouter([{ path: '*', element: <AppQueryNavigationProvider><Routes><Route path="*" element={<QueryProbe />} /></Routes></AppQueryNavigationProvider> }], { initialEntries, initialIndex: 1 });
  return { ...render(<RouterProvider router={router} />), dispose: () => router.dispose() };
}

function current() { return JSON.parse(screen.getByLabelText('Location').textContent!); }

describe.each([true, false])('query navigation with root provider=%s', provided => {
  it('preserves duplicate values, functional setters, state and push/replace history', async () => {
    const view = show(provided);
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
      await waitFor(() => expect(current()).toMatchObject({ pathname: '/items', hash: '', state: { origin: 'applied' }, tags: ['one', 'two', 'three'] }));
      expect(new URLSearchParams(current().search).get('q')).toBe('filtered');
      fireEvent.click(screen.getByRole('button', { name: 'Replace' }));
      await waitFor(() => expect(current().state).toEqual({ origin: 'replaced' }));
      expect(new URLSearchParams(current().search).get('q')).toBe('replaced');
      fireEvent.click(screen.getByRole('button', { name: 'Back' }));
      await waitFor(() => expect(current()).toMatchObject({ pathname: '/items', search: '?tag=one&tag=two', hash: '#details', state: null }));
      fireEvent.click(screen.getByRole('button', { name: 'Back' }));
      await waitFor(() => expect(current().pathname).toBe('/sentinel'));
    } finally { view.unmount(); view.dispose(); }
  });

  it('clears parameters, state and fragment like the original setter without defaults', async () => {
    const view = show(provided);
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
      await waitFor(() => expect(current().state).toEqual({ origin: 'applied' }));
      fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
      await waitFor(() => expect(current()).toEqual({ pathname: '/items', search: '', hash: '', state: null, tags: [] }));
    } finally { view.unmount(); view.dispose(); }
  });
});

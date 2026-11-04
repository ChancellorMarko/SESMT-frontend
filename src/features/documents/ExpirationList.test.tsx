import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import type { DocumentDto } from '../../shared/contracts';
import { ExpirationList } from './ExpirationList';

function document(overrides: Partial<DocumentDto> = {}): DocumentDto {
  return {
    id: 'doc-1', code: 'DOC-001', title: 'Relatório de inspeção', companyId: 'company-a', unitId: 'unit-a',
    typeId: 'type-a', ownerId: 'owner-a', accessClass: 'INTERNAL', issueDate: '2026-01-01',
    validUntil: '2026-10-18', status: 'ACTIVE', activeVersionIds: [], availableActions: [],
    revision: 1, workerIds: [], responsibleIds: [], keywords: [], ...overrides,
  };
}

function LocationState() {
  const location = useLocation();
  return <output aria-label="Contexto do documento">{JSON.stringify(location.state)}</output>;
}

function show(documents: DocumentDto[], documentState?: unknown) {
  return render(<MemoryRouter initialEntries={['/app/vencimentos']}><Routes>
    <Route path="/app/vencimentos" element={<ExpirationList documents={documents} today="2026-10-18" documentState={documentState} />} />
    <Route path="/app/documentos/:id" element={<LocationState />} />
  </Routes></MemoryRouter>);
}

describe('lista de vencimentos', () => {
  it('mantém uma tabela semântica com colunas e um único link por documento', () => {
    show([document(), document({ id: 'doc-2', title: 'Programa de gerenciamento de riscos', code: 'PGR-002' })]);
    const region = screen.getByRole('region', { name: 'Tabela de vencimentos' });
    const table = within(region).getByRole('table', { name: 'Documentos da consulta de vencimentos' });
    expect(within(table).getAllByRole('columnheader').map(header => header.textContent)).toEqual(['Documento', 'Situação', 'Vencimento', 'Prazo']);
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(within(table).getAllByRole('link')).toHaveLength(2);
    expect(within(table).getByText('PGR-002')).toBeVisible();
  });

  it('conta os dias civis e preserva a situação informada mesmo quando difere do prazo', () => {
    show([
      document({ id: 'past-active', title: 'Vigente com data passada', validUntil: '2026-10-16' }),
      document({ id: 'future-expired', title: 'Vencido informado pelo serviço', status: 'EXPIRED', validUntil: '2026-10-20' }),
      document({ id: 'today', title: 'Vence no dia corrente' }),
      document({ id: 'missing', title: 'Data não fornecida', validUntil: undefined }),
    ]);
    const past = screen.getByRole('link', { name: 'Vigente com data passada' }).closest('tr')!;
    expect(within(past).getByText('Vigente')).toBeVisible();
    expect(within(past).getByText('Há 2 dia(s)')).toBeVisible();
    expect(within(past).getByText('16/10/2026')).toBeVisible();
    const future = screen.getByRole('link', { name: 'Vencido informado pelo serviço' }).closest('tr')!;
    expect(within(future).getByText('Vencido')).toBeVisible();
    expect(within(future).getByText('Em 2 dia(s)')).toBeVisible();
    expect(screen.getByText('Vence hoje')).toBeVisible();
    expect(screen.getByText('Sem data informada')).toBeVisible();
    expect(screen.getByText('Não informado')).toBeVisible();
  });

  it('codifica o identificador e entrega o contexto original à consulta do documento', () => {
    const state = { expirationReturnTo: { unitId: 'unit-a', search: '?unitId=unit-a&view=expired&q=DOC' } };
    show([document({ id: 'documento/especial #1' })], state);
    const link = screen.getByRole('link', { name: 'Relatório de inspeção' });
    expect(link).toHaveAttribute('href', '/app/documentos/documento%2Fespecial%20%231');
    fireEvent.click(link);
    expect(screen.getByLabelText('Contexto do documento')).toHaveTextContent(JSON.stringify(state));
  });
});

import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { DashboardDto } from '../../shared/contracts';
import { DocumentPendingList } from './DocumentPendingList';

type PendingItem = DashboardDto['pendingItems'][number];

function pending(overrides: Partial<PendingItem> = {}): PendingItem {
  return { id: 'pending-1', title: 'Relatório de inspeção', resourceType: 'DOCUMENT', resourceId: 'doc-1', status: 'EXPIRED', dueDate: '2026-10-18', ...overrides };
}

function show(items: PendingItem[], canReadDocuments = true) {
  return render(<MemoryRouter><DocumentPendingList items={items} canReadDocuments={canReadDocuments} /></MemoryRouter>);
}

describe('pendências documentais do painel', () => {
  it('mantém uma única tabela acessível com colunas e células associadas a cada pendência', () => {
    show([pending(), pending({ id: 'pending-2', title: 'Programa de gerenciamento de riscos', resourceId: 'doc-2', dueDate: undefined })]);
    const table = screen.getByRole('table', { name: 'Pendências documentais do painel' });
    expect(within(table).getAllByRole('columnheader').map(header => header.textContent)).toEqual(['Documento', 'Prazo', 'Situação', 'Consulta']);
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(within(rows[1]).getAllByRole('cell')).toHaveLength(4);
    expect(within(rows[1]).getByText('Relatório de inspeção')).toBeVisible();
    expect(within(rows[1]).getByText('18/10/2026')).toHaveAttribute('datetime', '2026-10-18');
    expect(within(rows[2]).getByText('Sem data informada')).toBeVisible();
    expect(within(table).getAllByRole('link', { name: 'Ver documento' })).toHaveLength(2);
  });

  it('não cria links quando o perfil não pode consultar documentos', () => {
    show([pending()], false);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('Relatório de inspeção')).toBeVisible();
    expect(screen.getByText('Consulta indisponível')).toBeVisible();
  });

  it('limita a consulta a recursos documentais e codifica o identificador inteiro como um segmento', () => {
    show([
      pending({ resourceType: 'document', resourceId: 'documento/especial #1?versão=2%' }),
      pending({ id: 'pending-2', title: 'Pendência de outro módulo', resourceType: 'WORKER', resourceId: 'worker-1' }),
    ]);
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Ver documento' })).toHaveAttribute('href', '/app/documentos/documento%2Fespecial%20%231%3Fvers%C3%A3o%3D2%25');
    const other = screen.getByText('Pendência de outro módulo').closest('tr')!;
    expect(within(other).getByText('Consulta indisponível')).toBeVisible();
    expect(within(other).queryByRole('link')).not.toBeInTheDocument();
  });

  it.each([
    ['EXPIRED', 'Vencido'],
    ['IN_REVIEW', 'Em revisão'],
    ['ACTIVE', 'A vencer'],
    ['OTHER_STATUS', 'Acompanhar'],
    [undefined, 'Acompanhar'],
  ])('exibe a situação %s sem inferir outra pela data', (status, expected) => {
    show([pending({ status, dueDate: '2027-12-31' })]);
    const row = screen.getByText('Relatório de inspeção').closest('tr')!;
    expect(within(row).getByText(expected)).toBeVisible();
    expect(within(row).getByText('31/12/2027')).toBeVisible();
  });
});

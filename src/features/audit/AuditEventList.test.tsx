import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { AuditLogDto } from '../../shared/contracts';
import { AuditEventList } from './AuditEventList';

function auditEvent(overrides: Partial<AuditLogDto> = {}): AuditLogDto {
  return { id: 'event-1', actorId: 'actor-1', action: 'DOCUMENT_CREATED', resourceType: 'DOCUMENT', resourceId: 'document-1', occurredAt: '2026-10-18T12:30:00Z', requestId: 'request-1', outcome: 'SUCCESS', ...overrides };
}

const labels = { DOCUMENT_CREATED: 'Documento cadastrado' };

describe('lista dos eventos de auditoria', () => {
  it('mantém uma única tabela de leitura com seis colunas e uma linha por evento', () => {
    render(<AuditEventList events={[auditEvent(), auditEvent({ id: 'event-2', action: 'DOCUMENT_VIEWED' })]} actionLabels={labels} />);
    const region = screen.getByRole('region', { name: 'Tabela dos eventos de auditoria' });
    expect(region).toHaveAttribute('tabindex', '0');
    const table = within(region).getByRole('table', { name: 'Trilha de eventos de auditoria' });
    expect(screen.getAllByRole('table')).toHaveLength(1);
    expect(within(table).getAllByRole('columnheader').map(header => header.textContent)).toEqual(['Data e hora', 'Ação', 'Recurso', 'Ator', 'Resultado', 'Rastreio']);
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(within(table).getAllByRole('cell')).toHaveLength(12);
    expect(within(table).getByText('Documento cadastrado')).toBeVisible();
    expect(within(table).getAllByText('18/10/2026, 09:30')).toHaveLength(2);
    expect(within(table).queryByRole('button')).not.toBeInTheDocument();
    expect(within(table).queryByRole('link')).not.toBeInTheDocument();
  });

  it('preserva os identificadores e códigos completos, inclusive quando são longos', () => {
    const resourceId = `document-${'r'.repeat(180)}`, actorId = `actor-${'a'.repeat(180)}`, requestId = `request-${'t'.repeat(180)}`;
    const action = `SERVER_${'ACTION'.repeat(18)}`;
    render(<AuditEventList events={[auditEvent({ resourceId, actorId, requestId, action })]} actionLabels={labels} />);
    const row = screen.getAllByRole('row')[1];
    for (const value of [resourceId, actorId, requestId, action]) expect(within(row).getByText(value, { exact: true })).toBeVisible();
    expect(within(row).getByText('DOCUMENT', { exact: true })).toBeVisible();
    expect(within(row).getAllByRole('cell')).toHaveLength(6);
  });

  it.each([
    ['SUCCESS', 'Concluído'], ['DENIED', 'Negado'], ['ERROR', 'Falha'], ['DEMO', 'Demonstração'], ['QUEUED_BY_SERVER', 'QUEUED_BY_SERVER'],
  ])('exibe o resultado informado pelo serviço: %s', (outcome, text) => {
    render(<AuditEventList events={[auditEvent({ outcome })]} actionLabels={labels} />);
    const cells = within(screen.getAllByRole('row')[1]).getAllByRole('cell');
    expect(within(cells[4]).getByText(text, { exact: true })).toBeVisible();
  });

  it('mantém uma ação desconhecida literal, sem usar propriedades herdadas como rótulo', () => {
    render(<AuditEventList events={[auditEvent({ action: 'toString' })]} actionLabels={{}} />);
    expect(screen.getByText('toString', { exact: true })).toBeVisible();
  });

  it('mostra uma indicação segura para um timestamp inválido', () => {
    render(<AuditEventList events={[auditEvent({ occurredAt: 'timestamp-invalido' })]} actionLabels={labels} />);
    expect(screen.getByText('Data inválida')).toBeVisible();
    expect(screen.queryByText('Invalid Date')).not.toBeInTheDocument();
  });
});

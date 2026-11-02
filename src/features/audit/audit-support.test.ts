import { describe, expect, it } from 'vitest';
import type { AuditLogDto, PageDto } from '../../shared/contracts';
import { ScopedPageError } from '../../shared/lib/scoped-page';
import { actionCode, checkedAuditPage, validCivilDate } from './audit-support';

const event: AuditLogDto = {
  id: 'event', actorId: 'actor', action: 'DOCUMENT_VIEWED', resourceType: 'DOCUMENT', resourceId: 'document',
  requestId: 'request', outcome: 'SUCCESS', occurredAt: '2026-10-11T12:00:00Z',
};
const page = (item = event): PageDto<AuditLogDto> => ({ items: [item], page: 1, pageSize: 20, total: 1 });
const expected = { page: 1, pageSize: 20 };

describe('conferência dos critérios da auditoria', () => {
  it('confere a ação exata, incluindo códigos novos seguros, sem exigir rótulo conhecido', () => {
    const value = page({ ...event, action: 'EVENTO_NOVO' });
    expect(checkedAuditPage(value, { ...expected, action: 'EVENTO_NOVO' })).toBe(value);
    expect(() => checkedAuditPage(value, { ...expected, action: 'DOCUMENT_VIEWED' })).toThrow(ScopedPageError);
    expect(() => checkedAuditPage(value, { ...expected, action: 'evento_novo' })).toThrow(ScopedPageError);
  });
  it('considera 01h UTC no dia civil anterior em São Paulo, com limites inclusivos', () => {
    const value = page({ ...event, occurredAt: '2026-10-11T01:00:00Z' });
    expect(checkedAuditPage(value, { ...expected, from: '2026-10-10', to: '2026-10-10' })).toBe(value);
    expect(() => checkedAuditPage(value, { ...expected, from: '2026-10-11' })).toThrow(ScopedPageError);
    expect(() => checkedAuditPage(value, { ...expected, to: '2026-10-09' })).toThrow(ScopedPageError);
  });
  it.each([
    ['from', '2026-10-12'], ['to', '2026-10-10'],
  ])('rejeita evento fora do limite %s', (key, value) => {
    expect(() => checkedAuditPage(page(), { ...expected, [key]: value })).toThrow(ScopedPageError);
  });
  it.each(['inválido', '', 'not-a-date'])('tolera timestamp textual %s somente sem período', occurredAt => {
    const value = page({ ...event, occurredAt });
    expect(checkedAuditPage(value, expected)).toBe(value);
    expect(() => checkedAuditPage(value, { ...expected, from: '2026-10-01' })).toThrow(ScopedPageError);
    expect(() => checkedAuditPage(value, { ...expected, to: '2026-10-31' })).toThrow(ScopedPageError);
  });
  it.each([
    { action: 'AÇÃO COM ESPAÇOS' }, { action: 'A'.repeat(101) }, { action: 'ACAO\nOUTRA' },
    { from: '2026-02-30' }, { to: '2026-2-01' }, { from: '2026-10-12', to: '2026-10-11' },
  ])('rejeita critérios incompatíveis mesmo com página vazia: %j', criteria => {
    expect(() => checkedAuditPage({ items: [], page: 1, pageSize: 20, total: 0 }, { ...expected, ...criteria })).toThrow(ScopedPageError);
  });
  it.each([
    { ...page(), page: 2 }, { ...page(), pageSize: 10 }, { ...page(), total: -1 },
    { ...page(), items: [event, event], total: 2 }, { ...page(), items: [{ ...event, requestId: '../request' }] },
    { ...page(), items: [{ ...event, occurredAt: {} }] },
  ])('preserva a validação estrutural e de escopo da página: %j', value => {
    expect(() => checkedAuditPage(value, expected)).toThrow(ScopedPageError);
  });
  it('preserva as regras dos critérios aceitos pelo endereço', () => {
    expect(actionCode('EVENTO-NOVO:1.2_test')).toBe(true);
    expect(actionCode('')).toBe(false);
    expect(validCivilDate('')).toBe(true);
    expect(validCivilDate('2024-02-29')).toBe(true);
    expect(validCivilDate('2026-02-29')).toBe(false);
  });
});

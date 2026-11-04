import { describe, expect, it } from 'vitest';
import { ScopedPageError } from '../../shared/lib/scoped-page';
import { checkedNotificationsPage, isNotification, notificationCriteriaError, validReadAt } from './notifications-support';

const unread = { id: 'notice', type: 'DOCUMENT_EXPIRING', title: 'Documento vence em breve', summary: 'Consulte o registro.', resourceType: 'DOCUMENT', resourceId: 'document', createdAt: '2026-10-18T10:00:00Z' };
const read = { ...unread, readAt: '2026-10-18T11:00:00Z' };
const page = (items: unknown[]) => ({ items, page: 1, pageSize: 20, total: items.length });

describe('validação compartilhada de notificações', () => {
  it.each([
    { criterion: '', items: [unread, { ...read, id: 'read-notice' }] },
    { criterion: 'false', items: [unread] },
    { criterion: 'true', items: [read] },
  ])('preserva registros compatíveis com leitura $criterion', ({ criterion, items }) => {
    const payload = page(items);
    expect(checkedNotificationsPage(payload, { page: 1, pageSize: 20, read: criterion })).toBe(payload);
  });

  it.each([
    { criterion: 'false', item: read },
    { criterion: 'true', item: unread },
    { criterion: 'unknown', item: unread },
  ])('recusa página incompatível com leitura $criterion', ({ criterion, item }) => {
    expect(() => checkedNotificationsPage(page([item]), { page: 1, pageSize: 20, read: criterion })).toThrow(ScopedPageError);
  });

  it.each([
    { ...page([unread]), items: null },
    { ...page([unread]), items: 'cached text' },
    page([{ ...unread, title: { unexpected: 'object' } }]),
    page([{ ...unread, readAt: '2026-02-30T12:00:00Z' }]),
    page([unread, unread]),
    { ...page([unread]), total: -1 },
    { ...page([unread]), page: 2 },
    { ...page([unread]), pageSize: 1 },
  ])('recusa envelope ou registros malformados vindos do cache', payload => {
    expect(() => checkedNotificationsPage(payload, { page: 1, pageSize: 20, read: '' })).toThrow(ScopedPageError);
  });

  it('mantém datas de apresentação inválidas como texto sem inventar data válida', () => {
    const item = { ...unread, createdAt: 'data incorreta', dueDate: 'também incorreta' };
    expect(isNotification(item)).toBe(true);
    expect(checkedNotificationsPage(page([item]), { page: 1, pageSize: 20, read: 'false' }).items).toEqual([item]);
  });

  it.each(['', '2026-02-30T12:00:00Z', '2026-10-18', '2026-10-18T25:00:00Z'])('recusa recibo sem horário válido: %s', value => {
    expect(validReadAt(value)).toBe(false);
  });
  it.each(['2026-10-18T12:00:00Z', '2026-10-18T12:00:00.123-03:00'])('aceita recibo válido: %s', value => {
    expect(validReadAt(value)).toBe(true);
  });
});

describe('critérios da consulta de notificações', () => {
  it.each(['', 'read=', 'read=true&page=2&unitId=unit', 'read=false'])('preserva critérios aceitos: %s', search => {
    expect(notificationCriteriaError(new URLSearchParams(search))).toBe('');
  });
  it.each([
    ['read=true&read=false', 'filtros repetidos'],
    ['read=other', 'filtro de leitura'],
    ['q=extra', 'filtros desconhecidos'],
    ['page=0', 'página do endereço'],
    ['page=01', 'página do endereço'],
  ])('explica critério inválido: %s', (search, text) => {
    expect(notificationCriteriaError(new URLSearchParams(search))).toContain(text);
  });
});

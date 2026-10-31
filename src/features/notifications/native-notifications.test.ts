import { describe, expect, it } from 'vitest';
import { checkedNativeNotifications } from './native-notifications';

const notice = { id: '10000000-0000-4000-8000-000000000001', resourceId: '10000000-0000-4000-8000-000000000002', type: 'NOVO_TIPO', text: 'Aviso da API', createdAt: '2026-10-31T12:00:00Z', readAt: null };
describe('contrato nativo de notificações', () => {
  it('preserva tipos futuros e o readAt nulo, removendo campos extras', () => {
    expect(checkedNativeNotifications({ items: [{ ...notice, secret: 'private' }] })).toEqual({ items: [notice] });
  });
  it.each([[], { items: [notice, notice] }, { items: [{ ...notice, id: '../bad' }] }, { items: [{ ...notice, readAt: undefined }] }, { items: [{ ...notice, createdAt: '2026-02-30T12:00:00Z' }] }, { items: [{ ...notice, readAt: '2025-01-01T00:00:00Z' }] }])('rejeita respostas incompatíveis: %j', value => {
    expect(() => checkedNativeNotifications(value)).toThrow();
  });
});

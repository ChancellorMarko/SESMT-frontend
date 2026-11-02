import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { invalidateConsultation } from './consultation-cache';
import { invalidateAuthorizationContext } from '../../features/authorizations/request-safety';

describe('atualização das consultas no contexto da alteração', () => {
  it.each(['documents', 'permits', 'ats', 'pets'] as const)('invalida todas as páginas de %s só na sessão e unidade atuais', async resource => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    const keys = [
      [`consulta-${resource}`, 'session-a', 'unit-a', 1],
      [`consulta-${resource}`, 'session-a', 'unit-a', 2, 'Busca'],
      [`consulta-${resource}`, 'session-a', 'unit-b', 1],
      [`consulta-${resource}`, 'session-b', 'unit-a', 1],
      ['consulta-other', 'session-a', 'unit-a', 1],
    ];
    for (const key of keys) client.setQueryData(key, { items: [] });
    await invalidateConsultation(client, resource, { sessionKey: 'session-a', unitId: 'unit-a' });
    expect(keys.map(key => client.getQueryState(key)?.isInvalidated)).toEqual([true, true, false, false, false]);
    client.clear();
  });
  it('não invalida dados sem contexto completo', async () => {
    const client = new QueryClient(); const key = ['consulta-ats', 'session-a', 'unit-a']; client.setQueryData(key, []);
    await invalidateConsultation(client, 'ats', { sessionKey: '', unitId: 'unit-a' });
    await invalidateConsultation(client, 'ats', { sessionKey: 'session-a', unitId: undefined });
    expect(client.getQueryState(key)?.isInvalidated).toBe(false); client.clear();
  });
  it('inclui a Central de AT após alterações que já atualizam a lista própria', async () => {
    const client = new QueryClient();
    const own = ['work-authorizations', 'session-a', 'unit-a']; const central = ['consulta-ats', 'session-a', 'unit-a', 2]; const pet = ['consulta-pets', 'session-a', 'unit-a'];
    for (const key of [own, central, pet]) client.setQueryData(key, []);
    await invalidateAuthorizationContext(client, 'session-a', 'unit-a', ['work-authorizations']);
    expect(client.getQueryState(own)?.isInvalidated).toBe(true);
    expect(client.getQueryState(central)?.isInvalidated).toBe(true);
    expect(client.getQueryState(pet)?.isInvalidated).toBe(false); client.clear();
  });
});

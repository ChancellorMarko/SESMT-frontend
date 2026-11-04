import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { handlers, resetDemo } from './handlers';
import type { PublicTeamInviteDto } from '../shared/contracts/teams';

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => resetDemo());
afterEach(() => server.resetHandlers());
afterAll(() => { resetDemo(); server.close(); });

describe('convite público pelo adaptador HTTP, sem sessão', () => {
  it('abre um convite ativo sem cookies/credenciais e mantém integrantes no alcance do token', async () => {
    const response = await fetch('http://localhost/api/v1/team-invites/public/tok-equipe-civil-2026');
    expect(response.status).toBe(200);
    const data = await response.json() as PublicTeamInviteDto;
    expect(data.status).toBe('ACTIVE');
    expect(data.members.length).toBeGreaterThan(0);
    expect(data.companyName).toBe('Organização Exemplo');
  });
  it('recusa métodos de alteração, token inexistente e acesso administrativo sem sessão', async () => {
    expect((await fetch('http://localhost/api/v1/team-invites/public/tok-equipe-civil-2026', { method: 'POST' })).status).toBe(405);
    expect((await fetch('http://localhost/api/v1/team-invites/public/unknown')).status).toBe(404);
    expect((await fetch('http://localhost/api/v1/team-invites')).status).toBe(401);
  });
});

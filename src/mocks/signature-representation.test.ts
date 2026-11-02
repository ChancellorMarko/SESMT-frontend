import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeFixtures } from './fixtures';
import type { PermitDemoContext } from './work-permits';
import type { SignatureRepresentationDto } from '../shared/contracts/signature-representation';
import { makeSignatureRepresentationDemo } from './signature-representation';

const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const actor = (): PermitDemoContext => ({ user: makeFixtures().users[0], permissions: ['permits.review'], workers: [], checkUnit: vi.fn() });
describe('perfil pessoal de representação em demonstração', () => {
  let demo: ReturnType<typeof makeSignatureRepresentationDemo>;
  beforeEach(() => { demo = makeSignatureRepresentationDemo(); });
  const body = (context = actor()) => ({ method: 'TYPED', representation: context.user.displayName, confirmed: true });
  async function call(method = 'GET', payload?: unknown, revision?: number, context = actor()) {
    const url = new URL('http://localhost/api/v1/me/signature-representation');
    const request = new Request(url, { method, headers: revision === undefined ? {} : { 'If-Match': `"${revision}"` }, body: payload === undefined ? undefined : JSON.stringify(payload) });
    return await demo.route(request, url, '/me/signature-representation', context) as SignatureRepresentationDto | null;
  }
  it('não cria perfil ao consultar; cria e atualiza com versões independentes de PT', async () => {
    expect(await call()).toBeNull();
    const first = (await call('PUT', body(), 0))!;
    expect(first).toMatchObject({ userId: actor().user.id, revision: 1, version: 1, method: 'TYPED', representation: 'Marina Demo' });
    const second = (await call('PUT', { ...body(), method: 'DRAWN', image }, 1))!;
    expect(second.id).toBe(first.id); expect(second.version).toBe(2); expect(second.image).toBe(image);
    const typed = (await call('PUT', body(), 2))!;
    expect(typed.image).toBeUndefined(); expect(typed.revision).toBe(3);
  });
  it('separa usuários e rejeita seleção do perfil de outra pessoa', async () => {
    const first = (await call('PUT', body(), 0))!;
    const other = actor(); other.user.id = 'other-engineer'; other.user.displayName = 'Outra Engenheira Demo';
    expect(await call('GET', undefined, undefined, other)).toBeNull();
    expect(() => demo.forReview(other, first.id, first.version)).toThrow(/não pertence/);
    const second = (await call('PUT', body(other), 0, other))!;
    expect(second.id).not.toBe(first.id); expect((await call())?.id).toBe(first.id);
  });
  it('exige autorização e concessão vigente para ler, gravar e reutilizar', async () => {
    const first = (await call('PUT', body(), 0))!;
    const technician = actor(); technician.permissions = [];
    await expect(call('GET', undefined, undefined, technician)).rejects.toMatchObject({ status: 403 });
    await expect(call('PUT', body(), 1, technician)).rejects.toMatchObject({ status: 403 });
    expect(() => demo.forReview(technician, first.id, 1)).toThrow(/não permite/);
    const expired = actor(); expired.user.scope.expiresAt = '2020-01-01T00:00:00Z';
    await expect(call('GET', undefined, undefined, expired)).rejects.toMatchObject({ code: 'SCOPE_EXPIRED' });
  });
  it('rejeita formulário sem confirmação, identidade alheia e métodos inválidos sem mutação', async () => {
    for (const payload of [{ ...body(), confirmed: false }, { ...body(), representation: 'Outra pessoa' }, { ...body(), method: 'SVG' }, { ...body(), method: 'IMAGE', image: 'data:image/png;base64,ZmFrZQ==' }]) {
      await expect(call('PUT', payload, 0)).rejects.toMatchObject({ status: 422 });
      expect(await call()).toBeNull();
    }
    await expect(call('POST', body(), 0)).rejects.toMatchObject({ status: 405 });
    await expect(call('PUT', body())).rejects.toMatchObject({ status: 428 });
  });
  it('rejeita revisões antigas, concorrência e reutilização de versão desatualizada', async () => {
    const first = (await call('PUT', body(), 0))!;
    const results = await Promise.allSettled([call('PUT', { ...body(), method: 'IMAGE', image }, 1), call('PUT', body(), 1)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    await expect(call('PUT', body(), 1)).rejects.toMatchObject({ status: 409 });
    expect(() => demo.forReview(actor(), first.id, 1)).toThrow(/foi alterada/);
  });
  it('cópias já selecionadas não se alteram com novas versões nem com mutação do retorno', async () => {
    const first = (await call('PUT', { ...body(), method: 'IMAGE', image }, 0))!;
    const snapshot = demo.forReview(actor(), first.id, 1);
    const queried = (await call())!; queried.image = 'alterado';
    expect(demo.forReview(actor(), first.id, 1).image).toBe(image);
    await call('PUT', body(), 1);
    expect(snapshot.image).toBe(image); expect(snapshot.version).toBe(1);
  });
});

import { beforeEach, expect, it, vi } from 'vitest';
import { api, ApiError } from '../../shared/api/client';
import { InvalidReadResponse } from '../../shared/lib/verified-read';
import { loadPinnedTemplates } from './checklists';
import { permitFixture } from '../../../tests/connection-ui/fixtures/native-permits';
import { templateFixture, laterTemplateFixture } from '../../../tests/connection-ui/fixtures/native-checklists';

vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn() } }));
const item = permitFixture(), signal = new AbortController().signal;
const receipt = () => ({ id: item.id, versao: item.version, statusOperacional: item.status.toLowerCase(), statusRevisao: item.reviewStatus.toLowerCase(),
  participanteIds: item.participants.map(p => p.userId), templateVersionIds: item.templateVersionIds });
beforeEach(() => vi.resetAllMocks());

it('lê as definições fixadas sem consultar o catálogo administrativo', async () => {
  vi.mocked(api.get).mockResolvedValue({ ...receipt(), pinnedTemplates: [templateFixture()] });
  expect((await loadPinnedTemplates(item, signal))[0].id).toBe(item.templateVersionIds[0]);
  expect(api.get).toHaveBeenCalledTimes(1);
  expect(api.get).toHaveBeenCalledWith(`/work-permits/pts/${item.id}`, { signal });
});
it('mantém compatibilidade somente com um recibo antigo válido sem o campo novo', async () => {
  vi.mocked(api.get).mockResolvedValueOnce(receipt()).mockResolvedValueOnce([templateFixture(), laterTemplateFixture()]);
  expect(await loadPinnedTemplates(item, signal)).toHaveLength(1);
  expect(api.get).toHaveBeenLastCalledWith('/work-permits/pt-templates', { query: { companyId: item.companyId }, signal });
});
it.each([401, 403, 404])('uma recusa %s não consulta outro catálogo', async status => {
  vi.mocked(api.get).mockRejectedValue(new ApiError(status, { code: 'FORBIDDEN', message: 'Privado', requestId: 'test' }));
  await expect(loadPinnedTemplates(item, signal)).rejects.toBeInstanceOf(ApiError);
  expect(api.get).toHaveBeenCalledTimes(1);
});
it.each([{ versao: item.version + 1 }, { id: templateFixture().id }, { participanteIds: [] }, { pinnedTemplates: null },
  { pinnedTemplates: [laterTemplateFixture()] }, { pinnedTemplates: [templateFixture(), laterTemplateFixture()] }])('recusa contexto/modelos incompatíveis sem fallback: %j', change => {
  vi.mocked(api.get).mockResolvedValue({ ...receipt(), ...change });
  return expect(loadPinnedTemplates(item, signal)).rejects.toBeInstanceOf(InvalidReadResponse);
});

/** Matriz administrativa em memória. Publicação não altera versões já encerradas da PT. */
import type { MatrixRuleDto, MatrixWriteDto, MatrixVersionDto, RequirementMatrixDto } from '../shared/contracts/requirements';
import type { PermitEventDto, ServiceTypeDto } from '../shared/contracts/work-permits';
import { PermitDemoError, type PermitDemoContext } from './work-permits';

const clone = <T,>(value: T): T => structuredClone(value);
const normalized = (value: string) => value.trim().replace(/\s+/g, ' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
function assert(condition: unknown, status: number, code: string, message: string, field?: string): asserts condition {
  if (!condition) throw new PermitDemoError(status, code, message, field);
}
function revision(request: Request, value: { revision: number }) {
  assert(request.headers.has('If-Match'), 428, 'PRECONDITION_REQUIRED', 'Carregue a matriz antes de alterar.');
  assert(request.headers.get('If-Match') === `"${value.revision}"`, 412, 'REVISION_CONFLICT', 'A matriz mudou. Recarregue e confira a versão atual.');
}
const semanticKey = (rule: Omit<MatrixRuleDto, 'id'>) => JSON.stringify([rule.label, rule.description, rule.serviceTypeId, normalized(rule.serviceFunction), normalized(rule.locationContains), rule.restricted, rule.validFromRequired, rule.validUntilRequired]);

export function makeRequirementMatrixDemo(units: { id: string; companyId: string }[], services: ServiceTypeDto[], seed: MatrixRuleDto[]) {
  const matrices = new Map<string, RequirementMatrixDto>();
  for (const unit of units) {
    const published: MatrixVersionDto = { version: 'DEMO-MATRIZ-1', rules: clone(seed), publishedAt: new Date().toISOString(), publishedBy: 'SEED_DEMO', reason: 'Configuração administrativa sintética inicial.' };
    matrices.set(unit.id, { unitId: unit.id, revision: 1, published, draft: null, versions: [clone(published)], services: clone(services), availableActions: [], history: [] });
  }
  const handles = (path: string) => /^\/requirement-matrix(?:\/(?:draft|publish))?$/.test(path);
  const authorized = (unitId: string | null, context: PermitDemoContext, writing: boolean) => {
    assert(context.permissions.includes(writing ? 'requirements.write' : 'requirements.read'), 403, 'FORBIDDEN', 'Seu perfil não permite esta ação na matriz.');
    assert(unitId, 422, 'VALIDATION_FAILED', 'Informe a unidade para consultar ou alterar a matriz.', 'unitId');
    const unit = units.find(value => value.id === unitId);
    assert(unit && context.user.scope.unitIds.includes(unit.id) && context.user.scope.companyIds.includes(unit.companyId), 403, 'FORBIDDEN', 'Unidade fora do seu alcance.');
    context.checkUnit(unitId);
    assert(!context.user.scope.ownOnly, 403, 'FORBIDDEN', 'A consulta da configuração exige acesso ao conjunto da unidade.');
    assert(!writing || !context.user.scope.teamIds.length, 403, 'FORBIDDEN', 'A alteração da matriz exige acesso à unidade sem restrição a equipes.');
    return matrices.get(unitId)!;
  };
  const response = (matrix: RequirementMatrixDto, context: PermitDemoContext): RequirementMatrixDto => ({ ...clone(matrix), services: services.map(service => ({ ...clone(service), requirementVersion: matrix.published.version })), availableActions: context.permissions.includes('requirements.write') && !context.user.scope.ownOnly && !context.user.scope.teamIds.length ? ['EDIT_DRAFT', ...(matrix.draft ? ['PUBLISH'] : [])] : [] });
  const event = (context: PermitDemoContext, action: string, reason?: string): PermitEventDto => ({ id: crypto.randomUUID(), action, actorName: context.user.displayName, occurredAt: new Date().toISOString(), reason });
  function canonicalRules(input: unknown, matrix: RequirementMatrixDto): MatrixRuleDto[] {
    assert(input && typeof input === 'object' && !Array.isArray(input), 422, 'VALIDATION_FAILED', 'Envie as regras da matriz em um objeto.', 'rules');
    const rules = (input as MatrixWriteDto).rules;
    assert(Array.isArray(rules) && rules.length >= 1 && rules.length <= 100, 422, 'VALIDATION_FAILED', 'Use de 1 a 100 regras administrativas.', 'rules');
    const existing = [...matrix.published.rules, ...(matrix.draft?.rules || [])];
    const result = rules.map((raw, index) => {
      const field = `rules.${index}`;
      assert(raw && typeof raw === 'object' && !Array.isArray(raw), 422, 'VALIDATION_FAILED', 'Confira os campos da regra.', field);
      const string = (key: 'label' | 'description' | 'serviceTypeId' | 'serviceFunction' | 'locationContains', min: number, max: number) => {
        const value = raw[key] ?? (key === 'locationContains' ? '' : undefined);
        assert(typeof value === 'string' && value.trim().length >= min && value.length <= max, 422, 'VALIDATION_FAILED', `Confira o campo ${key} da regra.`, `${field}.${key}`);
        return value.trim();
      };
      const rule: Omit<MatrixRuleDto, 'id'> = { label: string('label', 3, 160), description: string('description', 5, 2000), serviceTypeId: string('serviceTypeId', 1, 100), serviceFunction: string('serviceFunction', 1, 80), locationContains: string('locationContains', 0, 200), restricted: raw.restricted, validFromRequired: raw.validFromRequired, validUntilRequired: raw.validUntilRequired };
      assert(services.some(service => service.id === rule.serviceTypeId), 422, 'VALIDATION_FAILED', 'Selecione um serviço conhecido.', `${field}.serviceTypeId`);
      assert([rule.restricted, rule.validFromRequired, rule.validUntilRequired].every(value => typeof value === 'boolean'), 422, 'VALIDATION_FAILED', 'Informe as opções de classificação e vigência como booleanos.', field);
      assert(!rule.restricted || !rule.validFromRequired && !rule.validUntilRequired, 422, 'RESTRICTED_POLICY', 'Requisitos restritos registram apenas pendência administrativa, sem datas ou documentos clínicos.', field);
      const previous = existing.find(value => semanticKey(value) === semanticKey(rule));
      return { id: previous?.id || crypto.randomUUID(), ...rule };
    });
    assert(new Set(result.map(semanticKey)).size === result.length, 422, 'DUPLICATE_RULE', 'Não repita a mesma regra na matriz.', 'rules');
    return result;
  }
  async function route(request: Request, url: URL, path: string, context: PermitDemoContext): Promise<RequirementMatrixDto | undefined> {
    if (!handles(path)) return undefined;
    const matrix = authorized(url.searchParams.get('unitId'), context, request.method !== 'GET');
    if (path === '/requirement-matrix' && request.method === 'GET') return response(matrix, context);
    assert(path === '/requirement-matrix/draft' && request.method === 'PATCH' || path === '/requirement-matrix/publish' && request.method === 'POST', 405, 'METHOD_NOT_ALLOWED', 'Operação de matriz não disponível.');
    revision(request, matrix);
    let input: unknown;
    try { input = await request.json(); } catch { throw new PermitDemoError(422, 'VALIDATION_FAILED', 'Envie um objeto JSON válido.'); }
    authorized(url.searchParams.get('unitId'), context, true); revision(request, matrix);
    if (path.endsWith('/draft')) {
      const rules = canonicalRules(input, matrix);
      matrix.draft = { rules, savedAt: new Date().toISOString(), savedBy: context.user.id };
      matrix.history.push(event(context, 'MATRIX_DRAFT_SAVED', 'Rascunho salvo; a publicação atual continua determinando os requisitos.'));
    } else {
      assert(input && typeof input === 'object' && !Array.isArray(input), 422, 'VALIDATION_FAILED', 'Envie o motivo da publicação.', 'reason');
      const reason = (input as { reason?: unknown }).reason;
      assert(typeof reason === 'string' && reason.trim().length >= 10 && reason.length <= 2000, 422, 'VALIDATION_FAILED', 'Informe o motivo da publicação com 10 a 2.000 caracteres.', 'reason');
      assert(matrix.draft, 409, 'DRAFT_REQUIRED', 'Salve um rascunho antes de publicar a matriz.');
      assert(services.every(service => matrix.draft!.rules.some(rule => rule.serviceTypeId === service.id && rule.serviceFunction === '*' && !rule.locationContains)), 422, 'MATRIX_COVERAGE_REQUIRED', 'Cada serviço precisa de pelo menos uma regra base para todas as funções e locais.', 'rules');
      const published: MatrixVersionDto = { version: `DEMO-MATRIZ-${matrix.versions.length + 1}`, rules: clone(matrix.draft.rules), publishedAt: new Date().toISOString(), publishedBy: context.user.id, reason: reason.trim() };
      matrix.published = published;
      matrix.versions.push(clone(published));
      matrix.draft = null;
      matrix.history.push(event(context, 'MATRIX_PUBLISHED', `${published.version}: ${published.reason}`));
    }
    matrix.revision++;
    return response(matrix, context);
  }
  const published = (unitId: string) => clone(matrices.get(unitId)!.published);
  const findPublishedRule = (requirementId: string, unitId?: string) => [...matrices.values()].filter(matrix => !unitId || matrix.unitId === unitId).flatMap(matrix => matrix.versions).flatMap(version => version.rules).find(rule => rule.id === requirementId);
  return { handles, route, published, findPublishedRule };
}

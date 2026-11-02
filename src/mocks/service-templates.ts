/** Configuração em memória para demonstração. Não substitui autorização da API real. */
import type { ServiceCatalogDto, ServiceTemplateDto, ServiceTemplateQuestionDto, ServiceTemplateVersionDto } from '../shared/contracts/service-templates';
import type { ServiceTypeDto } from '../shared/contracts/work-permits';
import { PT_SERVICE_TYPES } from '../shared/lib/service-types';
import { PermitDemoError, type PermitDemoContext } from './work-permits';

const clone = <T,>(value: T): T => structuredClone(value);
function assert(condition: unknown, status: number, code: string, message: string, field?: string): asserts condition {
  if (!condition) throw new PermitDemoError(status, code, message, field);
}
function revision(request: Request, template: ServiceTemplateDto) {
  assert(request.headers.has('If-Match'), 428, 'PRECONDITION_REQUIRED', 'Carregue o template antes de alterar.');
  assert(request.headers.get('If-Match') === `"${template.revision}"`, 412, 'REVISION_CONFLICT', 'O template mudou. Confira a versão atual antes de continuar.');
}

export function makeServiceTemplatesDemo(units: { id: string; companyId: string }[], services: ServiceTypeDto[]) {
  const seededAt = new Date().toISOString();
  const templates = new Map<string, Map<string, ServiceTemplateDto>>();
  for (const unit of units) {
    const catalog = new Map<string, ServiceTemplateDto>();
    for (const service of services) {
      const published: ServiceTemplateVersionDto = {
        serviceTypeId: service.id, serviceName: service.name, version: service.templateVersion,
        activityIds: clone(service.activityIds || []),
        questions: [
          { id: `${service.id}:context`, label: `Contexto de ${service.name.toLocaleLowerCase('pt-BR')} conferido (demonstração)`, required: true, blockingAnswers: ['NO'] },
          { id: `${service.id}:team`, label: `Orientações da equipe para ${service.name.toLocaleLowerCase('pt-BR')} registradas (demonstração)`, required: true, blockingAnswers: ['NO'] },
        ],
        publishedAt: seededAt, publishedBy: 'SEED_DEMO', reason: 'Configuração sintética inicial para demonstração da edição de templates.',
      };
      catalog.set(service.id, { unitId: unit.id, service: clone(service), revision: 1, published, draft: null, versions: [clone(published)], availableActions: [], history: [] });
    }
    templates.set(unit.id, catalog);
  }
  const handles = (path: string) => /^\/service-templates(?:\/[^/]+\/(?:draft|publish))?$/.test(path);
  const authorized = (unitId: string | null, context: PermitDemoContext, writing: boolean) => {
    assert(context.permissions.includes(writing ? 'requirements.write' : 'requirements.read'), 403, 'FORBIDDEN', 'Seu perfil não permite esta ação nos templates.');
    assert(unitId, 422, 'VALIDATION_FAILED', 'Informe a unidade para consultar ou alterar os templates.', 'unitId');
    const unit = units.find(value => value.id === unitId);
    assert(unit && context.user.scope.unitIds.includes(unit.id) && context.user.scope.companyIds.includes(unit.companyId), 403, 'FORBIDDEN', 'Unidade fora do seu alcance.');
    context.checkUnit(unitId);
    assert(!context.user.scope.ownOnly, 403, 'FORBIDDEN', 'Esta configuração exige acesso ao conjunto da unidade.');
    assert(!writing || !context.user.scope.teamIds.length, 403, 'FORBIDDEN', 'A alteração dos templates exige acesso à unidade sem restrição a equipes.');
    return templates.get(unitId)!;
  };
  const response = (template: ServiceTemplateDto, context: PermitDemoContext): ServiceTemplateDto => ({
    ...clone(template), service: { ...clone(template.service), templateVersion: template.published.version },
    availableActions: context.permissions.includes('requirements.write') && !context.user.scope.ownOnly && !context.user.scope.teamIds.length ? ['EDIT_DRAFT', ...(template.draft ? ['PUBLISH'] : [])] : [],
  });
  function questions(input: unknown): ServiceTemplateQuestionDto[] {
    assert(input && typeof input === 'object' && !Array.isArray(input), 422, 'VALIDATION_FAILED', 'Envie as perguntas do template em um objeto.', 'questions');
    const values = (input as { questions?: unknown }).questions;
    assert(Array.isArray(values) && values.length >= 1 && values.length <= 30, 422, 'VALIDATION_FAILED', 'Use de 1 a 30 perguntas no template.', 'questions');
    const result = values.map((value: unknown, index) => {
      const field = `questions.${index}`;
      assert(value && typeof value === 'object' && !Array.isArray(value), 422, 'VALIDATION_FAILED', 'Confira os campos da pergunta.', field);
      const raw = value as Record<string, unknown>;
      assert(typeof raw.id === 'string' && /^[a-zA-Z0-9:_-]{1,120}$/.test(raw.id), 422, 'VALIDATION_FAILED', 'Informe uma identificação válida para a pergunta.', `${field}.id`);
      assert(typeof raw.label === 'string' && raw.label.trim().length >= 3 && raw.label.length <= 500, 422, 'VALIDATION_FAILED', 'Informe uma pergunta com 3 a 500 caracteres.', `${field}.label`);
      assert(typeof raw.required === 'boolean', 422, 'VALIDATION_FAILED', 'Informe se a pergunta é obrigatória.', `${field}.required`);
      assert(Array.isArray(raw.blockingAnswers) && raw.blockingAnswers.every(answer => answer === 'YES' || answer === 'NO') && new Set(raw.blockingAnswers).size === raw.blockingAnswers.length && raw.blockingAnswers.length <= 1, 422, 'VALIDATION_FAILED', 'Selecione no máximo uma resposta bloqueadora: Sim ou Não.', `${field}.blockingAnswers`);
      return { id: raw.id, label: raw.label.trim(), required: raw.required, blockingAnswers: clone(raw.blockingAnswers) } as ServiceTemplateQuestionDto;
    });
    assert(new Set(result.map(value => value.id)).size === result.length, 422, 'DUPLICATE_QUESTION', 'As perguntas precisam de identificações diferentes.', 'questions');
    return result;
  }
  async function route(request: Request, url: URL, path: string, context: PermitDemoContext): Promise<ServiceCatalogDto | ServiceTemplateDto | undefined> {
    if (!handles(path)) return undefined;
    const catalog = authorized(url.searchParams.get('unitId'), context, request.method !== 'GET');
    if (path === '/service-templates' && request.method === 'GET') {
      const ids = new Set(PT_SERVICE_TYPES.map(service => service.id));
      return { unitId: url.searchParams.get('unitId')!, templates: [...catalog.values()].filter(template => ids.has(template.service.id)).map(template => response(template, context)) };
    }
    const match = path.match(/^\/service-templates\/([^/]+)\/(draft|publish)$/);
    assert(match && (match[2] === 'draft' && request.method === 'PATCH' || match[2] === 'publish' && request.method === 'POST'), 405, 'METHOD_NOT_ALLOWED', 'Operação de template não disponível.');
    const template = catalog.get(match[1]);
    assert(template, 404, 'NOT_FOUND', 'Template indisponível nesta unidade.');
    revision(request, template);
    let input: unknown;
    try { input = await request.json(); } catch { throw new PermitDemoError(422, 'VALIDATION_FAILED', 'Envie um objeto JSON válido.'); }
    authorized(url.searchParams.get('unitId'), context, true); revision(request, template);
    const occurredAt = new Date().toISOString();
    if (match[2] === 'draft') {
      template.draft = { questions: questions(input), savedAt: occurredAt, savedBy: context.user.id };
      template.history.push({ id: crypto.randomUUID(), action: 'SERVICE_TEMPLATE_DRAFT_SAVED', actorName: context.user.displayName, occurredAt, reason: 'Rascunho salvo sem alterar o template publicado.' });
    } else {
      assert(input && typeof input === 'object' && !Array.isArray(input), 422, 'VALIDATION_FAILED', 'Envie o motivo da publicação.', 'reason');
      const reason = (input as { reason?: unknown }).reason;
      assert(typeof reason === 'string' && reason.trim().length >= 10 && reason.length <= 2000, 422, 'VALIDATION_FAILED', 'Informe um motivo com 10 a 2.000 caracteres.', 'reason');
      assert(template.draft, 409, 'DRAFT_REQUIRED', 'Salve um rascunho antes de publicar.');
      assert(template.draft.questions.some(question => question.required && question.blockingAnswers.length === 1), 422, 'TEMPLATE_COVERAGE_REQUIRED', 'O template precisa de pelo menos uma pergunta obrigatória com resposta bloqueadora.', 'questions');
      const published: ServiceTemplateVersionDto = { ...clone(template.published), version: `${template.service.templateVersion}-R${template.versions.length + 1}`, questions: clone(template.draft.questions), publishedAt: occurredAt, publishedBy: context.user.id, reason: reason.trim() };
      template.published = published; template.versions.push(clone(published)); template.draft = null;
      template.history.push({ id: crypto.randomUUID(), action: 'SERVICE_TEMPLATE_PUBLISHED', actorName: context.user.displayName, occurredAt, reason: `${published.version}: ${published.reason}` });
    }
    template.revision++;
    return response(template, context);
  }
  const published = (unitId: string, serviceId: string) => {
    const template = templates.get(unitId)?.get(serviceId);
    assert(template, 404, 'NOT_FOUND', 'Template indisponível nesta unidade.');
    return clone(template.published);
  };
  return { handles, route, published };
}

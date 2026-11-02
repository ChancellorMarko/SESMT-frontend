import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServiceCatalogDto, ServiceTemplateDto, ServiceTemplateQuestionDto } from '../shared/contracts/service-templates';
import { PT_SERVICE_TYPES } from '../shared/lib/service-types';
import { COMPANY, id, makeFixtures, UNIT_A, UNIT_B } from './fixtures';
import type { PermitDemoContext } from './work-permits';
import { makeServiceTemplatesDemo } from './service-templates';

const actor = (): PermitDemoContext => ({ user: makeFixtures().users[0], workers: makeFixtures().workers, permissions: ['requirements.read', 'requirements.write'], checkUnit: () => {} });
const serviceId = PT_SERVICE_TYPES[0].id;
const path = (command: 'draft' | 'publish', unitId = UNIT_A) => `/service-templates/${serviceId}/${command}?unitId=${unitId}`;

describe('templates de serviços versionados em demonstração', () => {
  let demo: ReturnType<typeof makeServiceTemplatesDemo>;
  beforeEach(() => { demo = makeServiceTemplatesDemo([{ id: UNIT_A, companyId: COMPANY }, { id: UNIT_B, companyId: COMPANY }], PT_SERVICE_TYPES); });
  async function call<T>(value: string, method = 'GET', input?: unknown, revision?: number, context = actor()) {
    const url = new URL(`http://localhost/api/v1${value}`);
    const headers = new Headers(); if (revision !== undefined) headers.set('If-Match', `"${revision}"`);
    const request = new Request(url, { method, headers, body: input === undefined ? undefined : JSON.stringify(input) });
    return await demo.route(request, url, url.pathname.replace('/api/v1', ''), context) as T;
  }
  const catalog = (context = actor()) => call<ServiceCatalogDto>(`/service-templates?unitId=${UNIT_A}`, 'GET', undefined, undefined, context);
  const current = async () => (await catalog()).templates[0];
  const save = async (questions?: ServiceTemplateQuestionDto[]) => {
    const template = await current();
    return call<ServiceTemplateDto>(path('draft'), 'PATCH', { questions: questions || template.published.questions }, template.revision);
  };
  const publish = (revision: number) => call<ServiceTemplateDto>(path('publish'), 'POST', { reason: 'Publicação fictícia para verificar o versionamento do template.' }, revision);

  it('lista os cinco serviços estáveis, preserva atividades e retorna cópias isoladas por unidade', async () => {
    const value = await catalog();
    expect(value.templates.map(template => template.service.name)).toEqual(['Trabalho em altura', 'Trabalho a quente', 'Trabalho a frio', 'Espaço confinado', 'Eletricidade']);
    expect(value.templates[2].published.activityIds).toEqual([]);
    expect(value.templates[0].published.activityIds).toEqual(['height']);
    value.templates[0].published.questions[0].label = 'Alteração na cópia';
    expect(demo.published(UNIT_A, serviceId).questions[0].label).not.toBe('Alteração na cópia');
    const copy = demo.published(UNIT_A, serviceId); copy.questions[0].label = 'Outra cópia';
    expect(demo.published(UNIT_B, serviceId).questions[0].label).not.toBe('Outra cópia');
  });
  it('rascunho não altera publicação e publicar preserva todas as versões anteriores', async () => {
    const original = await current();
    const draft = await save(original.published.questions.map(question => ({ ...question, label: `${question.label} alterada` })));
    expect(draft.availableActions).toEqual(['EDIT_DRAFT', 'PUBLISH']);
    expect(demo.published(UNIT_A, serviceId)).toEqual(original.published);
    const published = await publish(draft.revision);
    expect(published.draft).toBeNull(); expect(published.revision).toBe(3);
    expect(published.versions[0]).toEqual(original.published);
    expect(published.published.questions).toEqual(draft.draft!.questions);
    expect(published.service.templateVersion).toBe(published.published.version);
    expect(published.history.map(event => event.action)).toEqual(['SERVICE_TEMPLATE_DRAFT_SAVED', 'SERVICE_TEMPLATE_PUBLISHED']);
    const secondDraft = await save(); const secondPublication = await publish(secondDraft.revision);
    expect(secondPublication.versions).toHaveLength(3);
    expect(new Set(secondPublication.versions.map(version => version.version)).size).toBe(3);
    expect(secondPublication.versions[1]).toEqual(published.published);
    expect(demo.published(UNIT_B, serviceId)).toEqual(original.published);
  });
  it('exige unidade, empresa e permissão; acesso próprio não consulta e equipes restritas não escrevem', async () => {
    await expect(call('/service-templates')).rejects.toMatchObject({ status: 422, field: 'unitId' });
    const denied = actor(); denied.permissions = [];
    await expect(catalog(denied)).rejects.toMatchObject({ status: 403 });
    const wrongCompany = actor(); wrongCompany.user.scope.companyIds = [];
    await expect(catalog(wrongCompany)).rejects.toMatchObject({ status: 403 });
    const wrongUnit = actor(); wrongUnit.user.scope.unitIds = [UNIT_B];
    await expect(catalog(wrongUnit)).rejects.toMatchObject({ status: 403 });
    const own = actor(); own.user.scope.ownOnly = true;
    await expect(catalog(own)).rejects.toMatchObject({ status: 403 });
    const restricted = actor(); restricted.user.scope.teamIds = [id(200)];
    expect((await catalog(restricted)).templates[0].availableActions).toEqual([]);
    const url = new URL(`http://localhost/api/v1${path('draft')}`);
    const request = new Request(url, { method: 'PATCH', headers: { 'If-Match': '"1"' } });
    const reader = vi.fn(); Object.defineProperty(request, 'json', { value: reader });
    await expect(demo.route(request, url, url.pathname.replace('/api/v1', ''), restricted)).rejects.toMatchObject({ status: 403 });
    expect(reader).not.toHaveBeenCalled();
  });
  it('consulta por leitor não oferece ações de escrita', async () => {
    const reader = actor(); reader.permissions = ['requirements.read'];
    expect((await catalog(reader)).templates.every(template => !template.availableActions.length)).toBe(true);
    await expect(call(path('draft'), 'PATCH', { questions: (await current()).published.questions }, 1, reader)).rejects.toMatchObject({ status: 403 });
  });
  it('rejeita publicação sem rascunho, motivo curto e rascunho sem pergunta obrigatória bloqueadora', async () => {
    await expect(publish(1)).rejects.toMatchObject({ code: 'DRAFT_REQUIRED' });
    const draft = await save((await current()).published.questions.map(question => ({ ...question, blockingAnswers: [] })));
    await expect(call(path('publish'), 'POST', { reason: 'curto' }, draft.revision)).rejects.toMatchObject({ field: 'reason' });
    await expect(publish(draft.revision)).rejects.toMatchObject({ code: 'TEMPLATE_COVERAGE_REQUIRED' });
    expect((await current()).revision).toBe(draft.revision);
  });
  it.each([
    ['vazio', []],
    ['excesso', Array.from({ length: 31 }, (_, index) => ({ id: `q-${index}`, label: 'Pergunta válida', required: true, blockingAnswers: ['NO'] }))],
    ['id duplicado', [{ id: 'q', label: 'Pergunta A', required: true, blockingAnswers: ['NO'] }, { id: 'q', label: 'Pergunta B', required: true, blockingAnswers: ['NO'] }]],
    ['id inválido', [{ id: '../outro', label: 'Pergunta válida', required: true, blockingAnswers: ['NO'] }]],
    ['label inválido', [{ id: 'q', label: ' ', required: true, blockingAnswers: ['NO'] }]],
    ['booleano inválido', [{ id: 'q', label: 'Pergunta válida', required: 'true', blockingAnswers: ['NO'] }]],
    ['bloqueador inválido', [{ id: 'q', label: 'Pergunta válida', required: true, blockingAnswers: ['NA'] }]],
    ['ambas respostas bloqueadoras', [{ id: 'q', label: 'Pergunta válida', required: true, blockingAnswers: ['YES', 'NO'] }]],
  ])('rejeita configuração %s sem mutação', async (_label, questions) => {
    await expect(call(path('draft'), 'PATCH', { questions }, 1)).rejects.toMatchObject({ status: 422 });
    expect((await current()).revision).toBe(1); expect((await current()).draft).toBeNull();
  });
  it('reconfere revisão depois de ler o corpo e impede sobrescrever publicação concorrente', async () => {
    const draft = await save(); let resume!: () => void;
    const body = new Promise(resolve => { resume = () => resolve({ questions: draft.draft!.questions }); });
    const url = new URL(`http://localhost/api/v1${path('draft')}`);
    const request = new Request(url, { method: 'PATCH', headers: { 'If-Match': `"${draft.revision}"` } });
    Object.defineProperty(request, 'json', { value: () => body });
    const pending = demo.route(request, url, url.pathname.replace('/api/v1', ''), actor());
    const published = await publish(draft.revision);
    const rejected = expect(pending).rejects.toMatchObject({ status: 412 }); resume(); await rejected;
    expect((await current()).revision).toBe(published.revision); expect((await current()).draft).toBeNull();
    await expect(call(path('draft'), 'PATCH', { questions: published.published.questions })).rejects.toMatchObject({ status: 428 });
  });
  it('reconfere o alcance depois da leitura do corpo antes de modificar o rascunho', async () => {
    const context = actor(); const template = await current();
    const url = new URL(`http://localhost/api/v1${path('draft')}`);
    const request = new Request(url, { method: 'PATCH', headers: { 'If-Match': '"1"' } });
    Object.defineProperty(request, 'json', { value: async () => { context.user.scope.companyIds = []; return { questions: template.published.questions }; } });
    await expect(demo.route(request, url, url.pathname.replace('/api/v1', ''), context)).rejects.toMatchObject({ status: 403 });
    expect((await current()).draft).toBeNull();
  });
});

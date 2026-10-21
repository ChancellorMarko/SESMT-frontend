import { describe, expect, it } from 'vitest';
import type { WorkPermitDto } from '../../shared/contracts/work-permits';
import { createPermitPreparation } from './templates/ri-s-36001';
import { permitGuidance, type PermitGuidanceContext } from './permit-guidance';

const allActions = ['EDIT_PREPARATION', 'EDIT_CHECKLIST', 'COLLECT_SCIENCE', 'RELEASE', 'START', 'COMPLETE', 'SUSPEND', 'RESUME', 'CANCEL', 'REVIEW', 'NEW_VERSION', 'SUBMIT_CORRECTION'];

function example(): WorkPermitDto {
  const permit: WorkPermitDto = {
    id: 'pt', code: 'PT-DEMO', operationStatus: 'VERIFICATION', reviewStatus: 'NOT_SUBMITTED', version: 1, revision: 4, templateVersion: 'Modelo ilustrativo',
    appointment: { id: 'appointment', code: 'AG-DEMO', unitId: 'unit', teamId: 'team', teamName: 'Equipe ilustrativa', serviceTypeId: 'cold', serviceLabel: 'Serviço ilustrativo', location: 'Local ilustrativo', startsAt: '2026-10-20T12:00:00Z', endsAt: '2026-10-20T15:00:00Z', responsibleId: 'operator', responsibleName: 'Técnico Demo', participants: [{ workerId: 'worker', name: 'Pessoa Demo', serviceFunction: 'Executante' }], status: 'ATTENDANCE_OPENED', revision: 1, availableActions: [], history: [] },
    checklist: [{ id: 'check', label: 'Item ilustrativo', required: true, answer: 'YES' }],
    sciences: [{ id: 'science', workerId: 'worker', version: 1, declarantName: 'Pessoa Demo', method: 'TYPED', representation: 'Pessoa Demo', confirmed: true, collectedBy: 'operator', collectedByName: 'Técnico Demo', collectedAt: '2026-10-20T12:00:00Z' }],
    eligibility: { appointmentId: 'appointment', checkedAt: '2026-10-20T12:00:00Z', requirementVersion: '1', eligible: true, participants: [] },
    availableActions: [...allActions], snapshots: [], history: [],
  };
  permit.preparation = createPermitPreparation(permit.appointment, []);
  Object.assign(permit.preparation.identification, { serviceProvider: 'Empresa Demo', workFront: 'Frente ilustrativa', riskAnalysisReference: 'AR ilustrativa', activityDescription: 'Descrição ilustrativa da atividade.' });
  return permit;
}

function context(changes: Partial<PermitGuidanceContext> = {}): PermitGuidanceContext {
  return { authorizedActions: [...allActions], operator: true, reviewer: false, preparationDirty: false, checklistDirty: false, closingDirty: false, summaryDirty: false, busy: false, stale: false, coverage: 'covered', ...changes };
}

function correction(): WorkPermitDto {
  const permit = example();
  permit.operationStatus = 'COMPLETED';
  permit.version = 2;
  permit.sciences[0].version = 2;
  permit.snapshots = [{ version: 1, submittedAt: '2026-10-20T13:00:00Z', summary: 'Registro preservado da atividade.', checklist: [], sciences: [], decision: 'RETURN' }];
  return permit;
}

describe('orientação de leitura da próxima seção da PT', () => {
  it('prioriza pendências salvas da preparação, do checklist, dos requisitos, das ciências e da designação', () => {
    const permit = example();
    permit.preparation!.identification.activityDescription = '';
    permit.checklist[0].answer = null;
    permit.eligibility.eligible = false;
    permit.sciences = [];
    const state = context({ coverage: 'blocked' });
    expect(permitGuidance(permit, state).target).toBe('preparacao');
    permit.preparation!.identification.activityDescription = 'Atividade ilustrativa.';
    expect(permitGuidance(permit, state).target).toBe('conferencia');
    permit.checklist[0].answer = 'YES';
    expect(permitGuidance(permit, state).target).toBe('requisitos');
    permit.eligibility.eligible = true;
    expect(permitGuidance(permit, state).target).toBe('ciencias');
    permit.sciences = example().sciences;
    expect(permitGuidance(permit, state).target).toBe('designacao');
    state.coverage = 'covered';
    expect(permitGuidance(permit, state).target).toBe('operacao');
  });

  it.each([
    { answer: 'NO' as const, blockingAnswers: undefined },
    { answer: 'YES' as const, blockingAnswers: ['YES' as const] },
    { answer: 'YES' as const, blockingAnswers: ['YES' as const], required: false },
  ])('mantém impeditivas as respostas justificadas conforme o template: %j', changes => {
    const permit = example();
    permit.checklist[0] = { ...permit.checklist[0], ...changes, note: 'Resposta justificada para conferência.' };
    const result = permitGuidance(permit, context());
    expect(result.target).toBe('conferencia');
    expect(result.description).toMatch(/justificativa salva não elimina/);
  });

  it('não inventa impedimento para resposta observacional sem resposta bloqueadora', () => {
    const permit = example();
    permit.checklist[0] = { ...permit.checklist[0], answer: 'NO', note: 'Observação informativa do template.', blockingAnswers: [] };
    expect(permitGuidance(permit, context()).target).toBe('operacao');
  });

  it('aponta a justificativa ausente mesmo quando a resposta não é impeditiva', () => {
    const permit = example();
    permit.checklist[0] = { ...permit.checklist[0], answer: 'NO', blockingAnswers: [] };
    expect(permitGuidance(permit, context()).target).toBe('conferencia');
  });

  it('não conta ciência de outra versão nem de pessoa fora da equipe como ciência atual', () => {
    const permit = example();
    permit.sciences[0].version = 0;
    permit.sciences.push({ ...permit.sciences[0], id: 'outside', workerId: 'outside', version: 1 });
    const result = permitGuidance(permit, context());
    expect(result.target).toBe('ciencias');
    expect(result.description).toMatch(/versões anteriores não atendem/);
  });

  it.each(['pending', 'unavailable', 'blocked'] as const)('não aponta controles operacionais sem cobertura confirmada: %s', coverage => {
    const result = permitGuidance(example(), context({ coverage }));
    expect(result.target).toBe('designacao');
    expect(result.title).not.toMatch(/liber/);
    expect(result.description).not.toMatch(/conferências consultadas não apontaram/);
  });

  it('trata ausência de availableActions como consulta, mesmo com perfil e ações fornecidas pelo contexto', () => {
    const permit = example();
    Reflect.deleteProperty(permit, 'availableActions');
    const result = permitGuidance(permit, context());
    expect(result.title).toBe('Acompanhe a liberação');
    expect(result.description).toContain('Técnico Demo');
    expect(result.description).not.toMatch(/confirmação específica/);
  });

  it.each([
    { operator: false, authorizedActions: allActions },
    { operator: true, authorizedActions: [] },
  ])('não sugere ação operacional sem perfil e autorização correspondentes: %j', changes => {
    const result = permitGuidance(example(), context(changes));
    expect(result.title).toBe('Acompanhe a liberação');
    expect(result.description).toContain('responsável operacional');
    expect(result.description).not.toMatch(/salve|registre|conclua|confirmação específica/i);
  });

  it('consulta com pendência mostra a seção e seu responsável, sem instruir edição', () => {
    const permit = example();
    permit.preparation!.identification.serviceProvider = '';
    const result = permitGuidance(permit, context({ operator: false, reviewer: true }));
    expect(result.target).toBe('preparacao');
    expect(result.description).toMatch(/Acompanhe com Técnico Demo/);
    expect(result.description).not.toMatch(/salve|edite|preencha/);
  });

  it('registro em andamento e versão desatualizada têm prioridade sobre rascunhos e conferências salvas', () => {
    const permit = example();
    const state = context({ busy: true, stale: true, preparationDirty: true, checklistDirty: true });
    expect(permitGuidance(permit, state)).toMatchObject({ target: 'preparacao', title: 'Registro em andamento' });
    state.busy = false;
    expect(permitGuidance(permit, state).title).toBe('Confira a versão atual');
    state.stale = false;
    expect(permitGuidance(permit, state).title).toBe('Confira o rascunho antes de continuar');
  });

  it.each([
    { preparationDirty: true, target: 'preparacao' },
    { checklistDirty: true, target: 'conferencia' },
    { closingDirty: true, target: 'encerramento' },
    { summaryDirty: true, target: 'encerramento' },
  ])('aponta o rascunho local antes de inferir o próximo passo: %j', ({ target, ...changes }) => {
    const result = permitGuidance(example(), context(changes));
    expect(result.target).toBe(target);
    expect(result.description).toMatch(/alterações locais ainda não enviadas/);
  });

  it('rascunho preservado após perda de ação não sugere salvar conteúdo', () => {
    const result = permitGuidance(example(), context({ preparationDirty: true, operator: false }));
    expect(result.title).toBe('Rascunho local preservado');
    expect(result.description).not.toMatch(/ação de salvar|salve/);
  });

  it('separa liberação registrada do início e confere requisitos antes de apontar o início', () => {
    const permit = example();
    permit.operationStatus = 'RELEASED';
    expect(permitGuidance(permit, context())).toMatchObject({ target: 'operacao', title: 'Confira o registro de início' });
    expect(permitGuidance(permit, context()).description).toMatch(/execução ainda não foi iniciada/);
    permit.eligibility.eligible = false;
    expect(permitGuidance(permit, context()).target).toBe('requisitos');
  });

  it('execução em consulta acompanha o responsável, enquanto operador consulta o encerramento', () => {
    const permit = example();
    permit.operationStatus = 'EXECUTING';
    expect(permitGuidance(permit, context())).toMatchObject({ target: 'encerramento', title: 'Prepare o registro do encerramento' });
    const result = permitGuidance(permit, context({ operator: false }));
    expect(result.title).toBe('Acompanhe a execução');
    expect(result.description).toMatch(/responsável operacional/);
    expect(result.description).not.toMatch(/conclua|envie/);
  });

  it('suspensão explica a conferência de retomada sem tratar o atalho como confirmação', () => {
    const permit = example();
    permit.operationStatus = 'SUSPENDED';
    const result = permitGuidance(permit, context());
    expect(result.target).toBe('interrupcao');
    expect(result.description).toMatch(/documentação, da equipe e das condições/);
    const readOnly = permitGuidance(permit, context({ authorizedActions: [] }));
    expect(readOnly.description).toMatch(/eventual retomada com Técnico Demo/);
    expect(readOnly.description).not.toMatch(/confirmação específica/);
  });

  it('cancelamento continua em consulta apesar de eventuais pendências da conferência', () => {
    const permit = example();
    permit.operationStatus = 'CANCELED';
    permit.preparation!.identification.serviceProvider = '';
    const result = permitGuidance(permit, context());
    expect(result).toMatchObject({ target: 'interrupcao', title: 'PT cancelada' });
    expect(result.description).not.toMatch(/liberar|iniciar|retomar|conclua/);
  });

  it('revisão exige ação e perfil; operador não é inferido como revisor', () => {
    const permit = example();
    permit.operationStatus = 'COMPLETED';
    permit.reviewStatus = 'PENDING_REVIEW';
    expect(permitGuidance(permit, context()).title).toBe('Acompanhe a revisão do encerramento');
    expect(permitGuidance(permit, context({ reviewer: true, operator: false })).title).toBe('Confira o encerramento para revisão');
    permit.availableActions = [];
    expect(permitGuidance(permit, context({ reviewer: true, operator: false })).title).toBe('Acompanhe a revisão do encerramento');
  });

  it.each(['PENDING_REVIEW', 'RETURNED', 'VALIDATED', 'NOT_SUBMITTED'] as const)('revisão %s nunca reabre a operação nem representa aprovação retroativa', reviewStatus => {
    const permit = example();
    permit.operationStatus = 'COMPLETED';
    permit.reviewStatus = reviewStatus;
    permit.preparation!.identification.serviceProvider = '';
    const result = permitGuidance(permit, context({ reviewer: true }));
    expect(['revisao', 'encerramento']).toContain(result.target);
    expect(result.description).toMatch(/operação permanece concluída/);
    expect(result.description).toMatch(/não autoriza retrospectivamente/);
  });

  it('devolução instrui consultar o motivo antes da criação documental, somente com a ação correspondente', () => {
    const permit = example();
    permit.operationStatus = 'COMPLETED';
    permit.reviewStatus = 'RETURNED';
    expect(permitGuidance(permit, context()).description).toMatch(/antes de criar uma versão de correção documental/);
    expect(permitGuidance(permit, context({ authorizedActions: [] })).description).not.toMatch(/antes de criar/);
  });

  it('correção documental confere preparação, checklist e ciências atuais sem exigir cobertura operacional', () => {
    const permit = correction();
    permit.preparation!.identification.activityDescription = '';
    permit.checklist[0].answer = 'NO';
    permit.checklist[0].note = 'Impedimento ilustrativo registrado.';
    permit.sciences[0].version = 1;
    const state = context({ coverage: 'unavailable' });
    expect(permitGuidance(permit, state).target).toBe('preparacao');
    permit.preparation!.identification.activityDescription = 'Descrição ilustrativa.';
    expect(permitGuidance(permit, state).target).toBe('conferencia');
    permit.checklist[0].answer = 'YES';
    expect(permitGuidance(permit, state).target).toBe('ciencias');
    permit.sciences[0].version = 2;
    expect(permitGuidance(permit, state).target).toBe('encerramento');
    expect(permitGuidance(permit, state).description).toMatch(/operação permanece concluída/);
  });

  it('não oferece reapresentação de correção pela existência da versão sem a ação recebida', () => {
    const permit = correction();
    permit.availableActions = ['START', 'RELEASE'];
    const result = permitGuidance(permit, context());
    expect(result).toMatchObject({ target: 'encerramento', title: 'Acompanhe a correção documental' });
    expect(result.description).not.toMatch(/antes da reapresentação|registrar o início|liberação da atividade/);
  });

  it('não modifica o registro nem o contexto e fornece apenas texto e destino de leitura', () => {
    const permit = example();
    const state = context();
    const previous = structuredClone({ permit, state });
    const result = permitGuidance(permit, state);
    expect({ permit, state }).toEqual(previous);
    expect(Object.keys(result).sort()).toEqual(['description', 'linkLabel', 'target', 'title']);
    expect(result.linkLabel).toBe('Ver liberação e execução');
    expect(result.description).toMatch(/este resumo não autoriza a execução/);
  });
});

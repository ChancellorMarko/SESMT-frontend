import type { WorkPermitDto } from '../../shared/contracts/work-permits';
import { validatePreparation } from './templates/ri-s-36001';
import { validateChecklist } from './validation';

export type PermitSectionId = 'preparacao' | 'conferencia' | 'requisitos' | 'ciencias' | 'designacao' | 'operacao' | 'interrupcao' | 'encerramento' | 'revisao' | 'anexos' | 'historico';

export interface PermitGuidanceContext {
  authorizedActions: string[];
  operator: boolean;
  reviewer: boolean;
  preparationDirty: boolean;
  checklistDirty: boolean;
  closingDirty: boolean;
  summaryDirty: boolean;
  busy: boolean;
  stale: boolean;
  coverage: 'pending' | 'unavailable' | 'blocked' | 'covered';
}

export interface PermitGuidance {
  title: string;
  description: string;
  target: PermitSectionId;
  linkLabel: string;
}

const sectionLabels: Record<PermitSectionId, string> = {
  preparacao: 'Ver preparação', conferencia: 'Ver checklist', requisitos: 'Ver requisitos',
  ciencias: 'Ver ciências', designacao: 'Ver designação', operacao: 'Ver liberação e execução',
  interrupcao: 'Ver interrupção', encerramento: 'Ver encerramento', revisao: 'Ver revisão e versões',
  anexos: 'Ver anexos', historico: 'Ver histórico',
};

/** Reading guidance only. The command controls and the API remain responsible for authorization. */
export function permitGuidance(permit: WorkPermitDto, context: PermitGuidanceContext): PermitGuidance {
  const actions = Array.isArray(permit.availableActions) ? permit.availableActions : [];
  const has = (action: string) => actions.includes(action) && context.authorizedActions.includes(action)
    && (action === 'REVIEW' ? context.reviewer : context.operator);
  const guidance = (target: PermitSectionId, title: string, description: string): PermitGuidance => ({ target, title, description, linkLabel: sectionLabels[target] });
  const responsible = permit.appointment.responsibleName || 'o responsável operacional';
  const accompany = `Acompanhe com ${responsible}, responsável operacional desta PT.`;
  const statusTarget: PermitSectionId = permit.operationStatus === 'COMPLETED' ? 'revisao'
    : permit.operationStatus === 'CANCELED' || permit.operationStatus === 'SUSPENDED' ? 'interrupcao'
      : permit.operationStatus === 'EXECUTING' ? 'encerramento' : 'operacao';
  const dirtyTarget: PermitSectionId | undefined = context.preparationDirty ? 'preparacao'
    : context.checklistDirty ? 'conferencia' : context.closingDirty || context.summaryDirty ? 'encerramento' : undefined;

  if (context.busy) return guidance(dirtyTarget || statusTarget, 'Registro em andamento', 'Aguarde a confirmação da ação antes de continuar ou mudar de tela.');
  if (context.stale) return guidance(dirtyTarget || statusTarget, 'Confira a versão atual', 'Os dados da PT mudaram. Confira a versão atual e os rascunhos preservados antes de usar as ações exibidas na tela.');
  if (dirtyTarget) {
    const canSave = dirtyTarget === 'preparacao' ? has('EDIT_PREPARATION')
      : dirtyTarget === 'conferencia' ? has('EDIT_CHECKLIST') : has('COMPLETE') || has('SUBMIT_CORRECTION');
    return guidance(dirtyTarget, canSave ? 'Confira o rascunho antes de continuar' : 'Rascunho local preservado', canSave
      ? 'Há alterações locais ainda não enviadas. Confira os campos e use a ação de salvar ou enviar desta seção para registrar o conteúdo.'
      : `Há alterações locais ainda não enviadas. Confira o conteúdo preservado e as ações atualmente disponíveis. ${accompany}`);
  }

  if (permit.operationStatus === 'CANCELED') return guidance('interrupcao', 'PT cancelada', `Consulte o motivo e os registros preservados do cancelamento. ${accompany}`);

  if (permit.operationStatus === 'COMPLETED') {
    const documentary = 'A operação permanece concluída; a revisão trata do registro documental e não autoriza retrospectivamente a execução.';
    if (permit.reviewStatus === 'PENDING_REVIEW') return guidance('revisao', has('REVIEW') ? 'Confira o encerramento para revisão' : 'Acompanhe a revisão do encerramento', has('REVIEW')
      ? `Consulte a versão enviada, o resumo e os registros antes de registrar uma decisão na seção de revisão. ${documentary}`
      : `O encerramento enviado aguarda o responsável pela revisão. ${documentary}`);
    if (permit.reviewStatus === 'RETURNED') return guidance('revisao', 'Confira o motivo da devolução', has('NEW_VERSION')
      ? `Consulte as observações da revisão antes de criar uma versão de correção documental na seção de encerramento. ${documentary}`
      : `Acompanhe a correção com ${responsible} e consulte as observações da revisão. ${documentary}`);
    if (permit.reviewStatus === 'VALIDATED') return guidance('revisao', 'Encerramento revisado', `Consulte a decisão, as versões preservadas e os documentos disponíveis. ${documentary}`);
    const correction = permit.snapshots.length > 0 && permit.version > Math.max(...permit.snapshots.map(snapshot => snapshot.version));
    if (correction) {
      if (permit.preparation && validatePreparation(permit.preparation, true)) return guidance('preparacao', 'Confira a preparação da correção', `${has('EDIT_PREPARATION') ? 'Confira as pendências do conteúdo desta versão documental.' : accompany} ${documentary}`);
      if (validateChecklist(permit.checklist) || hasBlockingAnswer(permit)) return guidance('conferencia', 'Confira o checklist da correção', `${has('EDIT_CHECKLIST') ? 'Confira as respostas, as justificativas e os itens impeditivos da versão documental atual.' : accompany} ${documentary}`);
      if (missingSciences(permit)) return guidance('ciencias', 'Ciências da correção pendentes', `A versão documental atual ainda possui participantes sem ciência registrada nesta versão. ${has('COLLECT_SCIENCE') ? 'Consulte as declarações e os controles de registro desta seção.' : accompany} ${documentary}`);
      return guidance('encerramento', has('SUBMIT_CORRECTION') ? 'Confira a correção para reapresentação' : 'Acompanhe a correção documental', `${has('SUBMIT_CORRECTION') ? 'Confira o resumo e o checklist de encerramento antes da reapresentação para revisão.' : accompany} ${documentary}`);
    }
    return guidance('encerramento', 'Consulte o encerramento registrado', `Confira o resumo e a situação documental desta PT. ${documentary}`);
  }

  if (permit.operationStatus === 'SUSPENDED') return guidance('interrupcao', 'Operação suspensa', has('RESUME')
    ? 'Consulte o motivo da suspensão. Uma retomada exige a conferência vigente da documentação, da equipe e das condições, além da confirmação específica nesta seção.'
    : `Consulte o motivo e acompanhe a conferência das condições para eventual retomada com ${responsible}.`);

  if (permit.operationStatus === 'EXECUTING') return guidance('encerramento', has('COMPLETE') ? 'Prepare o registro do encerramento' : 'Acompanhe a execução', has('COMPLETE')
    ? 'Confira o checklist de encerramento e o resumo do atendimento antes de concluir a atividade e enviar o registro para revisão.'
    : `A execução está em andamento. O encerramento é registrado pelo responsável operacional. ${accompany}`);

  // These are saved-data checks, not a release decision. Coverage is also checked before pointing to operation controls.
  if (permit.preparation && validatePreparation(permit.preparation, true)) return guidance('preparacao', 'Preparação com pendências', has('EDIT_PREPARATION')
    ? 'Confira o preenchimento do modelo e salve as alterações antes de continuar a conferência.'
    : `Consulte as pendências do modelo. ${accompany}`);
  if (validateChecklist(permit.checklist)) return guidance('conferencia', 'Checklist com pendências', has('EDIT_CHECKLIST')
    ? 'Confira as respostas obrigatórias e as justificativas antes de salvar o checklist.'
    : `Consulte as respostas e justificativas pendentes. ${accompany}`);
  if (hasBlockingAnswer(permit)) return guidance('conferencia', 'Checklist com resposta impeditiva', `Consulte os itens impeditivos nas condições dos templates desta versão. Uma justificativa salva não elimina o impedimento. ${accompany}`);
  if (!permit.eligibility.eligible) return guidance('requisitos', 'Requisitos documentais pendentes', `Consulte a situação de cada participante. O envio de um arquivo não significa conferência ou liberação. ${accompany}`);
  if (missingSciences(permit)) return guidance('ciencias', 'Ciências desta versão pendentes', has('COLLECT_SCIENCE')
    ? 'Confira os participantes sem declaração na versão atual e os controles de registro desta seção. Ciências de versões anteriores não atendem esta versão.'
    : `Acompanhe as declarações da versão atual com ${responsible}. Ciências de versões anteriores não atendem esta versão.`);
  if (context.coverage !== 'covered') return guidance('designacao', context.coverage === 'pending' ? 'Conferindo a designação' : context.coverage === 'blocked' ? 'Designação com pendências' : 'Designação indisponível para conferência', context.coverage === 'pending'
    ? 'Aguarde a consulta e confira a cobertura do responsável para os serviços e o local desta PT.'
    : context.coverage === 'blocked'
      ? `Consulte os serviços e as condições sem cobertura vigente. ${accompany}`
      : `Não foi possível confirmar a cobertura vigente. Consulte a seção de designação e tente atualizar a conferência. ${accompany}`);
  if (permit.operationStatus === 'RELEASED') return guidance('operacao', has('START') ? 'Confira o registro de início' : 'Acompanhe o início da execução', has('START')
    ? 'A liberação está registrada. Confira as condições e a confirmação específica para registrar o início; a execução ainda não foi iniciada.'
    : `A liberação está registrada e o início ainda não consta nesta PT. ${accompany}`);
  return guidance('operacao', has('RELEASE') ? 'Confira a liberação da atividade' : 'Acompanhe a liberação', has('RELEASE')
    ? 'As conferências consultadas não apontaram pendências. Confira as condições e a confirmação específica na seção de liberação; este resumo não autoriza a execução.'
    : `Consulte a situação e as ações disponíveis para a PT. ${accompany}`);
}

function missingSciences(permit: WorkPermitDto) {
  return permit.appointment.participants.some(participant => !permit.sciences.some(science => science.workerId === participant.workerId && science.version === permit.version));
}

function hasBlockingAnswer(permit: WorkPermitDto) {
  return permit.checklist.some(item => item.answer !== null && (item.blockingAnswers ?? (item.required ? ['NO'] : [])).includes(item.answer));
}

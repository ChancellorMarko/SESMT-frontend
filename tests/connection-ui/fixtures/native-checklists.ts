import type { NativeTemplate } from '../../../src/features/native-permits/checklists';
import { permitIds } from './native-permits';

// Controlled template examples; no regulatory checklist is inferred by the UI.
export const checklistIds = { ...permitIds, template: '6a000000-0000-4000-8000-000000000001', laterVersion: '6a000000-0000-4000-8000-000000000002',
  boolean: '6b000000-0000-4000-8000-000000000001', number: '6b000000-0000-4000-8000-000000000002', text: '6b000000-0000-4000-8000-000000000003',
  closingBoolean: '6c000000-0000-4000-8000-000000000001', closingNumber: '6c000000-0000-4000-8000-000000000002', closingText: '6c000000-0000-4000-8000-000000000003' };
const ids = checklistIds;
export function templateFixture(): NativeTemplate {
  return { id: ids.templateVersion, templateId: ids.template, companyId: ids.company, nome: 'Manutenção em altura', versao: 2,
    servicoIds: [ids.service], serviceCodes: ['ALTURA'], ilustrativo: true, declaracao: 'Declaração do modelo fixado.',
    perguntas: [
      { id: ids.boolean, texto: 'Isolamento realizado?', tipo: 'BOOLEAN', obrigatoria: true, impeditiva: true },
      { id: ids.number, texto: 'Medição registrada', tipo: 'NUMBER', obrigatoria: false, impeditiva: false },
      { id: ids.text, texto: 'Condições observadas', tipo: 'TEXT', obrigatoria: false, impeditiva: false },
    ], closingQuestions: [
      { id: ids.closingBoolean, texto: 'Área conferida após o serviço?', tipo: 'BOOLEAN', obrigatoria: true, impeditiva: true },
      { id: ids.closingNumber, texto: 'Quantidade conferida', tipo: 'NUMBER', obrigatoria: true, impeditiva: false },
      { id: ids.closingText, texto: 'Condição final', tipo: 'TEXT', obrigatoria: true, impeditiva: false },
    ] };
}
export function laterTemplateFixture(): NativeTemplate { return { ...templateFixture(), id: ids.laterVersion, versao: 3,
  perguntas: [{ ...templateFixture().perguntas[0], texto: 'Pergunta da versão posterior' }] }; }

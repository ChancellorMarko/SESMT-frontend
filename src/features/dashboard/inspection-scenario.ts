export type InspectionPriority = 'high' | 'medium' | 'low';
export type InspectionActionStatus = 'planned' | 'in-progress' | 'resolved';

export interface InspectionFinding {
  id: string;
  inspectionId: string;
  title: string;
  area: string;
  location: string;
  owner: string;
  priority: InspectionPriority;
  status: InspectionActionStatus;
  deadline: string;
  observation: string;
  nextStep: string;
}

export interface InspectionVisit {
  id: string;
  title: string;
  area: string;
  owner: string;
  schedule: string;
  status: 'completed' | 'in-progress';
  checkedItems: number;
  totalItems: number;
  reinspection?: string;
}

// Synthetic interface examples. These are never selected-unit records or technical assessments.
export const inspectionVisits: InspectionVisit[] = [
  { id: 'VIS-DEMO-01', title: 'Ronda de máquinas e equipamentos', area: 'Manutenção', owner: 'Equipe de manutenção', schedule: 'Hoje · 09h30', status: 'completed', checkedItems: 18, totalItems: 18, reinspection: 'Em 3 dias · 10h' },
  { id: 'VIS-DEMO-02', title: 'Circulação e armazenamento', area: 'Logística', owner: 'Equipe de logística', schedule: 'Ontem · 14h', status: 'completed', checkedItems: 14, totalItems: 14, reinspection: 'Amanhã · 08h30' },
  { id: 'VIS-DEMO-03', title: 'Verificação dos postos de trabalho', area: 'Produção', owner: 'Equipe de segurança', schedule: 'Hoje · 14h', status: 'in-progress', checkedItems: 8, totalItems: 16 },
  { id: 'VIS-DEMO-04', title: 'Ronda de apoio e utilidades', area: 'Utilidades', owner: 'Equipe de infraestrutura', schedule: 'Hoje · 08h', status: 'completed', checkedItems: 12, totalItems: 12 },
];

export const inspectionFindings: InspectionFinding[] = [
  { id: 'ACH-DEMO-01', inspectionId: 'VIS-DEMO-01', title: 'Proteção de transmissão', area: 'Manutenção', location: 'Bancada de manutenção', owner: 'Equipe de manutenção', priority: 'high', status: 'in-progress', deadline: 'Hoje', observation: 'O cenário simula uma proteção que precisa de conferência no conjunto de transmissão.', nextStep: 'Registrar a avaliação da equipe responsável e as evidências da correção para a reinspeção.' },
  { id: 'ACH-DEMO-02', inspectionId: 'VIS-DEMO-01', title: 'Identificação de ferramentas', area: 'Manutenção', location: 'Armário de ferramentas', owner: 'Equipe de manutenção', priority: 'medium', status: 'planned', deadline: 'Em 3 dias', observation: 'O exemplo apresenta ferramentas sem identificação visual no local de armazenamento.', nextStep: 'Conferir a organização com a equipe e preparar o registro da melhoria.' },
  { id: 'ACH-DEMO-03', inspectionId: 'VIS-DEMO-02', title: 'Passagem entre prateleiras', area: 'Logística', location: 'Corredor de expedição', owner: 'Equipe de logística', priority: 'high', status: 'in-progress', deadline: 'Amanhã', observation: 'Materiais ocupam parte da passagem no cenário ilustrativo de circulação.', nextStep: 'Conferir a organização da passagem e apresentar as evidências na visita de retorno.' },
  { id: 'ACH-DEMO-04', inspectionId: 'VIS-DEMO-02', title: 'Organização do ponto de coleta', area: 'Logística', location: 'Doca de recebimento', owner: 'Equipe de logística', priority: 'low', status: 'resolved', deadline: 'Concluído no exemplo', observation: 'O exemplo registra a reorganização de um ponto de coleta.', nextStep: 'Consultar o registro ilustrativo da vistoria.' },
  { id: 'ACH-DEMO-05', inspectionId: 'VIS-DEMO-03', title: 'Ajuste do posto de embalagem', area: 'Produção', location: 'Linha de embalagem', owner: 'Equipe de produção', priority: 'medium', status: 'planned', deadline: 'Em 5 dias', observation: 'A ronda em andamento simula uma solicitação de avaliação do posto de embalagem.', nextStep: 'Encaminhar a observação à equipe responsável para avaliação e definição da ação.' },
  { id: 'ACH-DEMO-06', inspectionId: 'VIS-DEMO-04', title: 'Identificação do painel de apoio', area: 'Utilidades', location: 'Sala de apoio', owner: 'Equipe de infraestrutura', priority: 'low', status: 'planned', deadline: 'Em 7 dias', observation: 'O cenário apresenta uma identificação visual que precisa ser revisada.', nextStep: 'Conferir a identificação com a equipe de infraestrutura e registrar a atualização.' },
];

export const inspectionPriorityLabel: Record<InspectionPriority, string> = { high: 'Alta', medium: 'Média', low: 'Baixa' };
export const inspectionStatusLabel: Record<InspectionActionStatus, string> = { planned: 'A programar', 'in-progress': 'Em andamento', resolved: 'Concluída' };

export function getInspectionSummary(findings = inspectionFindings, visits = inspectionVisits) {
  const openFindings = findings.filter(finding => finding.status !== 'resolved');
  const byArea = visits.map(visit => ({ area: visit.area, count: openFindings.filter(finding => finding.area === visit.area).length }));
  return {
    openFindings,
    byArea,
    visitCount: visits.length,
    inProgressCount: openFindings.filter(finding => finding.status === 'in-progress').length,
    reinspections: visits.filter(visit => visit.reinspection),
  };
}

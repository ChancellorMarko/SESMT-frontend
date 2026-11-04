/** Visual demonstration only. These figures are not API data or an SST assessment. */
export const safetyScenario = {
  daysWithoutAccidents: 128,
  epiDelivered: 92,
  epiExpected: 100,
  upcomingExpirations: 7,
  inspectionBacklog: 3,
};

export type SafetyArea = 'inspecoes' | 'saude' | 'epis';
export type SafetyPriority = 'critical' | 'attention' | 'routine';
export type SafetyOccurrence = {
  id: string;
  area: SafetyArea;
  title: string;
  description: string;
  location: string;
  category: string;
  initials: string;
  team: string;
  priority: SafetyPriority;
  detail: string;
};

export const safetyOccurrences: SafetyOccurrence[] = [
  {
    id: 'CEN-01', area: 'inspecoes', title: 'Proteção de máquina a conferir',
    description: 'Uma vistoria preventiva identificou um ponto para avaliação da equipe de segurança.',
    location: 'Área de manutenção', category: 'Vistoria preventiva', initials: 'VS', team: 'Vistorias de segurança',
    priority: 'critical', detail: 'Ocorrência prioritária para acompanhamento. A verificação técnica, as medidas de controle e qualquer autorização operacional pertencem aos responsáveis e ao fluxo real de inspeções.',
  },
  {
    id: 'CEN-02', area: 'saude', title: 'Próximo ciclo de renovações',
    description: 'ASOs e capacitações entram na janela de acompanhamento.',
    location: 'Planejamento ocupacional', category: 'ASO e treinamentos', initials: 'SO', team: 'Saúde ocupacional',
    priority: 'attention', detail: 'Exemplo agregado de planejamento com sete vencimentos em trinta dias. Não contém dados médicos, nomes ou informações individuais. Os prazos apresentados não foram consultados em documentos reais.',
  },
  {
    id: 'CEN-03', area: 'epis', title: 'Conferência de entrega de EPIs',
    description: 'O lote está pronto para acompanhamento de entrega e registro.',
    location: 'Almoxarifado', category: 'Controle de EPIs', initials: 'EP', team: 'Equipe de proteção',
    priority: 'routine', detail: 'Exemplo de conferência de 92 entregas entre cem previstas. Nenhum termo foi emitido, assinado ou alterado. A disponibilidade de um EPI não comprova aptidão para uma atividade.',
  },
];

export const safetyPriorityLabels: Record<SafetyPriority, string> = {
  critical: 'Prioridade alta', attention: 'Acompanhar prazo', routine: 'Rotina preventiva',
};

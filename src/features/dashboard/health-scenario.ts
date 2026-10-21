/** Agregados fictícios de interface. Não representam cadastros nem regras normativas. */
export interface HealthExample {
  id: string;
  title: string;
  team: string;
  quantity: number;
  unit: string;
  status: string;
  topic?: string;
  context: string;
  nextStep: string;
}

export const asoRenewalWindows = [
  { label: 'Data cadastrada ultrapassada', count: 2, note: 'Conferir renovação', tone: 'attention' },
  { label: 'Nos próximos 30 dias', count: 3, note: 'Preparar o próximo ciclo', tone: 'soon' },
  { label: 'Entre 31 e 60 dias', count: 1, note: 'Reservar no planejamento', tone: 'later' },
] as const;

export const asoReviewQueue: HealthExample[] = [
  { id: 'aso-identification', title: 'Conferir identificação do documento', team: 'Produção · equipe fictícia', quantity: 1, unit: 'arquivo', status: 'A conferir', context: 'O lote de exemplo contém um arquivo cujo cadastro ainda precisa de conferência administrativa.', nextStep: 'Comparar a identificação do arquivo com o cadastro e encaminhar a conferência ao responsável. Não há informação clínica neste exemplo.' },
  { id: 'aso-renewal-file', title: 'Vincular versão de renovação', team: 'Manutenção · equipe fictícia', quantity: 1, unit: 'arquivo', status: 'Versão a vincular', context: 'Uma renovação ilustrativa aguarda associação à versão anterior do documento.', nextStep: 'Localizar o arquivo atualizado e preservar o histórico documental. O acompanhamento local não altera documentos.' },
  { id: 'aso-receipt', title: 'Confirmar recebimento do arquivo', team: 'Apoio · equipe fictícia', quantity: 1, unit: 'arquivo', status: 'Recebimento pendente', context: 'Há uma solicitação fictícia de documento aguardando confirmação de recebimento.', nextStep: 'Conferir se o arquivo solicitado foi recebido e encaminhar para análise documental no fluxo adequado.' },
];

export const asoPlanningQueue: HealthExample[] = [
  { id: 'aso-exam-planning', title: 'Organizar solicitações de exames', team: 'Produção e manutenção · equipes fictícias', quantity: 4, unit: 'solicitações', status: 'A organizar', context: 'Quatro solicitações sintéticas aguardam organização: três da produção e uma da manutenção.', nextStep: 'Alinhar disponibilidade com o responsável pelo atendimento ocupacional. Esta tela demonstra planejamento e não agenda exames.' },
  { id: 'aso-schedule-confirmation', title: 'Confirmar datas com o atendimento', team: 'Apoio · equipe fictícia', quantity: 2, unit: 'agendamentos', status: 'A confirmar', context: 'Dois agendamentos fictícios ainda aguardam confirmação administrativa de data.', nextStep: 'Solicitar confirmação ao responsável e registrar a informação no sistema de atendimento quando houver integração. Nenhuma reserva é realizada aqui.' },
];

// Temas do catálogo em shared/lib/service-types.ts; os critérios ainda dependem da matriz homologada.
export const trainingTopics = ['Trabalho em altura', 'Espaço confinado', 'Eletricidade'] as const;
export const trainingMatrix = [
  { team: 'Manutenção', people: 6, evidence: [6, 4, 5] },
  { team: 'Operação', people: 4, evidence: [3, 3, 4] },
  { team: 'Apoio', people: 3, evidence: [1, 3, 3] },
] as const;

export const trainingPlanningQueue: HealthExample[] = [
  { id: 'training-maintenance', title: 'Planejar orientação da manutenção', team: 'Manutenção · equipe fictícia', quantity: 2, unit: 'vagas a planejar', status: 'Turma a organizar', topic: 'Espaço confinado', context: 'Dois registros referentes ao tema Espaço confinado ainda não estão disponíveis na matriz fictícia da manutenção.', nextStep: 'Conferir o escopo aplicável de espaço confinado com o responsável e organizar disponibilidade e documentação esperada para a turma. Não é uma inscrição nem uma confirmação de capacitação.' },
  { id: 'training-support', title: 'Organizar capacitação da equipe de apoio', team: 'Apoio · equipe fictícia', quantity: 2, unit: 'vagas a planejar', status: 'Escopo a conferir', topic: 'Trabalho em altura', context: 'Duas posições do cenário de apoio aguardam evidência referente ao tema Trabalho em altura.', nextStep: 'Conferir os critérios de trabalho em altura na matriz aplicável com o responsável antes de organizar a turma. A vinculação a NRs específicas depende da matriz homologada.' },
];

export const trainingRenewal: HealthExample = {
  id: 'training-renewal', title: 'Planejar renovação dos comprovantes', team: 'Manutenção e operação · equipes fictícias', quantity: 3, unit: 'comprovantes', status: 'Renovação a programar', context: 'Três dos 32 comprovantes disponíveis entram na janela de planejamento definida apenas para esta demonstração.', nextStep: 'Conferir o período cadastrado e a matriz aplicável com o responsável. O exemplo não estabelece validade legal nem prazo de NR.',
};

export const healthScenario = {
  asoRenewals: asoRenewalWindows.reduce((sum, item) => sum + item.count, 0),
  asoReviews: asoReviewQueue.reduce((sum, item) => sum + item.quantity, 0),
  examsToOrganize: asoPlanningQueue[0].quantity,
  appointmentsToConfirm: asoPlanningQueue[1].quantity,
  trainingEvidence: trainingMatrix.reduce((sum, row) => sum + row.evidence.reduce((total, value) => total + value, 0), 0),
  trainingExpected: trainingMatrix.reduce((sum, row) => sum + row.people * trainingTopics.length, 0),
  trainingGroups: trainingPlanningQueue.length,
  trainingRenewals: trainingRenewal.quantity,
};

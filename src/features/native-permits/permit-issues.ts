import type { NativePermit } from './contracts';

export type PermitIssue = { code: string; participantUserId: string | null; documentTypeId: string | null; serviceCode: string | null };
export type IssueLookups = { currentUserId?: string; userNames?: ReadonlyMap<string, string>; documentTypeNames?: ReadonlyMap<string, string>; serviceNames?: ReadonlyMap<string, string> };
export type DescribedIssue = { key: string; title: string; subject?: string; detail?: string; next: string; issue: PermitIssue };

export const issueLabels: Record<string, string> = {
  AGENDAMENTO_NAO_CONFIRMADO: 'Agendamento ou contexto pendente', CHECKLIST_PENDENTE: 'Checklist pendente', PARTICIPANTES_AUSENTES: 'Participantes ausentes',
  MATRIZ_AUSENTE: 'Matriz de requisitos ausente', SERVICOS_AUSENTES: 'Serviços ausentes', PARTICIPANTE_FORA_DO_CONTEXTO: 'Participante fora do contexto',
  CIENCIA_PENDENTE: 'Ciência pendente', DOCUMENTO_AUSENTE: 'Documento ausente', DOCUMENTO_REPROVADO: 'Documento reprovado',
  ASSINATURA_PENDENTE: 'Assinatura obrigatória pendente',
  AGUARDANDO_CONFERENCIA: 'Documento aguardando conferência', ARQUIVO_INDISPONIVEL: 'Arquivo indisponível', DOCUMENTO_FORA_DA_VALIDADE: 'Documento fora da validade',
};

// What the person can do next, using only flows that already exist in the system.
const nextSteps: Record<string, string> = {
  AGENDAMENTO_NAO_CONFIRMADO: 'Confirme o agendamento ou o contexto na agenda.',
  CHECKLIST_PENDENTE: 'Preencha e envie o checklist na seção Checklists.',
  PARTICIPANTES_AUSENTES: 'Inclua os participantes no agendamento.',
  MATRIZ_AUSENTE: 'Peça à configuração que cadastre a matriz de requisitos do serviço.',
  SERVICOS_AUSENTES: 'Informe os serviços no agendamento.',
  PARTICIPANTE_FORA_DO_CONTEXTO: 'Confira se a pessoa pertence à equipe e ao local do agendamento.',
  CIENCIA_PENDENTE: 'A própria pessoa registra a ciência na seção Ciência desta PT.',
  DOCUMENTO_AUSENTE: 'Cadastre o documento da pessoa em Documentos.',
  DOCUMENTO_REPROVADO: 'Envie uma nova versão do documento para conferência.',
  ASSINATURA_PENDENTE: 'Colha a assinatura obrigatória no documento.',
  AGUARDANDO_CONFERENCIA: 'Aguarde ou faça a conferência do documento.',
  ARQUIVO_INDISPONIVEL: 'Envie o arquivo do documento novamente.',
  DOCUMENTO_FORA_DA_VALIDADE: 'Cadastre uma versão vigente do documento.',
};

/** Names a pending item with what the session already knows. Unknown identifiers stay generic instead of guessed. */
export function describeIssues(issues: readonly PermitIssue[], permit: Pick<NativePermit, 'participants'>, lookups: IssueLookups = {}): DescribedIssue[] {
  const order = new Map(permit.participants.map((person, index) => [person.userId.toLowerCase(), index]));
  const person = (id: string | null) => {
    if (!id) return undefined;
    const key = id.toLowerCase(), index = order.get(key);
    const name = key === lookups.currentUserId?.toLowerCase() ? 'Você' : lookups.userNames?.get(key)
      ?? permit.participants[index ?? -1]?.acknowledgements?.at(-1)?.confirmedName;
    const fallback = index === undefined ? 'Pessoa fora da lista de participantes' : `Participante ${index + 1}`;
    const role = index === undefined ? undefined : permit.participants[index].responsibility;
    return { label: name ?? fallback, role };
  };
  return issues.map((issue, index) => {
    const who = person(issue.participantUserId);
    const documentType = issue.documentTypeId ? lookups.documentTypeNames?.get(issue.documentTypeId.toLowerCase()) ?? 'Tipo documental exigido' : undefined;
    const service = issue.serviceCode ? lookups.serviceNames?.get(issue.serviceCode) ?? issue.serviceCode : undefined;
    const detail = [documentType, service && `Serviço: ${service}`, who?.role].filter(Boolean).join(' · ') || undefined;
    return { key: `${index}:${issue.code}:${issue.participantUserId}:${issue.documentTypeId}:${issue.serviceCode}`, title: issueLabels[issue.code] ?? 'Pendência informada pela API',
      subject: who?.label, detail, next: nextSteps[issue.code] ?? 'Confira o detalhe com a equipe responsável.', issue };
  });
}


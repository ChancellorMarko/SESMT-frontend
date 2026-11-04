export const safetyTerms = [
  { acronym: 'ASO', name: 'Atestado de Saúde Ocupacional', aliases: 'ASOs atestados exames saúde ocupacional', description: 'Documento emitido a partir da avaliação de saúde ocupacional. No sistema, você acompanha o arquivo e as datas cadastradas.', context: 'Saúde ocupacional e documentos', detail: 'O ASO é o documento; o exame é a avaliação que dá origem a ele.' },
  { acronym: 'PT', name: 'Permissão de Trabalho', aliases: 'PTs permissões atendimento atividade', description: 'Registro usado na conferência e no acompanhamento de uma atividade de trabalho. No Ampara, tem fluxo próprio de atendimento, revalidação e encerramento.', context: 'Permissões de trabalho e consulta central', detail: 'Uma autorização de trabalho (AT) vinculada não libera a PT automaticamente.' },
  { acronym: 'AT', name: 'Autorização de Trabalho', aliases: 'ATs autorizações atendimento', description: 'No Ampara, AT identifica a Autorização de Trabalho, um registro com fluxo próprio que pode ser vinculado a uma permissão de trabalho (PT).', context: 'Autorizações de trabalho e consulta central', detail: 'Autorizar uma AT não libera uma PT. Em outros contextos, a mesma sigla pode ter outro significado.' },
  { acronym: 'PET', name: 'Permissão de Entrada e Trabalho', aliases: 'PETs permissões espaço espaços confinado confinados entrada', description: 'Documento relacionado à entrada e ao trabalho em espaços confinados.', context: 'Preparações de entrada em espaços confinados', detail: 'Nesta versão do Ampara, a PET é um rascunho de preparação. A entrada não está autorizada.' },
  { acronym: 'NR', name: 'Norma Regulamentadora', aliases: 'NRs normas regulamentadoras capacitação capacitações treinamento treinamentos certificados', description: 'Norma com requisitos de segurança e saúde no trabalho. As normas são identificadas por número, como NR-06 e NR-33.', context: 'Capacitações, requisitos e documentos', detail: 'Uma capacitação pode se relacionar a uma NR. A norma e o comprovante de treinamento têm funções diferentes.' },
  { acronym: 'EPI', name: 'Equipamento de Proteção Individual', aliases: 'EPIs equipamentos proteção individual capacete luvas óculos', description: 'Equipamento de uso individual destinado à proteção do trabalhador contra riscos ocupacionais.', context: 'Área de proteção e documentos', detail: 'A área de proteção reúne o acompanhamento de equipamentos e comprovantes disponíveis no sistema.' },
  { acronym: 'CA', name: 'Certificado de Aprovação', aliases: 'CAs certificados aprovação equipamentos EPI EPIs', description: 'Identificação da aprovação de um equipamento de proteção individual (EPI).', context: 'Identificação de equipamentos de proteção', detail: 'CA identifica a aprovação do equipamento; o comprovante de entrega registra a entrega ao trabalhador.' },
  { acronym: 'PGR', name: 'Programa de Gerenciamento de Riscos', aliases: 'PGRs programas gerenciamento riscos documentos', description: 'Programa que organiza o gerenciamento dos riscos ocupacionais. Pode aparecer como tipo documental na gestão de documentos.', context: 'Documentos controlados' },
  { acronym: 'SESMT', name: 'Serviços Especializados em Segurança e Medicina do Trabalho', aliases: 'segurança medicina saúde equipe especializada', description: 'Serviços especializados que atuam na segurança e na saúde no trabalho. A sigla também faz parte da identidade Ampara SESMT.', context: 'Identidade e organização do sistema' },
] as const;

export type SafetyAcronym = typeof safetyTerms[number]['acronym'];

function normalize(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim();
}

export function searchSafetyTerms(query: string, related: readonly SafetyAcronym[] = []) {
  const acronym = normalize(query).replace(/s$/, '').toUpperCase();
  if (safetyTerms.some(term => term.acronym === acronym)) return safetyTerms.filter(term => term.acronym === acronym);
  const tokens = normalize(query).split(/[^a-z0-9]+/).filter(Boolean);
  return safetyTerms.filter(term => {
    const words = normalize(`${term.acronym} ${term.name} ${term.aliases}`).split(/[^a-z0-9]+/);
    return tokens.every(token => words.some(word => word.startsWith(token)));
  }).sort((a, b) => {
    const aIndex = related.indexOf(a.acronym), bIndex = related.indexOf(b.acronym);
    return (aIndex < 0 ? related.length : aIndex) - (bIndex < 0 ? related.length : bIndex);
  });
}

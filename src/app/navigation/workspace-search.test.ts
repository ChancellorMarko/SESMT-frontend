import { describe, expect, it } from 'vitest';
import { matchesWorkspaceSearch, normalizeWorkspaceSearch } from './workspace-search';

describe('busca de módulos do espaço de trabalho', () => {
  it('aceita acentos, caixa, espaços e pontuação sem exigir a digitação exata do rótulo', () => {
    expect(normalizeWorkspaceSearch('  INSPEÇÃO,   SEGURANÇA! ')).toBe('inspecao seguranca');
    expect(matchesWorkspaceSearch('  INSPEÇÃO, SEGURANÇA! ', 'Inspeções de segurança inspeção vistoria vistorias achados')).toBe(true);
    expect(matchesWorkspaceSearch('funções/cargos', 'Empresas, unidades e setores funções cargos')).toBe(true);
  });

  it.each([
    ['PTs', 'Permissão de Trabalho (PT)'],
    ['ATs', 'Autorização de Trabalho (AT)'],
    ['NRs', 'Treinamentos e Normas Regulamentadoras (NR)'],
    ['ASOs', 'Atestado de Saúde Ocupacional (ASO)'],
    ['EPIs', 'Equipamento de Proteção Individual (EPI)'],
    ['PETs', 'Permissão de Entrada e Trabalho (PET)'],
  ])('encontra a sigla plural %s sem depender de alias no destino', (query, destination) => {
    expect(matchesWorkspaceSearch(query, destination)).toBe(true);
    expect(matchesWorkspaceSearch(query.slice(0, -1), `${destination} ${query}`)).toBe(true);
  });

  it.each(['NR-35', 'nr35', 'NR 35', 'NR–35', 'NR_35', '(NR 01)'])('localiza capacitações por %s sem exigir um cadastro numerado no menu', query => {
    expect(normalizeWorkspaceSearch(query)).toBe('nr');
    expect(matchesWorkspaceSearch(query, 'Capacitações Treinamentos e Normas Regulamentadoras (NR)')).toBe(true);
    expect(matchesWorkspaceSearch(query, 'Notificações Avisos e atualizações da unidade')).toBe(false);
  });

  it('conserva os demais termos de uma busca por NR numerada', () => {
    expect(normalizeWorkspaceSearch('certificados (NR35)')).toBe('certificados nr');
    expect(matchesWorkspaceSearch('certificados NR 35', 'Capacitações NR NRs certificados turmas')).toBe(true);
    expect(matchesWorkspaceSearch('certificados inexistentes NR35', 'Capacitações NR NRs certificados turmas')).toBe(false);
  });

  it.each([
    ['renovar ASO', 'Saúde ocupacional ASO ASOs atestado atestados documentos exames renovar renovações'],
    ['certificados NR', 'Capacitações NR NRs normas regulamentadoras treinamentos certificados turmas'],
    ['normas regulamentadoras', 'Capacitações NR NRs normas regulamentadoras treinamentos'],
    ['capacetes', 'Proteção individual EPI EPIs equipamentos proteção individual capacetes luvas'],
    ['protecao individual', 'Proteção individual Equipamento de Proteção Individual (EPI)'],
    ['agend calend', 'Agenda agendamentos calendário planejamento'],
  ])('preserva a procura por %s', (query, destination) => {
    expect(matchesWorkspaceSearch(query, destination)).toBe(true);
  });

  it.each([
    ['PT', 'Apto aptidão documentos'],
    ['AT', 'Atestado de Saúde Ocupacional'],
    ['NR', 'Honra documentação'],
    ['ASO', 'Casos e ações'],
    ['EPI', 'Epidemiologia'],
    ['PET', 'Petições de trabalho'],
  ])('não confunde a sigla %s com outra palavra', (query, destination) => {
    expect(matchesWorkspaceSearch(query, destination)).toBe(false);
  });

  it('exige todos os termos, sem aproximação de grafia ou correspondência no meio da palavra', () => {
    expect(matchesWorkspaceSearch('agenda cancelada', 'Agenda agendamentos calendário planejamento')).toBe(false);
    expect(matchesWorkspaceSearch('agnda', 'Agenda agendamentos calendário planejamento')).toBe(false);
    expect(matchesWorkspaceSearch('tor', 'Setor cargos funções')).toBe(false);
  });

  it.each(['', '   ', '... / — !!!'])('trata uma busca sem palavras como a lista disponível (%s)', query => {
    expect(normalizeWorkspaceSearch(query)).toBe('');
    expect(matchesWorkspaceSearch(query, 'Agenda')).toBe(true);
  });

  it('não descarta números ou sufixos arbitrários para inventar uma correspondência de NR', () => {
    expect(normalizeWorkspaceSearch('NR350')).toBe('nr350');
    expect(normalizeWorkspaceSearch('NR 350')).toBe('nr 350');
    expect(normalizeWorkspaceSearch('NR35a')).toBe('nr35a');
    expect(matchesWorkspaceSearch('NR 350', 'Capacitações NR certificados')).toBe(false);
    expect(matchesWorkspaceSearch('NR35a', 'Capacitações NR certificados')).toBe(false);
  });

  it('não confunde outras palavras ou alfabetos com aliases nem com busca vazia', () => {
    expect(normalizeWorkspaceSearch('constructor')).toBe('constructor');
    expect(matchesWorkspaceSearch('constructor', 'Agenda Documentos')).toBe(false);
    expect(normalizeWorkspaceSearch('東京')).toBe('東京');
    expect(matchesWorkspaceSearch('東京', 'Agenda Documentos')).toBe(false);
  });
});

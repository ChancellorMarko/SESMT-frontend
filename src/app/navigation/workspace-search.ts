const acronymAliases = new Map([
  ['pts', 'pt'], ['ats', 'at'], ['nrs', 'nr'], ['asos', 'aso'], ['epis', 'epi'], ['pets', 'pet'],
]);
const acronyms = new Set(['pt', 'at', 'nr', 'aso', 'epi', 'pet']);

/** Normalize module terms only; an NR number is not a record or compliance lookup. */
export function normalizeWorkspaceSearch(value: string): string {
  const words = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').match(/[\p{L}\p{N}]+/gu) || [];
  const terms: string[] = [];
  for (let index = 0; index < words.length; index++) {
    const word = words[index];
    if (/^nr\d{1,2}$/.test(word)) { terms.push('nr'); continue; }
    const term = acronymAliases.get(word) || word;
    terms.push(term);
    // NR-35, NR 35 and punctuation variants all locate the NR module.
    if (term === 'nr' && /^\d{1,2}$/.test(words[index + 1] || '')) index++;
  }
  return terms.join(' ');
}

/** All search terms must match; abbreviations never match the middle of a word. */
export function matchesWorkspaceSearch(query: string, searchableText: string): boolean {
  const normalized = normalizeWorkspaceSearch(query);
  if (!normalized) return true;
  const words = normalizeWorkspaceSearch(searchableText).split(' ');
  return normalized.split(' ').every(term => words.some(word => acronyms.has(term) ? word === term : word.startsWith(term)));
}

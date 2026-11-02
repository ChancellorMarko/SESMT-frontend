export const petKey = (session: string, unit?: string, id?: string) => ['confined-space-permit', session, unit, id];
export function petError(error: unknown) {
  const value = error as { status?: number; message?: string };
  if (value?.status === 403) return 'Seu perfil não permite esta ação na preparação da PET.';
  if (value?.status === 404) return 'Preparação de PET não encontrada ou fora da unidade selecionada.';
  if ([412,428].includes(value?.status ?? 0)) return 'O rascunho mudou. Seu preenchimento foi preservado; confira a revisão atual antes de salvar novamente.';
  return value?.message || 'Não foi possível consultar a preparação da PET. Tente novamente.';
}
export function petPage(value:string|null) { const n=Number(value ?? 1); return Number.isSafeInteger(n)&&n>0?n:1; }
export const petEventLabels:Record<string,string>={PET_CREATED:'Preparação criada',PET_UPDATED:'Preparação atualizada',PET_DRAFT_CREATED:'Preparação criada',PET_DRAFT_UPDATED:'Preparação atualizada'};

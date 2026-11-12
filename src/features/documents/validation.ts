import { z } from 'zod';

export const documentStatuses = ['DRAFT', 'IN_REVIEW', 'APPROVED', 'ACTIVE', 'EXPIRED', 'SUPERSEDED', 'ARCHIVED'] as const;
export const statusLabels: Record<string, string> = {
  DRAFT: 'Rascunho', IN_REVIEW: 'Em revisão', APPROVED: 'Aprovado', ACTIVE: 'Vigente',
  EXPIRED: 'Vencido', SUPERSEDED: 'Substituído', ARCHIVED: 'Arquivado',
  PENDING: 'Em verificação', CLEAN: 'Liberado', REJECTED: 'Rejeitado', VERIFIED: 'Conferido', ERROR: 'Falha na verificação', UNKNOWN: 'Verificação não informada',
};
export const accessLabels: Record<string, string> = { PUBLIC: 'Público', INTERNAL: 'Interno', RESTRICTED: 'Restrito', MEDICAL: 'Médico' };

export function isCivilDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const optionalId = z.union([z.guid('Selecione uma opção válida.'), z.literal('')]);
const civilDate = z.string().refine(isCivilDate, 'Informe uma data válida.');
const optionalDate = z.union([civilDate, z.literal('')]);

const baseSchema = z.object({
  code: z.string().trim().min(1, 'Informe o código.').max(100, 'Use até 100 caracteres.'),
  title: z.string().trim().min(1, 'Informe o título.').max(240, 'Use até 240 caracteres.'),
  typeId: z.guid('Selecione o tipo documental.'),
  companyId: z.guid('Selecione a empresa.'),
  unitId: z.guid('Selecione a unidade.'),
  sectorId: optionalId,
  ownerId: z.guid('Selecione o proprietário.'),
  responsibleIds: z.array(z.guid()),
  workerIds: z.array(z.guid()),
  accessClass: z.enum(['INTERNAL', 'RESTRICTED', 'MEDICAL']),
  issueDate: civilDate,
  validFrom: optionalDate,
  validUntil: optionalDate,
  keywords: z.string().max(500, 'Use até 500 caracteres.'),
});

export type DocumentFields = z.infer<typeof baseSchema>;

export function metadataSchema(requiredFields: string[] = []) {
  return baseSchema.superRefine((values, ctx) => {
    if (values.validFrom && values.validUntil && values.validFrom > values.validUntil) {
      ctx.addIssue({ code: 'custom', path: ['validUntil'], message: 'A validade final deve ser igual ou posterior à inicial.' });
    }
    for (const name of requiredFields) {
      const value = values[name as keyof DocumentFields];
      if (value === '' || value === undefined || (Array.isArray(value) && value.length === 0)) {
        ctx.addIssue({ code: 'custom', path: [name], message: 'Campo obrigatório para este tipo documental.' });
      }
    }
  });
}

export function toDocumentWrite(values: DocumentFields) {
  return {
    ...values,
    sectorId: values.sectorId || undefined,
    validFrom: values.validFrom || undefined,
    validUntil: values.validUntil || undefined,
    keywords: values.keywords.split(',').map((keyword) => keyword.trim()).filter(Boolean),
  };
}

const mimeExtensions: Record<string, string[]> = {
  'application/pdf': ['pdf'], 'image/png': ['png'], 'image/jpeg': ['jpg', 'jpeg'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'],
  'application/msword': ['doc'], 'application/vnd.ms-excel': ['xls'],
  'text/csv': ['csv'], 'text/plain': ['txt'],
};

export function validateUpload(file: File | undefined, policy: { allowedMimeTypes: string[]; maxFileSizeBytes: number } | undefined): string | undefined {
  if (!file) return 'Selecione um arquivo.';
  if (!policy) return 'Aguarde o carregamento da política do tipo documental.';
  if (file.size === 0) return 'O arquivo está vazio.';
  if (file.size > policy.maxFileSizeBytes) return `O arquivo supera o limite de ${formatBytes(policy.maxFileSizeBytes)}.`;
  const extension = file.name.split('.').at(-1)?.toLowerCase();
  const allowedByExtension = policy.allowedMimeTypes.filter((mime) => mimeExtensions[mime]?.includes(extension ?? ''));
  if (allowedByExtension.length === 0 || (file.type && !allowedByExtension.includes(file.type))) return 'Formato não permitido pelo tipo documental.';
  return undefined;
}

export function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB` : `${Math.ceil(bytes / 1024)} KB`;
}
export function formatDate(value?: string | null): string {
  if (!value) return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value.split('-').reverse().join('/');
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
}

export function zonedDateTimeToIso(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match || !isCivilDate(value.slice(0, 10))) throw new Error('Informe data e hora válidas.');
  const [, y, m, d, h, min] = match.map(Number);
  if (h > 23 || min > 59) throw new Error('Informe data e hora válidas.');
  const target = Date.UTC(y, m - 1, d, h, min);
  let instant = target;
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((part) => [part.type, Number(part.value)]));
    const rendered = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    if (rendered === target) return new Date(instant).toISOString();
    instant += target - rendered;
  }
  throw new Error('Esse horário não está disponível no fuso de Brasília.');
}

export function errorMessage(error: unknown): string {
  const apiError = error as { message?: string; code?: string; status?: number } | undefined;
  if (apiError?.status === 412 || apiError?.code === 'REVISION_CONFLICT') return 'Este registro foi alterado por outra pessoa. Recarregue a página e confira os dados antes de enviar novamente.';
  return apiError?.message || 'Não foi possível concluir a operação. Tente novamente.';
}

import { z } from 'zod';
import type { DocumentTypeDto, MeDto, OrganizationDto, ScopeDto } from '../../shared/contracts';
import type { TeamDto } from '../../shared/contracts/work-permits';

export const knownDocumentFields = ['title', 'code', 'typeId', 'companyId', 'unitId', 'sectorId', 'ownerId', 'accessClass', 'issueDate', 'validFrom', 'validUntil', 'workerIds', 'responsibleIds', 'keywords'] as const;
export const documentTypeSchema = z.object({
  code: z.string().trim().min(2, 'Informe um código com pelo menos 2 caracteres.').max(40),
  name: z.string().trim().min(3, 'Informe o nome do tipo.').max(120),
  category: z.string().trim().min(2, 'Informe a categoria.').max(80),
  requiredFields: z.array(z.enum(knownDocumentFields)),
  allowedAccessClasses: z.array(z.enum(['INTERNAL', 'RESTRICTED', 'MEDICAL'])).min(1, 'Selecione uma classificação permitida.'),
  defaultAccessClass: z.enum(['INTERNAL', 'RESTRICTED', 'MEDICAL']),
  mimeTypes: z.string().trim().min(1, 'Informe ao menos um formato permitido.').refine((value) => value.split(/[\n,]+/).every((item) => /^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/.test(item.trim())), 'Informe tipos MIME completos, como application/pdf.'),
  maxSizeMb: z.number({ invalid_type_error: 'Informe o limite do arquivo.' }).finite().positive('O limite deve ser maior que zero.').refine(value => Number.isSafeInteger(Math.round(value * 1024 * 1024)) && Math.round(value * 1024 * 1024) > 0, 'Informe um limite representável em bytes inteiros positivos.'),
  renewalEnabled: z.boolean(),
  noticeDays: z.number({ invalid_type_error: 'Informe a antecedência em dias.' }).int().min(0, 'A antecedência não pode ser negativa.'),
  periodMonths: z.number({ invalid_type_error: 'Informe a periodicidade ou deixe em zero.' }).int().min(0),
  retentionCode: z.string().trim().min(1, 'Informe a referência da política de guarda.'),
  retentionVersion: z.string().trim().min(1, 'Informe a versão da política.'),
  retentionSource: z.string().trim().min(1, 'Informe a fonte validada da política.'),
  reviewRequired: z.boolean(),
  signatureRequired: z.boolean(),
  allowSelfApproval: z.boolean(),
  allowMultipleActiveVersions: z.boolean(),
}).superRefine((value, context) => {
  if (!value.allowedAccessClasses.includes(value.defaultAccessClass)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['defaultAccessClass'], message: 'A classificação padrão deve estar entre as permitidas.' });
  if (value.renewalEnabled && value.periodMonths < 1) context.addIssue({ code: z.ZodIssueCode.custom, path: ['periodMonths'], message: 'Informe periodicidade positiva quando a renovação estiver ativa.' });
});

export type DocumentTypeForm = z.infer<typeof documentTypeSchema>;
export function documentTypePayload(value: DocumentTypeForm): Omit<DocumentTypeDto, 'id' | 'revision'> {
  return {
    code: value.code, name: value.name, category: value.category,
    requiredFields: [...new Set(['typeId', 'ownerId', 'accessClass', 'issueDate', ...value.requiredFields])],
    allowedAccessClasses: value.allowedAccessClasses, defaultAccessClass: value.defaultAccessClass,
    allowedMimeTypes: [...new Set(value.mimeTypes.split(/[\n,]+/).map((item) => item.trim()))],
    maxFileSizeBytes: Math.round(value.maxSizeMb * 1024 * 1024),
    renewalPolicy: { enabled: value.renewalEnabled, noticeDays: value.noticeDays, ...(value.renewalEnabled ? { periodMonths: value.periodMonths } : {}) },
    retentionPolicyReference: { code: value.retentionCode, version: value.retentionVersion, source: value.retentionSource },
    workflow: { reviewRequired: value.reviewRequired, signatureRequired: value.signatureRequired, allowSelfApproval: value.allowSelfApproval, allowMultipleActiveVersions: value.allowMultipleActiveVersions },
  };
}

export const userAccessSchema = z.object({
  displayName: z.string().trim().min(3, 'Informe o nome completo.').max(120),
  email: z.string().trim().email('Informe um e-mail válido.'),
  roles: z.array(z.string()).min(1, 'Selecione ao menos um perfil.'),
  companyIds: z.array(z.string()).min(1, 'Selecione ao menos uma empresa autorizada.'),
  unitIds: z.array(z.string()).min(1, 'Selecione ao menos uma unidade autorizada.'),
  teamIds: z.array(z.string()),
  ownOnly: z.boolean(),
  status: z.enum(['ACTIVE', 'DISABLED', 'INVITED']),
  expiresAt: z.string(),
}).superRefine((value, context) => {
  if (value.status !== 'DISABLED' && value.roles.includes('AUDITOR') && !value.expiresAt) context.addIssue({ code: z.ZodIssueCode.custom, path: ['expiresAt'], message: 'O acesso de auditor exige uma data de término.' });
  if (value.expiresAt) {
    const instant = localAccessInstant(value.expiresAt);
    if (!instant) context.addIssue({ code: z.ZodIssueCode.custom, path: ['expiresAt'], message: 'Informe uma data e hora válidas para a concessão.' });
    else if (value.status !== 'DISABLED' && Date.parse(instant) <= Date.now()) context.addIssue({ code: z.ZodIssueCode.custom, path: ['expiresAt'], message: 'Escolha uma data futura para a concessão.' });
  }
});
export type UserAccessForm = z.infer<typeof userAccessSchema>;

/** Access deadlines use São Paulo civil time, independent of the browser's timezone. */
export function localAccessInstant(value: string): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return undefined;
  const [, year, month, day, hour, minute, second = '0'] = match;
  const calendar = new Date(`${value}${match[6] ? '' : ':00'}Z`);
  if (!Number.isFinite(calendar.getTime()) || calendar.getUTCFullYear() !== Number(year) || calendar.getUTCMonth() + 1 !== Number(month) || calendar.getUTCDate() !== Number(day) || calendar.getUTCHours() !== Number(hour) || calendar.getUTCMinutes() !== Number(minute) || calendar.getUTCSeconds() !== Number(second)) return undefined;
  return new Date(`${value}${match[6] ? '' : ':00'}-03:00`).toISOString();
}

export function delegatedScope(value: UserAccessForm, me: MeDto, original?: ScopeDto, organization?: OrganizationDto, teams?: TeamDto[]): ScopeDto {
  const companies = [...new Set(value.companyIds)];
  const units = [...new Set(value.unitIds)];
  const selectedTeams = [...new Set(value.teamIds)];
  if (!companies.length || companies.some(id => !me.scope.companyIds.includes(id))) throw new Error('A concessão contém uma empresa fora do seu escopo.');
  if (!units.length || units.some(id => !me.scope.unitIds.includes(id))) throw new Error('A concessão contém uma unidade fora do seu escopo.');
  if (organization && units.some(id => !organization.units.some(unit => unit.id === id && companies.includes(unit.companyId ?? '')))) throw new Error('As unidades devem pertencer às empresas selecionadas.');
  if (me.scope.teamIds.length && (!selectedTeams.length || selectedTeams.some(id => !me.scope.teamIds.includes(id)))) throw new Error('A concessão de equipes deve permanecer dentro do seu escopo.');
  if (teams && selectedTeams.some(id => !teams.some(team => team.id === id && units.includes(team.unitId) && companies.includes(team.companyId)))) throw new Error('As equipes devem pertencer às empresas e unidades selecionadas.');
  if (me.scope.ownOnly && !value.ownOnly) throw new Error('Seu acesso permite conceder apenas dados próprios.');
  const sectorIds = [...new Set(original?.sectorIds ?? me.scope.sectorIds)].filter(id => !organization || organization.sectors.some(sector => sector.id === id && units.includes(sector.unitId ?? '')));
  if (original?.sectorIds.some(id => !me.scope.sectorIds.includes(id)) && me.scope.sectorIds.length) throw new Error('O acesso existente contém setores fora do seu escopo.');
  if ((original?.sectorIds.length || me.scope.sectorIds.length) && !sectorIds.length) throw new Error('As unidades selecionadas não preservam a restrição de setores.');
  const expiresAt = value.expiresAt ? localAccessInstant(value.expiresAt) : undefined;
  if (value.expiresAt && !expiresAt) throw new Error('Informe uma data e hora válidas para a concessão.');
  if (me.scope.expiresAt && (!expiresAt || Date.parse(expiresAt) > Date.parse(me.scope.expiresAt))) throw new Error('A concessão deve terminar até o vencimento do seu próprio acesso.');
  return { companyIds: companies, unitIds: units, sectorIds, teamIds: selectedTeams, ownOnly: value.ownOnly, ...(expiresAt ? { expiresAt } : {}) };
}

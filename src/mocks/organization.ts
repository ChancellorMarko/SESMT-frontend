import type { OrganizationDto, OrganizationItemDto, UserDto } from '../shared/contracts';

const resourceKeys = {
  companies: 'companies', establishments: 'establishments', units: 'units', sectors: 'sectors',
  jobs: 'jobs', 'job-functions': 'jobFunctions', 'work-centers': 'workCenters',
} as const;
type ResourcePath = keyof typeof resourceKeys;
const fields: Record<ResourcePath, string[]> = {
  companies: ['name', 'code', 'taxId', 'classification', 'status'],
  establishments: ['name', 'code', 'companyId', 'address', 'status'],
  units: ['name', 'code', 'companyId', 'establishmentId', 'address', 'responsibleIds', 'status'],
  sectors: ['name', 'code', 'unitId', 'status'],
  jobs: ['name', 'code', 'companyId', 'status'],
  'job-functions': ['name', 'code', 'companyId', 'jobId', 'description', 'occupationCode', 'status'],
  'work-centers': ['name', 'code', 'unitId', 'sectorId', 'status'],
};

export class OrganizationMutationError extends Error {
  constructor(public status: number, public code: string, message: string, public field?: string) { super(message); }
}
function invalid(field: string, message: string): never { throw new OrganizationMutationError(422, 'VALIDATION_FAILED', message, field); }

/** Validates a complete clone before the synthetic handler changes its live fixtures. */
export function prepareOrganizationMutation(
  resource: ResourcePath,
  body: unknown,
  organization: OrganizationDto,
  current?: OrganizationItemDto,
  users: UserDto[] = [],
): OrganizationItemDto {
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('', 'Envie os campos do cadastro em um objeto.');
  const input = body as Record<string, unknown>;
  const next = structuredClone(current || { name: '', status: 'ACTIVE', revision: 1 }) as OrganizationItemDto;
  const writable = next as unknown as Record<string, unknown>;
  for (const [field, value] of Object.entries(input)) {
    if (!fields[resource].includes(field)) invalid(field, 'Este campo não pode ser alterado neste cadastro.');
    if (field === 'status') {
      if (!current) invalid(field, 'A situação inicial é definida pela demonstração.');
      if (value !== 'ACTIVE' && value !== 'INACTIVE') invalid(field, 'Selecione uma situação válida.');
      next.status = value; continue;
    }
    if (field === 'classification') {
      if (value !== 'INTERNAL' && value !== 'SERVICE_PROVIDER') invalid(field, 'Selecione se a empresa é interna ou prestadora de serviços.');
      next.classification = value; continue;
    }
    if (field === 'responsibleIds') {
      if (!Array.isArray(value) || value.some(id => typeof id !== 'string' || !id.trim()) || new Set(value).size !== value.length) invalid(field, 'Selecione responsáveis válidos, sem repetições.');
      next.responsibleIds = [...value]; continue;
    }
    const optional = ['code', 'address', 'establishmentId', 'sectorId', 'jobId', 'description', 'occupationCode'].includes(field);
    if (optional && value === null) { delete writable[field]; continue; }
    if (typeof value !== 'string') invalid(field, 'Informe um texto válido.');
    const normalized = value.trim();
    const maximum = field === 'description' ? 2000 : field === 'address' ? 1000 : field === 'name' ? 200 : 100;
    if (normalized.length > maximum) invalid(field, `Use no máximo ${maximum} caracteres.`);
    if (optional && !normalized) { delete writable[field]; continue; }
    if (!optional && !normalized) invalid(field, 'Preencha este campo.');
    writable[field] = normalized;
  }
  if (!next.name) invalid('name', 'Preencha este campo.');
  if (next.name.length < 2) invalid('name', 'Informe um nome com pelo menos 2 caracteres.');
  if (resource === 'companies' && (!current || 'taxId' in input)) {
    if (!next.taxId || !/^[\d./\-\s]+$/.test(next.taxId)) invalid('taxId', 'Informe um CNPJ com 14 dígitos.');
    const taxId = next.taxId.replace(/\D/g, '');
    if (taxId.length !== 14) invalid('taxId', 'Informe um CNPJ com 14 dígitos.');
    next.taxId = taxId;
  }
  if (resource === 'companies' && (!current || 'name' in input && 'taxId' in input) && !next.classification) invalid('classification', 'Selecione se a empresa é interna ou prestadora de serviços.');
  const relationshipChanged = !current || ['companyId', 'unitId', 'establishmentId', 'sectorId', 'jobId'].some(field => field in input) || input.status === 'ACTIVE';
  if (['establishments', 'units', 'jobs', 'job-functions'].includes(resource) && relationshipChanged) {
    if (!organization.companies.some(company => company.id === next.companyId && company.status === 'ACTIVE')) invalid('companyId', 'Selecione uma empresa ativa.');
  }
  if (['sectors', 'work-centers'].includes(resource) && relationshipChanged) {
    if (!organization.units.some(unit => unit.id === next.unitId && unit.status === 'ACTIVE')) invalid('unitId', 'Selecione uma unidade ativa.');
  }
  if (resource === 'units' && next.establishmentId && relationshipChanged && !organization.establishments.some(parent => parent.id === next.establishmentId && parent.companyId === next.companyId && parent.status === 'ACTIVE')) invalid('establishmentId', 'O estabelecimento precisa pertencer à empresa ativa selecionada.');
  if (resource === 'job-functions' && next.jobId && relationshipChanged && !organization.jobs.some(parent => parent.id === next.jobId && parent.companyId === next.companyId && parent.status === 'ACTIVE')) invalid('jobId', 'O cargo precisa pertencer à empresa ativa selecionada.');
  if (resource === 'work-centers' && next.sectorId && relationshipChanged && !organization.sectors.some(parent => parent.id === next.sectorId && parent.unitId === next.unitId && parent.status === 'ACTIVE')) invalid('sectorId', 'O setor precisa pertencer à unidade ativa selecionada.');
  if (resource === 'units' && 'responsibleIds' in input && next.responsibleIds?.some(id => !users.some(user => user.id === id && user.status === 'ACTIVE' && (!user.scope.expiresAt || Date.parse(user.scope.expiresAt) > Date.now()) && user.scope.companyIds.includes(next.companyId!) && user.scope.unitIds.includes(next.id)))) invalid('responsibleIds', 'Selecione apenas responsáveis ativos e elegíveis nesta unidade.');
  return next;
}

export { resourceKeys as organizationResourceKeys };

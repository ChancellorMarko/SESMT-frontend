/** Mock demonstrativo de designações operacionais. Dados fictícios em memória. */
import type { PermitEventDto, ServiceTypeDto } from '../shared/contracts/work-permits';
import type {
  DesignationDto,
  DesignationWriteDto,
  DesignationCoverageDto,
  DesignationCoverageItemDto,
  DesignationStatus,
} from '../shared/contracts/designations';
import { PermitDemoError, type PermitDemoContext } from './work-permits';
import { id, UNIT_A, UNIT_B, COMPANY } from './fixtures';
import { PT_SERVICE_TYPES } from '../shared/lib/service-types';
import { appointmentServiceIds } from '../shared/lib/appointment-services';

function assert(condition: unknown, status: number, code: string, message: string, field?: string): asserts condition {
  if (!condition) throw new PermitDemoError(status, code, message, field);
}
function text(value: unknown, field: string, max = 4000) {
  assert(typeof value === 'string' && value.trim().length > 0 && value.length <= max, 422, 'VALIDATION_FAILED', 'Preencha um texto válido.', field);
  return value.trim();
}
const instant = () => new Date().toISOString();
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const localDate = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const today = () => localDate(new Date());
const futureDay = (offset: number) => localDate(new Date(Date.now() + offset * 86400000));
const normalized = (value: string) => value.trim().replace(/\s+/g, ' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');

export interface DesignationsDemoInput {
  services: ServiceTypeDto[];
  responsibles: { id: string; name: string }[];
}

export function makeDesignationsDemo(input: DesignationsDemoInput) {
  const designations = new Map<string, DesignationDto>();

  // Seed: Diego Demo (técnico) designated for legacy services + some PT services in UNIT_A
  const seedDesignation = (
    n: number, responsibleId: string, responsibleName: string, unitId: string,
    serviceTypeIds: string[], serviceNames: string[],
    locationPattern: string, validFrom: string, validUntil: string,
    status: DesignationStatus = 'ACTIVE',
  ) => {
    const designation: DesignationDto = {
      id: id(n), unitId, responsibleId, responsibleName, serviceTypeIds, serviceNames,
      locationPattern, validFrom, validUntil, status,
      notes: 'Designação sintética para demonstração. Não constitui autorização operacional real.',
      createdAt: instant(), createdBy: id(20), createdByName: 'Marina Demo',
      revision: 1,
      history: [{ id: crypto.randomUUID(), action: 'DESIGNATION_CREATED', actorName: 'Marina Demo', occurredAt: instant() }],
    };
    if (status === 'REVOKED') {
      designation.revokedAt = instant();
      designation.revokedBy = id(20);
      designation.revokedByName = 'Marina Demo';
      designation.revocationReason = 'Demonstração de revogação.';
      designation.history.push({ id: crypto.randomUUID(), action: 'DESIGNATION_REVOKED', actorName: 'Marina Demo', occurredAt: instant(), reason: 'Demonstração de revogação.' });
    }
    designations.set(designation.id, designation);
    return designation;
  };

  // Diego Demo (técnico id(25)): all services, UNIT_A, wide window
  seedDesignation(600, id(25), 'Diego Demo · técnico', UNIT_A,
    [id(210), id(211), ...PT_SERVICE_TYPES.map(s => s.id)],
    ['Manutenção programada', 'Inspeção de área', ...PT_SERVICE_TYPES.map(s => s.name)],
    '', futureDay(-30), futureDay(180),
  );

  // Felipe Demo (bombeiro id(26)): maintenance + inspection + height + hot work, UNIT_B
  seedDesignation(601, id(26), 'Felipe Demo · bombeiro', UNIT_B,
    [id(210), id(211), PT_SERVICE_TYPES[0].id, PT_SERVICE_TYPES[1].id],
    ['Manutenção programada', 'Inspeção de área', PT_SERVICE_TYPES[0].name, PT_SERVICE_TYPES[1].name],
    '', futureDay(-10), futureDay(90),
  );

  // Felipe also has a designation in UNIT_A but only for inspections
  seedDesignation(602, id(26), 'Felipe Demo · bombeiro', UNIT_A,
    [id(211)],
    ['Inspeção de área'],
    '', futureDay(-10), futureDay(90),
  );

  // A revoked old designation (historical)
  seedDesignation(603, id(25), 'Diego Demo · técnico', UNIT_A,
    [id(210)],
    ['Manutenção programada'],
    'Área restrita', futureDay(-90), futureDay(-10),
    'REVOKED',
  );

  // An expired designation for demonstration/testing
  seedDesignation(604, id(26), 'Felipe Demo · bombeiro', UNIT_A,
    [PT_SERVICE_TYPES[0].id],
    [PT_SERVICE_TYPES[0].name],
    '', futureDay(-60), futureDay(-2),
  );

  function resolveStatus(d: DesignationDto): DesignationStatus {
    if (d.status === 'REVOKED') return 'REVOKED';
    const now = today();
    if (d.validUntil < now) return 'EXPIRED';
    return 'ACTIVE';
  }

  function statusResponse(d: DesignationDto): DesignationDto {
    return { ...clone(d), status: resolveStatus(d) };
  }

  /**
   * Check coverage for a set of service IDs at a specific unit, date, and location.
   * Returns coverage items per service, and the earliest operational window end.
   */
  function checkCoverage(
    unitId: string,
    serviceTypeIds: string[],
    location: string,
    atDate: string,
    responsibleId?: string,
  ): DesignationCoverageDto {
    const now = today();
    const checkDate = atDate || now;
    const items: DesignationCoverageItemDto[] = serviceTypeIds.map(serviceTypeId => {
      const service = input.services.find(s => s.id === serviceTypeId);
      const serviceName = service?.name || 'Serviço desconhecido';
      // Find active designations covering this service at this unit, date and location
      const candidates = [...designations.values()].filter(d =>
        d.unitId === unitId &&
        d.serviceTypeIds.includes(serviceTypeId) &&
        (responsibleId ? d.responsibleId === responsibleId : true),
      );
      // Find best: active and covering the date
      const active = candidates.find(d =>
        d.status !== 'REVOKED' &&
        d.validFrom <= checkDate &&
        d.validUntil >= checkDate &&
        (!d.locationPattern || normalized(location).includes(normalized(d.locationPattern))),
      );
      if (active) {
        return {
          serviceTypeId, serviceName, covered: true,
          designationId: active.id, responsibleId: active.responsibleId,
          responsibleName: active.responsibleName,
          validFrom: active.validFrom, validUntil: active.validUntil,
        };
      }
      // Check if there's an expired one
      const expired = candidates.find(d =>
        d.status !== 'REVOKED' && d.validUntil < checkDate &&
        (!d.locationPattern || normalized(location).includes(normalized(d.locationPattern))),
      );
      if (expired) {
        return {
          serviceTypeId, serviceName, covered: false, expired: true,
          designationId: expired.id, responsibleId: expired.responsibleId,
          responsibleName: expired.responsibleName,
          validFrom: expired.validFrom, validUntil: expired.validUntil,
        };
      }
      // Check revoked
      const revoked = candidates.find(d => d.status === 'REVOKED');
      if (revoked) {
        return { serviceTypeId, serviceName, covered: false, revoked: true };
      }
      return { serviceTypeId, serviceName, covered: false };
    });
    const fullyCovered = items.every(item => item.covered);
    const coveredEnds = items.filter(item => item.covered && item.validUntil).map(item => item.validUntil!);
    const operationalWindowEnd = coveredEnds.length === items.length ? coveredEnds.sort()[0] : undefined;
    return { checkedAt: instant(), unitId, fullyCovered, operationalWindowEnd, items };
  }

  const handles = (path: string) => /^\/(designations|designation-coverage)(\/|$)/.test(path);

  async function route(request: Request, url: URL, path: string, context: PermitDemoContext): Promise<unknown | undefined> {
    if (!handles(path)) return undefined;
    const parts = path.split('/').filter(Boolean);
    const method = request.method;
    const body = async <T,>() => await request.json() as T;
    const queryUnit = url.searchParams.get('unitId');

    if (path === '/designation-coverage' && method === 'GET') {
      assert(context.permissions.includes('permits.read') || context.permissions.includes('appointments.read'),
        403, 'FORBIDDEN', 'Sem permissão para consultar cobertura.');
      const unitId = text(queryUnit, 'unitId');
      assert(context.user.scope.unitIds.includes(unitId), 403, 'FORBIDDEN', 'Unidade fora do alcance.');
      context.checkUnit(unitId);
      const serviceTypeIdsParam = url.searchParams.get('serviceTypeIds');
      assert(serviceTypeIdsParam, 422, 'VALIDATION_FAILED', 'Informe os serviços para verificar a cobertura.', 'serviceTypeIds');
      const serviceTypeIds = serviceTypeIdsParam.split(',').filter(Boolean);
      assert(serviceTypeIds.length > 0, 422, 'VALIDATION_FAILED', 'Informe ao menos um serviço.', 'serviceTypeIds');
      const location = url.searchParams.get('location') || '';
      const atDate = url.searchParams.get('atDate') || today();
      const responsibleId = url.searchParams.get('responsibleId') || undefined;
      return checkCoverage(unitId, serviceTypeIds, location, atDate, responsibleId);
    }

    if (parts[0] === 'designations') {
      if (parts.length === 1 && method === 'GET') {
        assert(context.permissions.includes('appointments.read') || context.permissions.includes('designations.read'),
          403, 'FORBIDDEN', 'Sem permissão para consultar designações.');
        if (queryUnit) {
          assert(context.user.scope.unitIds.includes(queryUnit), 403, 'FORBIDDEN', 'Unidade fora do alcance.');
          context.checkUnit(queryUnit);
        }
        const statusFilter = url.searchParams.get('status');
        const responsibleFilter = url.searchParams.get('responsibleId');
        const q = normalized(url.searchParams.get('q') || '');
        return [...designations.values()]
          .map(statusResponse)
          .filter(d =>
            context.user.scope.unitIds.includes(d.unitId) &&
            (!queryUnit || d.unitId === queryUnit) &&
            (!statusFilter || d.status === statusFilter) &&
            (!responsibleFilter || d.responsibleId === responsibleFilter) &&
            (!q || normalized(`${d.responsibleName} ${d.serviceNames.join(' ')} ${d.locationPattern}`).includes(q)),
          )
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      }

      if (parts.length === 1 && method === 'POST') {
        assert(context.permissions.includes('appointments.write'), 403, 'FORBIDDEN', 'Sem permissão para criar designações.');
        const data = await body<DesignationWriteDto>();
        assert(data && typeof data === 'object', 422, 'VALIDATION_FAILED', 'Envie os dados da designação.');
        const unitId = text(queryUnit || (data as unknown as { unitId?: string }).unitId, 'unitId');
        assert(context.user.scope.unitIds.includes(unitId), 403, 'FORBIDDEN', 'Unidade fora do alcance.');
        context.checkUnit(unitId);
        const responsibleId = text(data.responsibleId, 'responsibleId');
        const responsible = input.responsibles.find(r => r.id === responsibleId);
        assert(responsible, 422, 'INVALID_ASSIGNMENT', 'Responsável não encontrado.', 'responsibleId');
        assert(Array.isArray(data.serviceTypeIds) && data.serviceTypeIds.length > 0 &&
          data.serviceTypeIds.every(sid => input.services.some(s => s.id === sid)) &&
          new Set(data.serviceTypeIds).size === data.serviceTypeIds.length,
          422, 'VALIDATION_FAILED', 'Selecione serviços válidos sem repetição.', 'serviceTypeIds');
        const validFrom = text(data.validFrom, 'validFrom');
        const validUntil = text(data.validUntil, 'validUntil');
        assert(/^\d{4}-\d{2}-\d{2}$/.test(validFrom) && /^\d{4}-\d{2}-\d{2}$/.test(validUntil),
          422, 'VALIDATION_FAILED', 'Informe datas de vigência válidas.', 'validFrom');
        assert(validFrom <= validUntil, 422, 'VALIDATION_FAILED', 'O fim da vigência deve ser posterior ou igual ao início.', 'validUntil');
        const serviceNames = data.serviceTypeIds.map(sid => input.services.find(s => s.id === sid)!.name);
        const designation: DesignationDto = {
          id: crypto.randomUUID(), unitId,
          responsibleId, responsibleName: responsible.name,
          serviceTypeIds: [...data.serviceTypeIds], serviceNames,
          locationPattern: typeof data.locationPattern === 'string' ? data.locationPattern.trim() : '',
          validFrom, validUntil,
          notes: typeof data.notes === 'string' ? data.notes.trim().slice(0, 2000) : undefined,
          status: 'ACTIVE',
          createdAt: instant(), createdBy: context.user.id, createdByName: context.user.displayName,
          revision: 1,
          history: [{
            id: crypto.randomUUID(), action: 'DESIGNATION_CREATED',
            actorName: context.user.displayName, occurredAt: instant(),
            reason: `Serviços: ${serviceNames.join(', ')}. Vigência: ${validFrom} a ${validUntil}.`,
          }],
        };
        designations.set(designation.id, designation);
        return statusResponse(designation);
      }

      // Single designation routes
      assert(parts.length >= 2, 404, 'NOT_FOUND', 'Rota não encontrada.');
      const designation = designations.get(parts[1]);
      assert(designation && context.user.scope.unitIds.includes(designation.unitId),
        404, 'NOT_FOUND', 'Designação não encontrada ou fora do alcance.');

      if (parts.length === 2 && method === 'GET') {
        return statusResponse(designation);
      }

      if (parts[2] === 'revoke' && method === 'POST') {
        assert(context.permissions.includes('appointments.write'), 403, 'FORBIDDEN', 'Sem permissão para revogar designações.');
        assert(designation.status !== 'REVOKED', 409, 'ALREADY_REVOKED', 'Esta designação já foi revogada.');
        assert(request.headers.has('If-Match'), 428, 'PRECONDITION_REQUIRED', 'Recarregue o registro antes de revogar.');
        assert(request.headers.get('If-Match') === `"${designation.revision}"`, 412, 'REVISION_CONFLICT', 'O registro mudou. Recarregue.');
        const data = await body<{ reason: string }>();
        const reason = text(data.reason, 'reason');
        designation.status = 'REVOKED';
        designation.revokedAt = instant();
        designation.revokedBy = context.user.id;
        designation.revokedByName = context.user.displayName;
        designation.revocationReason = reason;
        designation.revision++;
        designation.history.push({
          id: crypto.randomUUID(), action: 'DESIGNATION_REVOKED',
          actorName: context.user.displayName, occurredAt: instant(), reason,
        });
        return statusResponse(designation);
      }

      if (parts.length === 2 && method === 'PATCH') {
        assert(context.permissions.includes('appointments.write'), 403, 'FORBIDDEN', 'Sem permissão para editar designações.');
        assert(resolveStatus(designation) === 'ACTIVE', 409, 'NOT_ACTIVE', 'Somente designações ativas podem ser editadas.');
        assert(request.headers.has('If-Match'), 428, 'PRECONDITION_REQUIRED', 'Recarregue o registro antes de alterar.');
        assert(request.headers.get('If-Match') === `"${designation.revision}"`, 412, 'REVISION_CONFLICT', 'O registro mudou. Recarregue.');
        const data = await body<Partial<DesignationWriteDto>>();
        if (data.serviceTypeIds) {
          assert(Array.isArray(data.serviceTypeIds) && data.serviceTypeIds.length > 0 &&
            data.serviceTypeIds.every(sid => input.services.some(s => s.id === sid)),
            422, 'VALIDATION_FAILED', 'Serviços inválidos.', 'serviceTypeIds');
          designation.serviceTypeIds = [...data.serviceTypeIds];
          designation.serviceNames = data.serviceTypeIds.map(sid => input.services.find(s => s.id === sid)!.name);
        }
        if (data.validFrom) {
          assert(/^\d{4}-\d{2}-\d{2}$/.test(data.validFrom), 422, 'VALIDATION_FAILED', 'Data inválida.', 'validFrom');
          designation.validFrom = data.validFrom;
        }
        if (data.validUntil) {
          assert(/^\d{4}-\d{2}-\d{2}$/.test(data.validUntil), 422, 'VALIDATION_FAILED', 'Data inválida.', 'validUntil');
          designation.validUntil = data.validUntil;
        }
        assert(designation.validFrom <= designation.validUntil, 422, 'VALIDATION_FAILED', 'Vigência inválida.', 'validUntil');
        if (data.locationPattern !== undefined) designation.locationPattern = data.locationPattern.trim();
        if (data.notes !== undefined) designation.notes = data.notes?.trim().slice(0, 2000);
        designation.revision++;
        designation.history.push({
          id: crypto.randomUUID(), action: 'DESIGNATION_UPDATED',
          actorName: context.user.displayName, occurredAt: instant(),
        });
        return statusResponse(designation);
      }

      throw new PermitDemoError(404, 'NOT_FOUND', 'Operação não prevista.');
    }

    throw new PermitDemoError(404, 'NOT_FOUND', 'Rota não prevista.');
  }

  return { handles, route, checkCoverage };
}

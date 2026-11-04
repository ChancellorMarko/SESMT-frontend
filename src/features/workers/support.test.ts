import { describe, expect, it } from 'vitest';
import type { OrganizationDto } from '../../shared/contracts';
import { assignmentError, dateLabel, todayCivil, validCivil, workerFormSchema, workerMovementSchema, type WorkerFormValues } from './support';

const organization: OrganizationDto = {
  companies: [{ id: 'company-a', name: 'Empresa A', status: 'ACTIVE', revision: 1 }],
  establishments: [],
  units: [
    { id: 'unit-a', companyId: 'company-a', name: 'Unidade A', status: 'ACTIVE', revision: 1 },
    { id: 'unit-b', companyId: 'company-b', name: 'Unidade B', status: 'ACTIVE', revision: 1 },
  ],
  sectors: [
    { id: 'sector-a', unitId: 'unit-a', name: 'Setor A', status: 'ACTIVE', revision: 1 },
    { id: 'sector-b', unitId: 'unit-b', name: 'Setor B', status: 'ACTIVE', revision: 1 },
  ],
  jobs: [{ id: 'job-a', companyId: 'company-a', name: 'Cargo A', status: 'ACTIVE', revision: 1 }],
  jobFunctions: [{ id: 'function-a', companyId: 'company-a', jobId: 'job-a', name: 'Função A', status: 'ACTIVE', revision: 1 }],
  workCenters: [{ id: 'center-a', unitId: 'unit-a', sectorId: 'sector-a', name: 'Centro A', status: 'ACTIVE', revision: 1 }],
};
const valid: WorkerFormValues = { registration: '0001', fullName: 'Pessoa de teste', employmentType: 'CLT', admissionDate: '2026-10-05', companyId: 'company-a', unitId: 'unit-a', sectorId: 'sector-a', jobId: 'job-a', jobFunctionId: 'function-a', workCenterId: 'center-a', managerId: '' };

describe('dados civis e vínculo de trabalhador', () => {
  it('preserva data civil sem conversão de fuso', () => { expect(dateLabel('2026-10-05')).toBe('05/10/2026'); });
  it('rejeita datas que o Date normalizaria silenciosamente', () => { expect(validCivil('2026-02-30')).toBe(false); expect(validCivil('2025-02-29')).toBe(false); expect(validCivil('2024-02-29')).toBe(true); });
  it('rejeita cadastro incompleto antes de enviá-lo', () => { expect(workerFormSchema.safeParse({ ...valid, registration: ' ', sectorId: '' }).success).toBe(false); });
  it('aceita vínculo coerente entre empresa, unidade, setor, cargo e centro', () => { expect(assignmentError(valid, organization)).toBeUndefined(); });
  it('impede combinar unidade de outra empresa', () => { expect(assignmentError({ ...valid, unitId: 'unit-b' }, organization)).toContain('empresa'); });
  it('impede combinar setor de outra unidade', () => { expect(assignmentError({ ...valid, sectorId: 'sector-b' }, organization)).toContain('setor'); });
  it('exige que função vinculada a cargo corresponda ao cargo selecionado', () => { expect(assignmentError({ ...valid, jobId: '' }, organization)).toContain('função'); });
  it('impede selecionar centro incompatível com o setor', () => {
    const other = { ...organization, workCenters: [{ ...organization.workCenters[0], sectorId: 'sector-b' }] };
    expect(assignmentError(valid, other)).toContain('centro');
  });
  it('recusa referência inativa ainda existente no catálogo', () => {
    const inactive = { ...organization, sectors: [{ ...organization.sectors[0], status: 'INACTIVE' as const }] };
    expect(assignmentError(valid, inactive)).toContain('setor ativo');
  });
  it('recusa empresa inativa mesmo com unidade e setor ativos', () => {
    expect(assignmentError(valid, { ...organization, companies: [{ ...organization.companies[0], status: 'INACTIVE' }] })).toContain('empresa ativa');
  });
  it('valida tipo e período efetivo conforme o vínculo atual', () => {
    const schema = workerMovementSchema({ status: 'ACTIVE', admissionDate: '2024-01-01' });
    const value = { ...valid, type: 'TRANSFER', effectiveDate: todayCivil(), reason: 'Mudança registrada.' };
    expect(schema.safeParse(value).success).toBe(true);
    expect(schema.safeParse({ ...value, type: 'RETURN' }).success).toBe(false);
    expect(schema.safeParse({ ...value, effectiveDate: '2023-12-31' }).success).toBe(false);
    expect(schema.safeParse({ ...value, effectiveDate: '2099-01-01' }).success).toBe(false);
    expect(schema.safeParse({ ...value, effectiveDate: '2026-02-31' }).success).toBe(false);
    expect(workerMovementSchema({ status: 'TERMINATED', admissionDate: '2024-01-01' }).safeParse({ ...value, type: 'ADMISSION' }).success).toBe(true);
  });
});

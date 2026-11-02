import { describe, expect, it } from 'vitest';
import { COMPANY, id, makeFixtures, UNIT_A, UNIT_B } from './fixtures';
import { OrganizationMutationError, prepareOrganizationMutation } from './organization';

describe('preparação atômica dos cadastros organizacionais demo', () => {
  it('valida toda a alteração antes de tocar o registro original', () => {
    const { organization, users } = makeFixtures();
    const record = organization.units[0], original = structuredClone(record);
    expect(() => prepareOrganizationMutation('units', { name: 'Minha alteração', establishmentId: 'inexistente' }, organization, record, users)).toThrow(OrganizationMutationError);
    expect(record).toEqual(original);
    expect(() => prepareOrganizationMutation('units', { name: 'Minha alteração', responsibleIds: [id(24), id(24)] }, organization, record, users)).toThrow(/repetições/);
    expect(record).toEqual(original);
  });
  it('recusa identidade, revisão, campos de outro recurso e situação arbitrária', () => {
    const { organization } = makeFixtures(), record = organization.jobs[0];
    for (const body of [{ id: 'substituído' }, { revision: 999 }, { unitId: UNIT_B }, { status: 'DELETED' }]) {
      expect(() => prepareOrganizationMutation('jobs', body, organization, record)).toThrow(OrganizationMutationError);
    }
    expect(record).toMatchObject({ id: id(8), companyId: COMPANY, revision: 1 });
  });
  it('admite PATCH somente de situação e a limpeza explícita de campos opcionais', () => {
    const { organization } = makeFixtures(), unit = organization.units[0];
    const inactive = prepareOrganizationMutation('units', { status: 'INACTIVE' }, organization, unit);
    expect(inactive).toMatchObject({ name: unit.name, companyId: COMPANY, status: 'INACTIVE', revision: 1 });
    const cleared = prepareOrganizationMutation('units', { code: null, establishmentId: null, address: null }, organization, unit);
    expect(cleared).not.toHaveProperty('code'); expect(cleared).not.toHaveProperty('establishmentId');
    expect(unit.code).toBe('MATRIZ'); expect(unit.establishmentId).toBe(id(4));
  });
  it('recusa empresa/unidade ausentes e vínculos de pais incompatíveis', () => {
    const { organization } = makeFixtures();
    organization.companies.push({ id: id(900), name: 'Empresa externa', status: 'ACTIVE', revision: 1 });
    expect(() => prepareOrganizationMutation('units', { name: 'Nova unidade' }, organization)).toThrow(/empresa ativa/);
    expect(() => prepareOrganizationMutation('sectors', { name: 'Novo setor', unitId: id(999) }, organization)).toThrow(/unidade ativa/);
    expect(() => prepareOrganizationMutation('units', { name: 'Nova unidade', companyId: id(900), establishmentId: id(4) }, organization)).toThrow(/estabelecimento/);
    expect(() => prepareOrganizationMutation('job-functions', { name: 'Nova função', companyId: id(900), jobId: id(8) }, organization)).toThrow(/cargo/);
    expect(() => prepareOrganizationMutation('work-centers', { name: 'Novo centro', unitId: UNIT_B, sectorId: id(5) }, organization)).toThrow(/setor/);
  });
  it('permite corrigir metadados históricos, mas exige pais ativos ao reativar', () => {
    const { organization } = makeFixtures(), sector = organization.sectors[0];
    organization.units[0].status = 'INACTIVE'; sector.status = 'INACTIVE';
    expect(prepareOrganizationMutation('sectors', { name: 'Nome corrigido' }, organization, sector)).toMatchObject({ name: 'Nome corrigido', status: 'INACTIVE' });
    expect(() => prepareOrganizationMutation('sectors', { status: 'ACTIVE' }, organization, sector)).toThrow(/unidade ativa/);
  });
  it('valida responsáveis por situação e concessão na unidade, sem mutar suas listas', () => {
    const { organization, users } = makeFixtures(), record = organization.units[1];
    const updated = prepareOrganizationMutation('units', { responsibleIds: [id(20)] }, organization, record, users);
    expect(updated.responsibleIds).toEqual([id(20)]); expect(updated.responsibleIds).not.toBe(record.responsibleIds);
    expect(() => prepareOrganizationMutation('units', { responsibleIds: [id(24)] }, organization, record, users)).toThrow(/responsáveis ativos/);
    users[0].status = 'DISABLED';
    expect(() => prepareOrganizationMutation('units', { responsibleIds: [id(20)] }, organization, record, users)).toThrow(/responsáveis ativos/);
    users[0].status = 'ACTIVE'; users[0].scope.expiresAt = new Date(Date.now() - 1000).toISOString();
    expect(() => prepareOrganizationMutation('units', { responsibleIds: [id(20)] }, organization, record, users)).toThrow(/responsáveis ativos/);
    users[0].scope.expiresAt = 'data inválida';
    expect(() => prepareOrganizationMutation('units', { responsibleIds: [id(20)] }, organization, record, users)).toThrow(/responsáveis ativos/);
  });
  it('normaliza texto/CNPJ e recusa campos com tipos ou limites inválidos', () => {
    const { organization } = makeFixtures();
    expect(prepareOrganizationMutation('companies', { name: '  Empresa Demo  ', taxId: '12.345.678/0001-99', classification: 'SERVICE_PROVIDER' }, organization)).toMatchObject({ name: 'Empresa Demo', taxId: '12345678000199', classification: 'SERVICE_PROVIDER', status: 'ACTIVE' });
    for (const body of [null, [], { name: 'A', companyId: COMPANY }, { name: 'x'.repeat(201), companyId: COMPANY }, { name: 'Novo', companyId: null }]) {
      expect(() => prepareOrganizationMutation('jobs', body, organization)).toThrow(OrganizationMutationError);
    }
    expect(() => prepareOrganizationMutation('companies', { name: 'Nova', taxId: 'abc12345678000199' }, organization)).toThrow(/CNPJ/);
  });
  it('exige classificação explícita no cadastro e aceita somente as duas opções conhecidas', () => {
    const { organization } = makeFixtures();
    for (const classification of [undefined, null, '', 'EXTERNAL', true]) {
      expect(() => prepareOrganizationMutation('companies', { name: 'Nova empresa', taxId: '12345678000199', ...(classification === undefined ? {} : { classification }) }, organization)).toThrow(/interna ou prestadora/);
    }
    for (const classification of ['INTERNAL', 'SERVICE_PROVIDER']) {
      expect(prepareOrganizationMutation('companies', { name: 'Nova empresa', taxId: '12345678000199', classification }, organization)).toMatchObject({ classification });
    }
  });
  it('mantém classificação histórica desconhecida no PATCH parcial, sem inferir pela identidade', () => {
    const { organization } = makeFixtures(); const company = organization.companies[0]; delete company.classification;
    for (const body of [{ name: 'Empresa interna no nome' }, { status: 'INACTIVE' }, { taxId: '12345678000199' }]) {
      expect(prepareOrganizationMutation('companies', body, organization, company)).not.toHaveProperty('classification');
    }
    expect(() => prepareOrganizationMutation('companies', { name: 'Nome completo', taxId: '12345678000199' }, organization, company)).toThrow(/interna ou prestadora/);
    expect(prepareOrganizationMutation('companies', { name: 'Nome completo', taxId: '12345678000199', classification: 'INTERNAL' }, organization, company).classification).toBe('INTERNAL');
    expect(company).not.toHaveProperty('classification');
  });
  it('recusa limpeza ou classificação de outro recurso e altera a empresa sem tocar seus vínculos', () => {
    const { organization } = makeFixtures(); const company = organization.companies[0]; company.classification = 'INTERNAL';
    const snapshot = structuredClone(organization);
    expect(() => prepareOrganizationMutation('companies', { name: 'Nome que não será aplicado', classification: null }, organization, company)).toThrow(OrganizationMutationError);
    expect(() => prepareOrganizationMutation('units', { classification: 'SERVICE_PROVIDER' }, organization, organization.units[0])).toThrow(/não pode ser alterado/);
    expect(organization).toEqual(snapshot);
    const result = prepareOrganizationMutation('companies', { classification: 'SERVICE_PROVIDER' }, organization, company);
    expect(result).toMatchObject({ id: company.id, name: company.name, classification: 'SERVICE_PROVIDER', revision: company.revision });
    expect(organization.units).toEqual(snapshot.units); expect(company.classification).toBe('INTERNAL');
  });
});

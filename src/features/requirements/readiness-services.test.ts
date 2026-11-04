import { describe, expect, it } from 'vitest';
import type { DocumentaryReadinessRowDto } from '../../shared/contracts/requirements';
import { filterReadiness, readinessServiceIds } from './readiness';

const example = (): DocumentaryReadinessRowDto => ({
  appointmentId: 'appointment', appointmentCode: 'AG-TESTE', teamId: 'team', teamName: 'Equipe',
  serviceTypeId: 'primary', serviceLabel: 'Serviço principal', location: 'Área demonstrativa',
  startsAt: '2026-10-11T09:00:00-03:00', endsAt: '2026-10-11T10:00:00-03:00',
  eligibility: { appointmentId: 'appointment', checkedAt: '2026-10-10T09:00:00-03:00', requirementVersion: 'DEMO-1', eligible: false, participants: [
    { workerId: 'worker', name: 'Pessoa demonstrativa', serviceFunction: 'Executante', eligible: false, items: [] },
  ] },
});
const filters = { query: '', teamId: '', serviceTypeId: 'secondary', status: 'pending' };

describe('serviços da consulta documental', () => {
  it('encontra o serviço secundário descrito mesmo sem a lista opcional de IDs', () => {
    const row = { ...example(), services: [{ id: 'primary', name: 'Principal' }, { id: 'secondary', name: 'Secundário' }] };
    expect(readinessServiceIds(row)).toEqual(['primary', 'secondary']);
    expect(filterReadiness([row], filters)).toHaveLength(1);
  });
  it('encontra IDs secundários mesmo sem descrições opcionais', () => {
    const row = { ...example(), serviceTypeIds: ['primary', 'secondary'] };
    expect(readinessServiceIds(row)).toEqual(['primary', 'secondary']);
    expect(filterReadiness([row], filters)).toHaveLength(1);
  });
  it('preserva o principal quando os campos opcionais estão vazios', () => {
    const row = { ...example(), serviceTypeIds: [], services: [] };
    expect(readinessServiceIds(row)).toEqual(['primary']);
    expect(filterReadiness([row], { ...filters, serviceTypeId: 'primary' })).toHaveLength(1);
    expect(filterReadiness([row], filters)).toEqual([]);
  });
  it('combina as três fontes sem duplicar IDs nem alterar o registro recebido', () => {
    const row = { ...example(), serviceTypeIds: ['secondary', 'primary'], services: [{ id: 'secondary', name: 'Secundário' }, { id: 'third', name: 'Terceiro' }] };
    const before = structuredClone(row);
    expect(readinessServiceIds(row)).toEqual(['primary', 'secondary', 'third']);
    expect(filterReadiness([row], { ...filters, serviceTypeId: 'third' })).toHaveLength(1);
    expect(row).toEqual(before);
  });
  it('mantém o filtro de equipe combinado com o serviço e a situação documental', () => {
    const row = { ...example(), serviceTypeIds: ['secondary'] };
    expect(filterReadiness([row], { ...filters, teamId: 'another' })).toEqual([]);
    expect(filterReadiness([row], { ...filters, status: 'ready' })).toEqual([]);
  });
});

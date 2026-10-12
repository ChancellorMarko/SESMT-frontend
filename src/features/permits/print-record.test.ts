import { describe, expect, it } from 'vitest';
import type { WorkPermitDto } from '../../shared/contracts/work-permits';
import { printablePermit } from './print-record';

const permit = {
  version: 2,
  appointment: { location: 'Local atual' },
  checklist: [{ id: 'current', label: 'Atual', required: true, answer: 'YES' }],
  summary: 'Correção em preenchimento', sciences: [], history: [],
  snapshots: [{ version: 1, submittedAt: '2026-10-10T12:00:00Z', summary: 'Resumo original',
    appointment: { location: 'Local original' }, checklist: [{ id: 'original', label: 'Original', required: true, answer: 'YES' }],
    sciences: [], decision: 'RETURN', comment: 'Complementar o registro.' }],
} as unknown as WorkPermitDto;

describe('registro imprimível versionado', () => {
  it('usa conteúdo e decisão originais ao imprimir uma versão devolvida', () => {
    const record = printablePermit(permit, '1')!;
    expect(record.summary).toBe('Resumo original');
    expect(record.appointment.location).toBe('Local original');
    expect(record.documentStatus).toMatch(/DEVOLVIDA/);
    expect(record.checklist[0].id).toBe('original');
    expect(record.isDraft).toBe(false);
    expect(record.preparation).toBeUndefined();
  });
  it('identifica a correção atual não submetida como rascunho', () => {
    const record = printablePermit(permit)!;
    expect(record.summary).toBe('Correção em preenchimento');
    expect(record.documentStatus).toMatch(/RASCUNHO/);
    expect(record.isDraft).toBe(true);
  });
  it('não substitui silenciosamente uma versão ausente ou inválida pela atual', () => {
    for (const version of ['0', '-1', '3', 'NaN', '1.5']) expect(printablePermit(permit, version)).toBeUndefined();
  });
  it('distingue suspensão e cancelamento de um rascunho em preenchimento', () => {
    expect(printablePermit({ ...permit, operationStatus: 'CANCELED' })?.documentStatus).toBe('PERMISSÃO CANCELADA');
    expect(printablePermit({ ...permit, operationStatus: 'SUSPENDED' } as WorkPermitDto)?.documentStatus).toBe('OPERAÇÃO SUSPENSA');
    expect(printablePermit({ ...permit, operationStatus: 'EXECUTING' })?.isDraft).toBe(false);
  });
  it('não substitui uma conferência histórica ausente pela matriz atual', () => {
    const current = { appointmentId: 'appointment', checkedAt: '2026-10-10T12:00:00Z', requirementVersion: 'DEMO-MATRIZ-2', eligible: false, participants: [] };
    expect(printablePermit({ ...permit, eligibility: current }, '1')?.eligibility).toBeUndefined();
    expect(printablePermit({ ...permit, eligibility: current })?.eligibility).toEqual(current);
    const historical = { ...current, requirementVersion: 'DEMO-MATRIZ-1', eligible: true };
    const versioned = { ...permit, eligibility: current, snapshots: [{ ...permit.snapshots[0], eligibility: historical }] };
    expect(printablePermit(versioned, '1')?.eligibility).toEqual(historical);
  });
});

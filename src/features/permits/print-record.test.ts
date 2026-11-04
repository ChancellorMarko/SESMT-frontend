import { describe, expect, it } from 'vitest';
import type { WorkPermitDto } from '../../shared/contracts/work-permits';
import type { ServiceTemplateVersionDto } from '../../shared/contracts/service-templates';
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
    for (const version of ['', '0', '-1', '3', 'NaN', '1.5', ' 1 ', '1e0', '0x1', '01', '9007199254740993']) expect(printablePermit(permit, version)).toBeUndefined();
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
  it('imprime o template e a regra de resposta preservados na submissão, sem buscar a publicação atual', () => {
    const historical: ServiceTemplateVersionDto = { serviceTypeId: 'height', serviceName: 'Trabalho em altura original', version: '1', activityIds: ['height'], questions: [{ id: 'risk', label: 'Existe condição impeditiva?', required: true, blockingAnswers: ['YES'] }], publishedAt: '2026-10-10T10:00:00Z', publishedBy: 'Admin Demo', reason: 'Publicação inicial.' };
    const current = { ...historical, version: '2', serviceName: 'Nome atual', questions: [{ ...historical.questions[0], label: 'Nova pergunta', blockingAnswers: [] }] };
    const versioned = { ...permit, serviceTemplates: [current], snapshots: [{ ...permit.snapshots[0], serviceTemplates: [structuredClone(historical)], checklist: [{ id: 'original', label: historical.questions[0].label, required: true, answer: 'NO' as const, blockingAnswers: ['YES' as const], serviceName: historical.serviceName, templateVersion: '1' }] }] };
    const old = printablePermit(versioned, '1')!;
    expect(old.serviceTemplates?.[0].version).toBe('1');
    expect(old.serviceTemplates?.[0].questions[0].label).toBe('Existe condição impeditiva?');
    expect(old.checklist[0].blockingAnswers).toEqual(['YES']);
    expect(printablePermit(versioned)?.serviceTemplates?.[0].version).toBe('2');
    expect(printablePermit({ ...permit, serviceTemplates: [current] }, '1')?.serviceTemplates).toBeUndefined();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PermitSnapshotDto, WorkPermitDto } from '../shared/contracts/work-permits';
import { makePermitDemoPdf } from './permit-demo-pdf';

const snapshot: PermitSnapshotDto = { version: 1, submittedAt: '2026-10-13T09:00:00-03:00', summary: 'Conclusão histórica (ação) \\ com acentos e café.', checklist: [{ id: 'q', label: 'Condição verificada?', answer: 'YES', required: true }], sciences: [], decision: 'APPROVE', reviewedAt: '2026-10-13T10:00:00-03:00', signatureRepresentation: 'Marina (SESMT) \\ Demo', templateVersion: 'TEMPLATE-1' };
const permit = { id: 'permit', code: 'PT-DEMO-230', version: 2, summary: 'Conteúdo atual que não pertence à versão histórica.', snapshots: [snapshot] } as WorkPermitDto;
const textFrom = (pdf: string) => [...pdf.matchAll(/<([0-9a-f]+)> Tj/g)].map(match => String.fromCharCode(...match[1].match(/../g)!.map(value => parseInt(value, 16)))).join('\n');

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('PDF de demonstração da versão aprovada', () => {
  it('preserva os dados históricos, acentos e delimitadores sem inserir conteúdo vivo da PT', async () => {
    const pdf = await makePermitDemoPdf(permit, snapshot);
    const text = textFrom(pdf);
    expect(text).toContain('PT: PT-DEMO-230');
    expect(text).toContain('Versão: 1');
    expect(text).toContain(snapshot.summary);
    expect(text).toContain(snapshot.signatureRepresentation);
    expect(text).not.toContain(permit.summary);
    expect(text).toContain('SEM VALIDADE OPERACIONAL');
    expect(text).toContain('Identificação histórica não registrada');
    expect(pdf).not.toContain('Marina (SESMT)');
  });
  it('divide conclusões longas em páginas sem quebrar offsets nem fluxos do PDF', async () => {
    const pdf = await makePermitDemoPdf(permit, { ...snapshot, summary: 'Conferência histórica com identificação e controles. '.repeat(500) });
    const xref = Number(pdf.match(/startxref\n(\d+)/)![1]);
    expect(pdf.slice(xref, xref + 4)).toBe('xref');
    const pageCount = Number(pdf.match(/\/Count (\d+)/)![1]);
    expect(pageCount).toBeGreaterThan(1);
    expect(textFrom(pdf)).toContain(`página ${pageCount}/${pageCount}`);
    expect(new TextEncoder().encode(pdf).length).toBe(pdf.length);
    for (const match of pdf.matchAll(/\/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g)) expect(match[2].length).toBe(Number(match[1]));
  });
  it('preserva liberação, início, conclusão, conferências e dados dos participantes somente do snapshot', async () => {
    const appointment = { id: 'appointment-old', code: 'AG-ANTIGA', companyId: 'company-old', unitId: 'unit-old', serviceLabel: 'Serviço histórico', teamName: 'Equipe histórica', teamId: 'team-old', serviceTypeId: 'service-old', location: 'Galpão histórico', startsAt: '2030-01-01T12:00:00Z', endsAt: '2030-01-01T15:00:00Z', responsibleId: 'technician-old', responsibleName: 'Técnico histórico', participants: [{ workerId: 'worker-old', name: 'Pessoa histórica', serviceFunction: 'Executante histórico' }], status: 'ATTENDANCE_OPENED' as const, revision: 2, availableActions: [], history: [] };
    const eligibility = { appointmentId: appointment.id, unitId: appointment.unitId, checkedAt: '2030-01-01T11:30:00Z', requirementVersion: 'REGRA-ANTIGA', eligible: true, participants: [{ ...appointment.participants[0], eligible: true, items: [{ requirementId: 'requirement-old', label: 'Comprovante histórico', description: 'Requisito preservado', status: 'APPROVED' as const, evidenceId: 'evidence-old', evidenceRevision: 3, fileName: 'documento-antigo.pdf', validFrom: '2029-12-01', validUntil: '2030-12-01', restricted: false }] }] };
    const sciences = [{ id: 'science-old', workerId: 'worker-old', declarantName: 'Pessoa histórica', method: 'TYPED' as const, representation: 'Pessoa histórica', confirmed: true as const, collectedBy: 'technician-old', collectedByName: 'Técnico histórico', collectedAt: '2030-01-01T11:35:00Z', version: 1 }];
    const preparation = { sourceId: 'MODELO-ANTIGO', sourceRevision: '06', identification: { serviceProvider: 'Prestadora histórica', subcontractor: '', group: '', workFront: '', location: 'Local histórico', activityDescription: 'Preparação histórica', riskAnalysisReference: 'AR-ANTIGA', executorName: 'Pessoa histórica', issuerName: 'Técnico histórico', atmosphereNotes: '', watchers: '', supervisors: '' }, activities: ['Altura'], equipment: ['Cinto histórico'], controls: ['Isolamento histórico'], additionalControls: 'Controle histórico adicional', checks: [{ id: 'check-preparation', section: 'Verificação', label: 'Conferência histórica?', answer: 'YES' as const, note: 'Observação preservada' }], closingChecks: [{ id: 'check-closing', section: 'Encerramento', label: 'Local limpo?', answer: 'YES' as const }], measurements: [{ id: 'measure-old', oxygen: '20.9', carbonMonoxide: '0', explosivity: '0', other: '', measuredAt: '2030-01-01T11:20:00Z', responsible: 'Medidor histórico', instrument: 'Instrumento histórico' }] };
    const historical: PermitSnapshotDto = { ...snapshot, appointment, preparation, eligibility, sciences, startedAt: '2030-01-01T12:05:00Z', completedAt: '2030-01-01T14:50:00Z', release: { releasedAt: '2030-01-01T11:50:00Z', releasedBy: 'technician-old', releasedByName: 'Técnico histórico', appointment, templateVersion: 'TEMPLATE-LIBERADO', checklist: snapshot.checklist, sciences, eligibility, preparation } };
    const live = { ...permit, appointment: { ...appointment, location: 'Local vivo indevido' }, releasedAt: '2040-01-01T00:00:00Z', startedAt: '2040-01-02T00:00:00Z', completedAt: '2040-01-03T00:00:00Z', preparation: { ...preparation, additionalControls: 'Controle vivo indevido' }, eligibility: { ...eligibility, requirementVersion: 'REGRA-VIVA-INDEVIDA' } } as WorkPermitDto;
    const text = textFrom(await makePermitDemoPdf(live, historical));
    for (const value of ['Técnico histórico', '2030-01-01T11:50:00Z', historical.startedAt!, historical.completedAt!, 'Comprovante histórico: Conferido', 'documento-antigo.pdf', 'Prestadora histórica', 'AR-ANTIGA', 'Isolamento histórico', 'Controle histórico adicional', 'Instrumento histórico', 'Local limpo?: Sim', 'TEMPLATE-LIBERADO']) expect(text).toContain(value);
    for (const value of ['Local vivo indevido', 'Controle vivo indevido', 'REGRA-VIVA-INDEVIDA', '2040-']) expect(text).not.toContain(value);
    expect(textFrom(await makePermitDemoPdf(live, snapshot))).toContain('Liberação histórica não registrada');
  });
  it('incorpora a imagem histórica como JPEG local, deduplica cópias e mantém xref/streams ASCII corretos', async () => {
    const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const fillRect = vi.fn(), drawImage = vi.fn();
    vi.stubGlobal('Image', class {
      naturalWidth = 600; naturalHeight = 200; onload: (() => void) | null = null; onerror: (() => void) | null = null;
      set src(value: string) { if (value) queueMicrotask(() => this.onload?.()); }
    });
    const canvas = document.createElement('canvas');
    vi.spyOn(canvas, 'getContext').mockReturnValue({ fillStyle: '', fillRect, drawImage } as unknown as CanvasRenderingContext2D);
    vi.spyOn(canvas, 'toDataURL').mockReturnValue('data:image/jpeg;base64,/9j/4AAQ/9k=');
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag, options) => tag === 'canvas' ? canvas : createElement(tag, options));
    const historical = { ...snapshot, signatureMethod: 'IMAGE' as const, signatureImage: image, sciences: [{ id: 'science', workerId: 'worker', declarantName: 'Pessoa Demo', method: 'DRAWN' as const, representation: image, confirmed: true as const, collectedBy: 'technician', collectedByName: 'Técnico Demo', collectedAt: '2030-01-01T12:00:00Z', version: 1 }] };
    const pdf = await makePermitDemoPdf({ ...permit, snapshots: [] }, historical);
    expect(pdf.match(/\/Subtype \/Image/g)).toHaveLength(1);
    expect(pdf).toContain('/Filter [/ASCIIHexDecode /DCTDecode]');
    expect(pdf).toContain('/Width 600 /Height 200'); expect(pdf).toContain('ffd8ffe00010ffd9>');
    expect(pdf.match(/\/Im1 Do/g)).toHaveLength(2); expect(fillRect).toHaveBeenCalledWith(0, 0, 600, 200); expect(drawImage).toHaveBeenCalledOnce();
    const xref = Number(pdf.match(/startxref\n(\d+)/)![1]); expect(pdf.slice(xref, xref + 4)).toBe('xref');
    const entries = pdf.slice(xref).split('\n').slice(3).filter(line => /^\d{10} 00000 n/.test(line));
    entries.forEach((entry, index) => expect(pdf.slice(Number(entry.slice(0, 10)))).toMatch(new RegExp(`^${index + 1} 0 obj\\n`)));
    for (const match of pdf.matchAll(/\/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g)) expect(match[2].length).toBe(Number(match[1]));
    expect(new TextEncoder().encode(pdf).length).toBe(pdf.length);
  });
  it('não gera PDF incompleto quando uma representação histórica é inválida ou não pode ser decodificada', async () => {
    await expect(makePermitDemoPdf(permit, { ...snapshot, signatureMethod: 'IMAGE', signatureImage: 'data:image/png;base64,ZmFrZQ==' })).rejects.toThrow(/imagem PNG ou JPEG válida/);
    vi.stubGlobal('Image', class { onload: (() => void) | null = null; onerror: (() => void) | null = null; set src(value: string) { if (value) queueMicrotask(() => this.onerror?.()); } });
    const validHeader = 'data:image/png;base64,iVBORw0KGgo=';
    await expect(makePermitDemoPdf(permit, { ...snapshot, signatureMethod: 'IMAGE', signatureImage: validHeader })).rejects.toThrow(/decodificar/);
  });
});

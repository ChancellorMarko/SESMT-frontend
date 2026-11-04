import { describe, expect, it } from 'vitest';
import type { FinalPdfDto } from '../../shared/contracts/work-permits';
import { validateFinalPdf } from './final-pdf';

const now = Date.parse('2026-10-14T12:00:00Z');
const response: FinalPdfDto = {
  permitId: 'permit', version: 2, url: 'https://files.example/permit.pdf', fileName: 'pt-v2.pdf',
  mimeType: 'application/pdf', expiresAt: '2026-10-14T12:01:00Z', backendPersisted: false,
  disclaimer: 'Documento demonstrativo.',
};

describe('validação do recibo de PDF final', () => {
  it.each([null, undefined])('recusa resposta vazia sem expor erro técnico: %s', response => {
    expect(() => validateFinalPdf(response as unknown as FinalPdfDto, 'permit', 2, now)).toThrow(/não corresponde à versão solicitada/);
  });
  it('aceita a versão exata com MIME e prazo válidos', () => {
    expect(() => validateFinalPdf(response, 'permit', 2, now)).not.toThrow();
  });
  it.each([
    { permitId: 'other-permit' }, { version: 3 }, { permitId: undefined }, { version: undefined },
  ])('recusa identidade ausente ou diferente: %j', change => {
    expect(() => validateFinalPdf({ ...response, ...change }, 'permit', 2, now)).toThrow(/não corresponde à versão solicitada/);
  });
  it.each(['2026-10-14T12:00:00Z', '2026-10-14T11:59:59Z', '', 'prazo inválido'])('recusa prazo vencido ou inválido: %s', expiresAt => {
    expect(() => validateFinalPdf({ ...response, expiresAt }, 'permit', 2, now)).toThrow(/vencido ou sem prazo válido/);
  });
  it.each(['text/html', 'image/png', ''])('recusa arquivo sem MIME PDF: %s', mimeType => {
    expect(() => validateFinalPdf({ ...response, mimeType }, 'permit', 2, now)).toThrow(/não foi identificado como PDF/);
  });
});

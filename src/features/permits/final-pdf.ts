import type { FinalPdfDto } from '../../shared/contracts/work-permits';

export function validateFinalPdf(response: FinalPdfDto, permitId: string, version: number, now = Date.now()): void {
  if (!response || response.permitId !== permitId || response.version !== version) {
    throw new Error('O PDF retornado não corresponde à versão solicitada. Solicite o arquivo novamente.');
  }
  if (response.mimeType !== 'application/pdf') {
    throw new Error('O arquivo retornado não foi identificado como PDF. Solicite o arquivo novamente.');
  }
  const expiration = typeof response.expiresAt === 'string' ? Date.parse(response.expiresAt) : NaN;
  if (!Number.isFinite(expiration) || expiration <= now) {
    throw new Error('O link do PDF está vencido ou sem prazo válido. Solicite o arquivo novamente.');
  }
}

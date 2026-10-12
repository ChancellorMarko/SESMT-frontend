/** Contrato proposto. Anexos de acompanhamento não comprovam elegibilidade documental. */
export interface PermitAttachmentDto {
  id: string;
  permitId: string;
  version: number;
  /** Nome apresentado no documento; fileName é o mesmo nome no protocolo de download. */
  name: string;
  fileName: string;
  mimeType: 'image/jpeg' | 'image/png' | 'application/pdf';
  sizeBytes: number;
  caption: string;
  uploadedAt: string;
  uploadedBy: string;
  uploadedByName: string;
}
export interface PermitAttachmentCreatedDto {
  attachment: PermitAttachmentDto;
  permitRevision: number;
  permitVersion: number;
}
export interface PermitAttachmentDownloadDto {
  url: string;
  expiresAt: string;
  fileName: string;
  mimeType: PermitAttachmentDto['mimeType'];
}
export const PERMIT_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const PERMIT_ATTACHMENT_MAX_PER_VERSION = 10;
export const PERMIT_ATTACHMENT_MAX_PER_PERMIT = 20;
export const PERMIT_ATTACHMENT_CAPTION_MAX = 1000;
export const PERMIT_ATTACHMENT_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf'] as const;

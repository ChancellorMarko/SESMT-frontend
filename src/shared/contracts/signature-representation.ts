/** Proposed personal representation contract. Demonstration records exist only in memory. */
export type SignatureRepresentationMethod = 'TYPED' | 'DRAWN' | 'IMAGE';
export interface SignatureRepresentationDto {
  id: string;
  userId: string;
  version: number;
  revision: number;
  method: SignatureRepresentationMethod;
  representation: string;
  image?: string;
  updatedAt: string;
}
export interface SignatureRepresentationWriteDto {
  method: SignatureRepresentationMethod;
  representation: string;
  image?: string;
  confirmed: true;
}

export const SIGNATURE_IMAGE_MAX_FILE_BYTES = 2 * 1024 * 1024;
export const SIGNATURE_IMAGE_MAX_DATA_URL_LENGTH = 2_800_000;

/** A local PNG/JPEG representation, with matching header and bounded decoded size. */
export function isSignatureImageRepresentation(value: string): boolean {
  if (value.length > SIGNATURE_IMAGE_MAX_DATA_URL_LENGTH) return false;
  const match = /^data:image\/(png|jpeg|jpg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) return false;
  const [, mime, encoded] = match;
  if (encoded.length % 4 !== 0) return false;
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  if (encoded.length / 4 * 3 - padding > SIGNATURE_IMAGE_MAX_FILE_BYTES) return false;
  try {
    const bytes = atob(encoded.slice(0, 12));
    return mime === 'png'
      ? bytes.startsWith('\x89PNG\r\n\x1a\n')
      : bytes.startsWith('\xff\xd8\xff');
  } catch { return false; }
}

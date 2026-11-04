import { describe, expect, it } from 'vitest';
import { isSignatureImageRepresentation, SIGNATURE_IMAGE_MAX_FILE_BYTES } from './signature-image';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('imagem da representação de assinatura', () => {
  it('valida o cabeçalho PNG/JPEG, rejeitando MIME forjado, SVG e URL remota', () => {
    expect(isSignatureImageRepresentation(png)).toBe(true);
    expect(isSignatureImageRepresentation('data:image/jpeg;base64,/9j/AA==')).toBe(true);
    for (const invalid of [png.replace('png', 'jpeg'), 'data:image/png;base64,aGVsbG8=', 'data:image/svg+xml;base64,PHN2Zz4=', 'https://example.com/signature.png', 'data:image/png;base64,', 'data:image/png;base64,iVBORw0KGgo=extra']) {
      expect(isSignatureImageRepresentation(invalid)).toBe(false);
    }
  });
  it('admite arquivo de 2 MiB após expansão em base64 e rejeita um byte adicional', () => {
    const image = (size: number) => 'data:image/png;base64,' + btoa('\x89PNG\r\n\x1a\n' + '\0'.repeat(size - 8));
    expect(isSignatureImageRepresentation(image(SIGNATURE_IMAGE_MAX_FILE_BYTES))).toBe(true);
    expect(isSignatureImageRepresentation(image(SIGNATURE_IMAGE_MAX_FILE_BYTES + 1))).toBe(false);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { isDownloadUrlAllowed } from './downloads';

afterEach(() => vi.unstubAllEnvs());
describe('origens dos downloads', () => {
  it('permite a origem HTTPS configurada da API sem abrir outros hosts', () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test/api/v1');
    expect(isDownloadUrlAllowed('https://api.example.test/files/evidence.pdf')).toBe(true);
    expect(isDownloadUrlAllowed('https://api.example.test.attacker.test/evidence.pdf')).toBe(false);
  });
  it('aceita somente origens adicionais HTTPS válidas', () => {
    vi.stubEnv('VITE_DOWNLOAD_ALLOWED_ORIGINS', 'https://files.example.test, http://unsafe.example.test, inválido');
    expect(isDownloadUrlAllowed('https://files.example.test/temporary.pdf')).toBe(true);
    expect(isDownloadUrlAllowed('http://unsafe.example.test/temporary.pdf')).toBe(false);
    expect(isDownloadUrlAllowed('javascript:alert(1)')).toBe(false);
    expect(isDownloadUrlAllowed('https://user:pass@files.example.test/temporary.pdf')).toBe(false);
  });
  it('mantém URLs relativas e blobs locais sem admitir blobs de outras origens', () => {
    const origin = 'http://127.0.0.1:5173';
    expect(isDownloadUrlAllowed('/files/temporary.pdf', origin)).toBe(true);
    expect(isDownloadUrlAllowed('blob:http://127.0.0.1:5173/demo', origin)).toBe(true);
    expect(isDownloadUrlAllowed('blob:https://outside.example.test/demo', origin)).toBe(false);
  });
});

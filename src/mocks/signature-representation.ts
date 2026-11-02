import type { SignatureRepresentationDto, SignatureRepresentationWriteDto } from '../shared/contracts/signature-representation';
import { isSignatureImageRepresentation } from '../shared/lib/signature-image';
import { PermitDemoError, type PermitDemoContext } from './work-permits';

function assert(condition: unknown, status: number, code: string, message: string): asserts condition {
  if (!condition) throw new PermitDemoError(status, code, message);
}
export function makeSignatureRepresentationDemo() {
  const profiles = new Map<string, SignatureRepresentationDto>();
  const copy = <T,>(value: T): T => structuredClone(value);
  function access(context: PermitDemoContext) {
    assert(context.user.status === 'ACTIVE' && context.permissions.includes('permits.review'), 403, 'FORBIDDEN', 'Seu perfil não permite gerenciar esta representação.');
    const expiresAt = context.user.scope.expiresAt;
    assert(!expiresAt || Number.isFinite(Date.parse(expiresAt)) && Date.parse(expiresAt) > Date.now(), 403, 'SCOPE_EXPIRED', 'Sua concessão de acesso expirou.');
  }
  function forReview(context: PermitDemoContext, profileId: string, version: number) {
    access(context);
    const profile = profiles.get(context.user.id);
    assert(profile && profile.id === profileId, 403, 'SIGNATURE_PROFILE_NOT_OWNED', 'A representação selecionada não pertence ao responsável autenticado.');
    assert(profile.version === version, 409, 'SIGNATURE_PROFILE_CHANGED', 'Sua representação foi alterada. Carregue e confira o perfil atual antes de aprovar.');
    return copy(profile);
  }
  async function route(request: Request, _url: URL, path: string, context: PermitDemoContext) {
    if (path !== '/me/signature-representation') return undefined;
    access(context);
    if (request.method === 'GET') return copy(profiles.get(context.user.id) || null);
    assert(request.method === 'PUT', 405, 'METHOD_NOT_ALLOWED', 'Método não permitido.');
    const revision = profiles.get(context.user.id)?.revision || 0;
    const etag = request.headers.get('if-match');
    assert(Boolean(etag), 428, 'PRECONDITION_REQUIRED', 'Informe a revisão atual antes de salvar.');
    assert(etag === `"${revision}"`, 409, 'REVISION_CONFLICT', 'Sua representação foi alterada. Carregue o perfil atual; seu preenchimento foi preservado.');
    let body: SignatureRepresentationWriteDto;
    try { body = await request.json(); } catch { throw new PermitDemoError(422, 'VALIDATION_FAILED', 'Envie um JSON válido.'); }
    assert(body && typeof body === 'object' && body.confirmed === true, 422, 'VALIDATION_FAILED', 'Confirme o salvamento da sua representação pessoal.');
    assert(Object.keys(body).every(key => ['method', 'representation', 'image', 'confirmed'].includes(key)), 422, 'VALIDATION_FAILED', 'A representação contém campos não permitidos.');
    assert(['TYPED', 'DRAWN', 'IMAGE'].includes(body.method), 422, 'VALIDATION_FAILED', 'Escolha uma forma de representação válida.');
    assert(typeof body.representation === 'string' && body.representation.trim() === context.user.displayName.trim() && body.representation.length <= 160, 422, 'VALIDATION_FAILED', 'A representação deve identificar o responsável autenticado.');
    assert(body.method === 'TYPED' ? body.image === undefined || body.image === '' : typeof body.image === 'string' && isSignatureImageRepresentation(body.image) && (body.method !== 'DRAWN' || body.image.startsWith('data:image/png;base64,')), 422, 'VALIDATION_FAILED', 'Selecione uma representação PNG ou JPEG válida de até 2 MB.');
    // Reading the body may yield. Recheck both authorization and the same revision before mutation.
    access(context);
    assert((profiles.get(context.user.id)?.revision || 0) === revision, 409, 'REVISION_CONFLICT', 'Sua representação foi alterada. Carregue o perfil atual antes de salvar.');
    const saved: SignatureRepresentationDto = {
      id: profiles.get(context.user.id)?.id || crypto.randomUUID(), userId: context.user.id,
      version: revision + 1, revision: revision + 1, method: body.method,
      representation: body.representation.trim(), ...(body.method !== 'TYPED' ? { image: body.image } : {}),
      updatedAt: new Date().toISOString(),
    };
    profiles.set(context.user.id, saved);
    return copy(saved);
  }
  return { route, forReview };
}

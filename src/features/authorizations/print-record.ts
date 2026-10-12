import type { WorkAuthorizationDto } from '../../shared/contracts/work-authorizations';

/** A janela não altera o estado persistido nem renova a autorização. */
export function authorizationWindowNotice(record: Pick<WorkAuthorizationDto, 'status' | 'releases'>, now = Date.now()): string | undefined {
  if (record.status !== 'AUTHORIZED') return undefined;
  const release = record.releases.at(-1);
  if (!release) return 'Sem janela de autorização registrada.';
  const start = Date.parse(release.validFrom), end = Date.parse(release.validUntil);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) return 'Janela de autorização indisponível; consulte o registro.';
  if (now < start) return 'A janela registrada ainda não começou.';
  if (now >= end) return 'A janela registrada terminou. A AT exige nova conferência antes de uma revalidação.';
  return 'Janela registrada em curso. A conferência documental não substitui a avaliação das condições em campo.';
}

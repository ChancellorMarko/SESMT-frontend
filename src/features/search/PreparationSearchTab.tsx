import { useEffect, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useSearchParams } from 'react-router';
import { api, ApiError } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { PageDto } from '../../shared/contracts';
import type { WorkAuthorizationDto } from '../../shared/contracts/work-authorizations';
import type { ConfinedSpacePermitDto } from '../../shared/contracts/confined-space-permits';
import { Badge, Button, EmptyState, Feedback, Field, Spinner } from '../../shared/ui';
import { authorizationLabels, authorizationTones } from '../authorizations/support';

type Kind = 'ats' | 'pets';
type RecordDto = WorkAuthorizationDto | ConfinedSpacePermitDto;
type Denial = { error: unknown; revisions: Record<string, number> };
const pageSize = 10;
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\u0000-\u0020\u007f/?#\\]/.test(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.length <= 4000;
class PreparationResponseError extends Error {}

function checkedPage(value: unknown, kind: Kind, page: number, unitId: string): PageDto<RecordDto> {
  const label = kind === 'ats' ? 'ATs' : 'PETs';
  if (!object(value) || !Array.isArray(value.items) || value.page !== page || value.pageSize !== pageSize
    || !Number.isSafeInteger(value.total) || Number(value.total) < 0 || value.items.length > pageSize
    || value.items.length > 0 && (page - 1) * pageSize + value.items.length > Number(value.total)) {
    throw new PreparationResponseError(`A consulta não retornou uma página válida de ${label}. Tente novamente.`);
  }
  const ids = new Set<string>();
  for (const row of value.items) {
    if (!object(row) || !identifier(row.id) || ids.has(row.id) || !text(row.code) || !row.code.trim()
      || row.unitId !== unitId || !Number.isSafeInteger(row.revision) || Number(row.revision) < 1
      || !object(row.appointment) || !identifier(row.appointment.id) || row.appointment.unitId !== unitId
      || !text(row.appointment.code) || !text(row.appointment.serviceLabel) || !text(row.appointment.teamName) || !text(row.appointment.location)
      || (kind === 'ats' ? typeof row.status !== 'string' || !Object.hasOwn(authorizationLabels, row.status) : row.status !== 'DRAFT')) {
      throw new PreparationResponseError(`A consulta retornou ${label} fora do contexto esperado. Confira a unidade e tente novamente.`);
    }
    if (kind === 'pets' && (!object(row.preparation) || !object(row.preparation.identification)
      || !text(row.preparation.identification.spaceCode) || !text(row.preparation.identification.task))) {
      throw new PreparationResponseError('A consulta retornou uma preparação de PET inválida. Tente novamente.');
    }
    ids.add(row.id);
  }
  return value as unknown as PageDto<RecordDto>;
}

function criteriaError(params: URLSearchParams, kind: Kind) {
  const keys = Array.from(params.keys());
  if (keys.some(key => params.getAll(key).length > 1)) return 'O endereço contém filtros repetidos. Limpe os filtros antes de consultar.';
  const allowed = new Set(['tab', 'q', 'page', 'unitId', ...(kind === 'ats' ? ['status'] : [])]);
  if (keys.some(key => !allowed.has(key)) || params.has('tab') && params.get('tab') !== kind) return 'O endereço contém filtros incompatíveis com esta consulta. Limpe os filtros para continuar.';
  if ((params.get('q') || '').length > 200) return 'A pesquisa deve ter até 200 caracteres. Limpe os filtros para continuar.';
  const rawPage = params.get('page'), page = Number(rawPage ?? 1);
  if (rawPage !== null && (!/^[1-9]\d*$/.test(rawPage) || !Number.isSafeInteger(page) || page > Math.floor(Number.MAX_SAFE_INTEGER / pageSize))) return 'O endereço contém uma página inválida. Limpe os filtros para continuar.';
  const status = params.get('status') || '';
  if (kind === 'ats' && status && !Object.hasOwn(authorizationLabels, status)) return 'Selecione um estado válido da AT. Limpe os filtros para continuar.';
  return '';
}

function errorMessage(error: unknown, kind: Kind) {
  const label = kind === 'ats' ? 'ATs' : 'PETs';
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Sua sessão precisa ser verificada novamente.';
    if (error.status === 403) return `Seu acesso não permite consultar ${label} nesta unidade.`;
    if (error.status === 404) return `A consulta de ${label} não está disponível nesta unidade.`;
  }
  return error instanceof Error ? error.message : `Não foi possível consultar ${label}. Tente novamente.`;
}

export function PreparationSearchTab({ kind }: { kind: Kind }) {
  const { sessionKey, unitId, can } = useSession();
  return <PreparationSearchContent key={JSON.stringify([kind, sessionKey, unitId, can(kind === 'ats' ? 'at.read' : 'pet.read')])} kind={kind} />;
}

function PreparationSearchContent({ kind }: { kind: Kind }) {
  const { sessionKey, unitId, can } = useSession();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const client = useQueryClient();
  const allowed = can(kind === 'ats' ? 'at.read' : 'pet.read');
  const label = kind === 'ats' ? 'ATs' : 'PETs';
  const path = kind === 'ats' ? '/work-authorizations' : '/confined-space-permits';
  const scope = [kind === 'ats' ? 'consulta-ats' : 'consulta-pets', sessionKey, unitId];
  const contextKey = JSON.stringify(scope);
  const rawSearch = params.get('q') || '', q = rawSearch.trim(), status = params.get('status') || '';
  const page = Number(params.get('page') ?? 1);
  const appliedError = criteriaError(params, kind);
  const unitMatches = Boolean(unitId && params.get('unitId') === unitId);
  const [search, setSearch] = useState(rawSearch), [draftStatus, setDraftStatus] = useState(status), [draftError, setDraftError] = useState('');
  useEffect(() => { setSearch(rawSearch); setDraftStatus(status); setDraftError(''); }, [location.search]);
  const enabled = allowed && unitMatches && !appliedError;
  const queryKey = [...scope, page, q, ...(kind === 'ats' ? [status] : [])];
  const denialKey = [...scope, 'access-denial'];
  const denial = useQuery<Denial | null>({ queryKey: denialKey, queryFn: async () => null, enabled: false, initialData: null, staleTime: Infinity, gcTime: Infinity });
  const result = useQuery({
    queryKey,
    queryFn: async ({ signal }) => checkedPage(await api.get<unknown>(path, {
      signal, query: { unitId, page, pageSize, q: q || undefined, ...(kind === 'ats' ? { status: status || undefined } : {}) },
    }), kind, page, unitId!),
    enabled,
  });
  const deniedError = result.error instanceof PreparationResponseError || result.error instanceof ApiError && [401, 403, 404].includes(result.error.status) ? result.error : undefined;
  useEffect(() => {
    if (!enabled || !deniedError) return;
    const revisions = Object.fromEntries(client.getQueryCache().findAll({ queryKey: scope }).map(entry => [entry.queryHash, entry.state.dataUpdateCount]));
    client.setQueryData(denialKey, { error: deniedError, revisions });
  }, [client, contextKey, enabled, deniedError]);
  const cachedQuery = client.getQueryCache().find({ queryKey, exact: true });
  const fresh = enabled && denial.data && !deniedError && cachedQuery?.state.status === 'success' && cachedQuery.state.fetchStatus === 'idle'
    && cachedQuery.state.dataUpdateCount > (denial.data.revisions[cachedQuery.queryHash] ?? 0);
  useEffect(() => { if (fresh) client.setQueryData(denialKey, null); }, [client, contextKey, fresh]);
  const failed = result.isError || Boolean(denial.data);
  const unavailable = !enabled || failed;
  const items = unavailable ? [] : result.data?.items ?? [];
  const total = unavailable ? 0 : result.data?.total ?? 0, lastPage = Math.max(1, Math.ceil(total / pageSize));

  function clear() {
    const next = new URLSearchParams({ tab: kind }); if (unitId) next.set('unitId', unitId);
    setSearch(''); setDraftStatus(''); setDraftError(''); setParams(next);
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!enabled || result.isFetching || failed) return;
    if (search.length > 200 || kind === 'ats' && draftStatus && !Object.hasOwn(authorizationLabels, draftStatus)) { setDraftError('Confira a pesquisa de até 200 caracteres e os estados disponíveis.'); return; }
    setDraftError('');
    const next = new URLSearchParams({ tab: kind, unitId: unitId! });
    if (search.trim()) next.set('q', search.trim()); if (kind === 'ats' && draftStatus) next.set('status', draftStatus);
    setParams(next);
  }
  function changePage(nextPage: number) {
    const next = new URLSearchParams(params); if (nextPage === 1) next.delete('page'); else next.set('page', String(nextPage)); setParams(next);
  }
  async function retry() {
    const refreshed = await result.refetch();
    if (refreshed.isSuccess) client.setQueryData(denialKey, null);
  }

  if (!allowed) return <EmptyState title="Acesso restrito" description={`Seu perfil não permite consultar ${label}.`} />;
  if (!unitId) return <EmptyState title="Selecione uma unidade" description={`Escolha a unidade de trabalho para consultar ${label}.`} />;
  if (!unitMatches) return <Feedback>Conferindo a unidade da consulta. Aguarde a atualização dos filtros.</Feedback>;
  const blocked = result.isFetching || Boolean(appliedError) || failed;
  const searchLabel = kind === 'ats' ? 'Buscar AT por código/atendimento/equipe/local' : 'Buscar PET por código/espaço/tarefa';
  const from = { fromConsulta: true, fromSearch: location.search, fromUnitId: unitId };
  return <section className="stack" aria-label={`Consulta de ${label}`}>
    <Feedback tone="info">{kind === 'pets' ? 'A PET permanece como rascunho de preparação. A entrada não está autorizada.' : 'Consulta dos registros de AT. A autorização de uma AT não libera uma PT.'}</Feedback>
    <form className="panel form-grid" aria-label={`Filtros de consulta de ${label}`} onSubmit={submit}>
      <Field label={searchLabel}><input type="search" value={search} maxLength={200} disabled={blocked} onChange={event => setSearch(event.target.value)} /></Field>
      {kind === 'ats' && <Field label="Estado da AT"><select value={draftStatus} disabled={blocked} onChange={event => setDraftStatus(event.target.value)}><option value="">Todos</option>{status && !Object.hasOwn(authorizationLabels, status) && <option value={status}>Estado inválido</option>}{Object.entries(authorizationLabels).map(([value, name]) => <option value={value} key={value}>{name}</option>)}</select></Field>}
      <div className="actions"><Button type="submit" disabled={blocked}>Pesquisar</Button><Button variant="secondary" disabled={result.isFetching} onClick={clear}>Limpar filtros</Button></div>
    </form>
    {(appliedError || draftError) && <Feedback tone="warning">{appliedError || draftError}</Feedback>}
    {!appliedError && (failed ? <div className="panel stack"><Feedback tone="danger">{errorMessage(result.error ?? denial.data?.error, kind)}</Feedback><Button variant="secondary" disabled={result.isFetching} onClick={() => void retry()}>Tentar novamente</Button></div> : result.isPending ? <Spinner /> : <div className="panel stack">
      {!items.length ? <EmptyState title={`Nenhuma ${kind === 'ats' ? 'AT' : 'PET'} encontrada`} description={page > 1 ? 'Volte à primeira página ou ajuste os filtros para consultar os registros disponíveis.' : 'Ajuste os filtros para consultar os registros disponíveis nesta unidade.'} /> : <div className="table-wrap" role="region" aria-label={`Tabela de ${label}`} tabIndex={0}><table className="data-table"><caption className="sr-only">Resultados da consulta de {label}</caption><thead><tr><th scope="col">Código</th><th scope="col">Atendimento</th><th scope="col">{kind === 'ats' ? 'Serviço e equipe' : 'Espaço e tarefa'}</th><th scope="col">Local</th><th scope="col">Estado</th><th scope="col">Revisão</th></tr></thead><tbody>{items.map(row => <tr key={row.id}><td><Link to={`/app/${kind}/${encodeURIComponent(row.id)}`} state={from}>{row.code}</Link></td><td>{row.appointment.code}</td><td>{kind === 'ats' ? <>{row.appointment.serviceLabel}<br /><small>{row.appointment.teamName}</small></> : <>{(row as ConfinedSpacePermitDto).preparation.identification.spaceCode || 'Espaço ainda não identificado'}<br /><small>{(row as ConfinedSpacePermitDto).preparation.identification.task || row.appointment.serviceLabel}</small></>}</td><td>{row.appointment.location}</td><td>{kind === 'ats' ? <Badge tone={authorizationTones[row.status]}>{authorizationLabels[row.status]}</Badge> : <Badge tone="warning">Rascunho · entrada não autorizada</Badge>}</td><td>{row.revision}</td></tr>)}</tbody></table></div>}
      <nav className="pagination" aria-label={`Paginação da consulta de ${label}`}><span aria-live="polite">{total} registro(s) · página {page} de {lastPage}</span><div className="actions">{page > 1 && !items.length && <Button variant="secondary" disabled={result.isFetching} onClick={() => changePage(1)}>Primeira página</Button>}<Button variant="secondary" disabled={page <= 1 || result.isFetching} onClick={() => changePage(page - 1)}>Anterior</Button><Button variant="secondary" disabled={page >= lastPage || result.isFetching} onClick={() => changePage(page + 1)}>Próxima</Button></div></nav>
    </div>)}
  </section>;
}

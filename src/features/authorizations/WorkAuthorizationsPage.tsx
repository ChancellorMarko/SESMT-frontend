import { useEffect, useLayoutEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router';
import { useAppQueryParams } from '../../shared/lib/app-query-params';
import { api } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { PageDto } from '../../shared/contracts';
import type { WorkAuthorizationDto } from '../../shared/contracts/work-authorizations';
import { formatDate } from '../../shared/lib/format';
import { preparationNavigation } from '../../shared/lib/preparation-navigation';
import { Badge, Button, EmptyState, Feedback, Field, PageHeader, Spinner } from '../../shared/ui';
import { TerminologyHelp } from '../../shared/ui/TerminologyGuide';
import { authorizationError, authorizationLabels, authorizationTones, useAuthorizationClock } from './support';
import { authorizationWindowNotice } from './print-record';
import styles from './authorizations.module.css';

const pageSize = 10;

export function WorkAuthorizationsPage() {
  const { can, sessionKey, unitId } = useSession();
  const now = useAuthorizationClock();
  const location = useLocation(); const [params, setParams] = useAppQueryParams();
  // Router search updates are navigations, not queued state updates. Consecutive
  // controls must merge with the last requested URL before its render commits.
  const latestParams = useRef(new URLSearchParams(params));
  useLayoutEffect(() => { latestParams.current = new URLSearchParams(params); }, [params]);
  function writeParams(next: URLSearchParams, replace = false, flushSync = false) {
    latestParams.current = new URLSearchParams(next);
    setParams(next, { replace, flushSync });
  }
  const search = (params.get('q') || '').slice(0, 200), status = params.get('status') || '';
  const rawPage = params.get('page');
  const page = rawPage === null ? 1 : Number(rawPage);
  const invalidPage = rawPage !== null && (!/^[1-9]\d*$/.test(rawPage) || !Number.isSafeInteger(page) || page > Math.floor(Number.MAX_SAFE_INTEGER / pageSize));
  const invalidStatus = Boolean(status && !Object.hasOwn(authorizationLabels, status));
  const repeatedFilter = ['q', 'status', 'page', 'unitId'].some(name => params.getAll(name).length > 1);
  const invalidSearch = (params.get('q') || '').length > 200;
  const invalid = invalidPage || invalidStatus || repeatedFilter || invalidSearch;
  const urlUnit = params.get('unitId');
  const unitMatches = Boolean(unitId && urlUnit === unitId && params.getAll('unitId').length === 1);
  useEffect(() => {
    const currentUnit = latestParams.current.get('unitId');
    if (!unitId || currentUnit === unitId) return;
    const next = new URLSearchParams(latestParams.current); next.set('unitId', unitId);
    if (currentUnit) next.delete('page');
    writeParams(next, true);
  }, [unitId, urlUnit, params, setParams]);
  function filter(name: 'q' | 'status', value: string) {
    // Recovery buttons may repair invalid criteria while scoped reads remain blocked.
    if (!unitMatches && !invalid) return;
    const next = new URLSearchParams(latestParams.current); next.delete('page');
    if (value) next.set(name, value); else next.delete(name);
    writeParams(next, true, true);
  }
  function setPage(value: number) {
    if (!unitMatches && !invalid) return;
    const next = new URLSearchParams(latestParams.current);
    if (value === 1) next.delete('page'); else next.set('page', String(value));
    writeParams(next, false, true);
  }
  const listNavigation = preparationNavigation({ fromPreparationList: 'ats', fromSearch: location.search, fromUnitId: unitId }, unitId, 'ats');
  const list = useQuery({
    queryKey: ['work-authorizations', sessionKey, unitId, page, search.trim(), status],
    queryFn: async ({ signal }) => {
      const result = await api.get<PageDto<WorkAuthorizationDto>>('/work-authorizations', { query: { unitId, page, pageSize, q: search.trim(), status }, signal });
      if (!result || !Array.isArray(result.items) || result.page !== page || result.pageSize !== pageSize || !Number.isSafeInteger(result.total) || result.total < 0 || result.items.length > pageSize || result.items.length && (page - 1) * pageSize + result.items.length > result.total) throw new Error('A consulta não retornou uma página válida de ATs. Tente novamente.');
      if (result.items.some(item => !item || typeof item.id !== 'string' || !item.id || item.unitId !== unitId || item.appointment?.unitId !== unitId || !Object.hasOwn(authorizationLabels, item.status))) throw new Error('A consulta retornou uma AT fora do contexto esperado. Atualize a lista antes de continuar.');
      return result;
    },
    enabled: can('at.read') && unitMatches && !invalid,
  });
  if (!can('at.read')) return <EmptyState title="Acesso restrito" description="Seu perfil não pode consultar ATs." />;
  if (!unitId) return <EmptyState title="Selecione uma unidade" />;
  const items = list.data?.items || [];
  const total = list.data?.total || 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return <div className="stack"><PageHeader eyebrow="MODELO RI-S-36002" title="Autorizações de trabalho (AT)" description="No Ampara, AT identifica a Autorização de Trabalho. Consulte os registros vinculados aos atendimentos da unidade." actions={<div className="actions"><TerminologyHelp related={['PT', 'AT', 'PET']}>Entenda PT, AT e PET</TerminologyHelp>{can('at.write') && <Link className="button button--primary" to="/app/ats/nova" state={listNavigation}>Criar AT</Link>}</div>} />
    <Feedback tone="info">A AT possui seu próprio registro e não libera a execução de uma PT.</Feedback>
    <form className="panel form-grid" aria-label="Filtros de AT" onSubmit={event => event.preventDefault()}><Field label="Pesquisar AT"><input type="search" maxLength={200} value={search} disabled={!unitMatches} onChange={event => filter('q', event.target.value)} placeholder="Código, atendimento, equipe, serviço ou local" /></Field><Field label="Estado da AT"><select value={status} disabled={!unitMatches} onChange={event => filter('status', event.target.value)}><option value="">Todos</option>{invalidStatus && <option value={status}>Estado inválido</option>}{Object.entries(authorizationLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field></form>
    {invalid ? <Feedback tone="warning">{invalidStatus ? <>O endereço contém um estado de AT inválido. Selecione um estado disponível ou <Button variant="ghost" onClick={() => filter('status', '')}>Limpar estado</Button>.</> : invalidPage ? <>O endereço contém uma página de AT inválida. <Button variant="ghost" onClick={() => setPage(1)}>Voltar à primeira página</Button>.</> : <>O endereço contém critérios de AT repetidos ou uma pesquisa muito longa. <Button variant="ghost" onClick={() => writeParams(new URLSearchParams({ unitId }), true, true)}>Limpar filtros</Button>.</>}</Feedback>
      : !unitMatches || list.isPending ? <Spinner /> : list.isError ? <div className="panel stack"><Feedback tone="danger">{authorizationError(list.error)}</Feedback><Button variant="secondary" onClick={() => void list.refetch()}>Tentar novamente</Button></div>
      : <section className="stack" aria-label="Resultados de ATs">
        {!items.length ? <EmptyState title="Nenhuma AT encontrada" description={page > 1 ? 'Volte à primeira página ou ajuste os filtros para consultar as ATs disponíveis.' : 'Ajuste a pesquisa ou crie uma AT para um atendimento confirmado.'} /> : <div className={styles.grid}>{items.map(item => <article className={`panel stack ${styles.card}`} key={item.id}><div className={styles.top}><h2>{item.code}</h2><Badge tone={authorizationTones[item.status]}>{authorizationLabels[item.status]}</Badge></div>{authorizationWindowNotice(item, now) && <p className="muted">{authorizationWindowNotice(item, now)}</p>}<p>{item.appointment.serviceLabel} · {item.appointment.teamName}</p><p className="muted">{item.appointment.location} · {formatDate(item.appointment.startsAt)}</p><p className="muted">Atendimento {item.appointment.code}{item.permitCode ? ` · PT ${item.permitCode}` : ' · Sem PT vinculada'}</p><Link className="button button--secondary" to={`/app/ats/${item.id}`} state={listNavigation}>Consultar {item.code}</Link></article>)}</div>}
        <nav className="pagination" aria-label="Paginação de ATs"><span aria-live="polite">{total} AT(s) · página {page} de {pages}</span><div className="actions">{page > 1 && !items.length && <Button variant="secondary" disabled={list.isFetching} onClick={() => setPage(1)}>Primeira página</Button>}<Button variant="secondary" disabled={page <= 1 || list.isFetching} onClick={() => setPage(page - 1)}>Anterior</Button><Button variant="secondary" disabled={page >= pages || list.isFetching} onClick={() => setPage(page + 1)}>Próxima</Button></div></nav>
      </section>}
  </div>;
}

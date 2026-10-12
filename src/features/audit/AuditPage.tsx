import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { api } from '../../shared/api';
import { useSession } from '../../shared/auth/SessionProvider';
import type { AuditLogDto, PageDto } from '../../shared/contracts';
import { formatDate } from '../../shared/lib/format';
import { Badge, Button, EmptyState, Feedback, Field, PageHeader, Spinner } from '../../shared/ui';

const actionLabels: Record<string, string> = {
  LOGIN: 'Login', CREATE: 'Criação', UPDATE: 'Alteração', DOWNLOAD: 'Download', VIEW: 'Consulta', APPROVE: 'Aprovação', PUBLISH: 'Publicação', ARCHIVE: 'Arquivamento', SIGNATURE: 'Evidência de assinatura',
  DOCUMENT_CREATED: 'Documento cadastrado', CREATED: 'Documento criado', UPDATED: 'Documento alterado', DOCUMENT_VIEWED: 'Documento consultado', ARCHIVED: 'Documento arquivado', VERSION_CREATED: 'Versão criada', PREVIEWED: 'Prévia do documento consultada', REVIEW_SUBMITTED: 'Documento enviado para revisão', REVIEWED: 'Revisão registrada', APPROVED: 'Documento aprovado', PUBLISHED: 'Documento publicado', SIGNATURE_EVIDENCE_ADDED: 'Evidência de assinatura adicionada', SIGNATURE_VERIFIED: 'Evidência de assinatura conferida',
  WORKER_CREATED: 'Trabalhador cadastrado', WORKER_UPDATED: 'Trabalhador alterado', WORKER_MOVED: 'Movimentação do trabalhador', ORGANIZATION_CREATED: 'Cadastro organizacional criado', ORGANIZATION_UPDATED: 'Cadastro organizacional alterado', TYPE_CREATED: 'Tipo documental criado', USER_INVITED: 'Usuário convidado', USER_ACCESS_UPDATED: 'Acesso de usuário alterado',
};

function pageNumber(value: string | null) {
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

function validCivilDate(value: string) {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function AuditPage() {
  const { sessionKey, unitId, can } = useSession();
  const [search, setSearch] = useSearchParams();
  const page = pageNumber(search.get('page'));
  const action = search.get('action') ?? '';
  const from = search.get('from') ?? '';
  const to = search.get('to') ?? '';
  const invalidDates = !validCivilDate(from) || !validCivilDate(to);
  const invalidRange = !!from && !!to && from > to;
  const invalidFilters = invalidDates || invalidRange;
  const events = useQuery({ queryKey: ['audit', sessionKey, unitId, page, action, from, to], queryFn: ({ signal }) => api.get<PageDto<AuditLogDto>>('/audit-logs', { query: { unitId, page, pageSize: 20, action: action || undefined, from: from || undefined, to: to || undefined }, signal }), enabled: can('audit.read') && !invalidFilters });
  useEffect(() => {
    if (!search.has('page') || search.get('page') === String(page)) return;
    const next = new URLSearchParams(search);
    next.set('page', String(page));
    setSearch(next, { replace: true });
  }, [page, search, setSearch]);
  const lastPage = events.data ? Math.max(1, Math.ceil(events.data.total / events.data.pageSize)) : page;
  useEffect(() => {
    if (!events.data || events.isFetching || events.isError || invalidFilters || page <= lastPage) return;
    const next = new URLSearchParams(search);
    next.set('page', String(lastPage));
    setSearch(next, { replace: true });
  }, [events.data, events.isError, events.isFetching, invalidFilters, lastPage, page, search, setSearch]);
  if (!can('audit.read')) return <Feedback tone="warning">Seu acesso não permite consultar auditoria.</Feedback>;
  function changePage(nextPage: number) { const next = new URLSearchParams(search); next.set('page', String(nextPage)); setSearch(next); }
  return <div className="stack">
    <PageHeader eyebrow="RASTREABILIDADE" title="Auditoria" description="Consulta dos eventos fornecidos pela API, conforme escopo e período autorizados." actions={<Badge tone="neutral">Somente leitura</Badge>} />
    <form key={search.toString()} className="panel toolbar" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); const next = new URLSearchParams(); for (const key of ['action', 'from', 'to']) { const value = String(data.get(key) ?? ''); if (value) next.set(key, value); } setSearch(next); }}>
      <Field label="Ação"><select name="action" defaultValue={action}><option value="">Todas</option>{action && !actionLabels[action] && <option value={action}>{action}</option>}{Object.entries(actionLabels).map(([code, label]) => <option value={code} key={code}>{label}</option>)}</select></Field><Field label="De" error={validCivilDate(from) ? undefined : 'A data recebida no endereço é inválida.'}><input name="from" type="date" defaultValue={from} /></Field><Field label="Até" error={validCivilDate(to) ? undefined : 'A data recebida no endereço é inválida.'}><input name="to" type="date" defaultValue={to} /></Field><Button type="submit">Filtrar eventos</Button>{(action || from || to) && <Button variant="ghost" onClick={() => setSearch(new URLSearchParams())}>Limpar filtros</Button>}
    </form>
    {invalidDates && <Feedback tone="danger">Corrija as datas do período ou limpe os filtros para consultar os eventos.</Feedback>}{!invalidDates && invalidRange && <Feedback tone="danger">A data final deve ser igual ou posterior à inicial.</Feedback>}{events.isPending && !invalidFilters && <Spinner />}{events.isError && !invalidFilters && <Feedback tone="danger">{events.error.message} <Button variant="ghost" disabled={events.isFetching} onClick={() => events.refetch()}>Tentar novamente</Button></Feedback>}
    {events.data && !events.isError && !invalidFilters && page <= lastPage && <section className="panel stack" aria-label="Eventos de auditoria"><div className="table-wrap"><table className="data-table"><thead><tr><th>Data e hora</th><th>Ação</th><th>Recurso</th><th>Ator</th><th>Resultado</th><th>Rastreio</th></tr></thead><tbody>{events.data.items.map((item) => <tr key={item.id}><td>{formatDate(item.occurredAt)}</td><td>{actionLabels[item.action] ?? item.action}</td><td>{item.resourceType}<br /><small className="muted">{item.resourceId}</small></td><td><small>{item.actorId}</small></td><td><Badge tone={item.outcome === 'SUCCESS' ? 'success' : item.outcome === 'DENIED' || item.outcome === 'ERROR' ? 'danger' : item.outcome === 'DEMO' ? 'info' : 'warning'}>{item.outcome === 'SUCCESS' ? 'Concluído' : item.outcome === 'DENIED' ? 'Negado' : item.outcome === 'ERROR' ? 'Falha' : item.outcome === 'DEMO' ? 'Demonstração' : item.outcome}</Badge></td><td><small>{item.requestId}</small></td></tr>)}</tbody></table></div>{!events.data.items.length && <EmptyState title="Nenhum evento encontrado" description="Altere o período ou os filtros para consultar a trilha disponível." />}<div className="actions"><span className="muted">{events.data.total} eventos · página {page} de {lastPage} · America/Sao_Paulo</span><Button variant="ghost" onClick={() => changePage(page - 1)} disabled={page <= 1 || events.isFetching}>Anterior</Button><Button variant="ghost" onClick={() => changePage(page + 1)} disabled={page >= lastPage || events.isFetching}>Próxima</Button></div></section>}
    <Feedback tone="info">Os registros são mantidos pelo serviço da API. Esta tela não cria, altera ou exclui a trilha de auditoria.</Feedback>
  </div>;
}

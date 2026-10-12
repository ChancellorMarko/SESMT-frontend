import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { PageDto, WorkerDto, OrganizationDto } from '../../shared/contracts';
import { Badge, Button, EmptyState, Field, PageHeader, Spinner } from '../../shared/ui';
import { QueryError, workerStatusLabels } from './support';
import { positivePage } from '../documents/expiry';

export function WorkersPage() {
  const { unitId, sessionKey, can } = useSession();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';
  const [search, setSearch] = useState(q);
  useEffect(() => { setSearch(q); }, [q]);
  const status = params.get('status') || '';
  const page = positivePage(params.get('page'));
  useEffect(() => {
    if (params.has('page') && params.get('page') !== String(page)) {
      const next = new URLSearchParams(params); next.set('page', String(page)); setParams(next, { replace: true });
    }
  }, [page, params, setParams]);
  const workers = useQuery({
    queryKey: ['workers', sessionKey, unitId, q, status, page],
    queryFn: ({ signal }) => api.get<PageDto<WorkerDto>>('/workers', { signal, query: { q: q || undefined, status: status || undefined, unitId: unitId || undefined, page, pageSize: 10 } }),
    enabled: can('workers.read'),
  });
  const organization = useQuery({
    queryKey: ['organization', sessionKey, unitId],
    queryFn: ({ signal }) => api.get<OrganizationDto>('/organization', { signal, query: { unitId: unitId || undefined } }),
    enabled: can('organization.read'),
  });
  function change(key: string, value: string) {
    setParams(previous => { const next = new URLSearchParams(previous); value ? next.set(key, value) : next.delete(key); next.delete('page'); return next; });
  }
  if (!can('workers.read')) return <EmptyState title="Acesso restrito" description="Seu perfil não possui acesso ao cadastro de trabalhadores." />;
  const unitName = (id: string) => organization.data?.units.find(item => item.id === id)?.name || 'Unidade vinculada';
  const sectorName = (id: string) => organization.data?.sectors.find(item => item.id === id)?.name || 'Setor vinculado';
  return <>
    <PageHeader eyebrow="Pessoas e vínculos" title="Trabalhadores" description="Encontre cadastros, documentos permitidos e o histórico de cada vínculo." actions={can('workers.write') && <Link className="button button--primary" to="/app/trabalhadores/novo">Novo trabalhador</Link>} />
    <section className="panel stack" aria-label="Pesquisa de trabalhadores">
      <form className="toolbar" onSubmit={event => { event.preventDefault(); change('q', search.trim()); }}>
        <Field label="Buscar nome ou matrícula"><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Digite um nome ou matrícula" /></Field>
        <Field label="Situação"><select value={status} onChange={event => change('status', event.target.value)}><option value="">Todas as situações</option>{Object.entries(workerStatusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></Field>
        <Button type="submit" variant="secondary">Pesquisar</Button>
        {(q || status) && <Button type="button" variant="ghost" onClick={() => { setSearch(''); setParams({}); }}>Limpar filtros</Button>}
      </form>
      {workers.isPending && <Spinner />}
      {workers.isError && <QueryError error={workers.error} retry={() => void workers.refetch()} />}
      {workers.data && !workers.isError && (workers.data.items.length ? <>
        <div className="table-wrap"><table className="data-table"><caption className="sr-only">Trabalhadores encontrados</caption><thead><tr><th>Trabalhador</th><th>Matrícula</th><th>Unidade / setor</th><th>Situação</th><th><span className="sr-only">Ações</span></th></tr></thead><tbody>{workers.data.items.map(worker => <tr key={worker.id}><td><Link to={`/app/trabalhadores/${worker.id}`}>{worker.fullName}</Link><span className="muted" style={{ display: 'block' }}>{worker.employmentType}</span></td><td>{worker.registration}</td><td>{unitName(worker.unitId)}<span className="muted" style={{ display: 'block' }}>{sectorName(worker.sectorId)}</span></td><td><Badge tone={worker.status === 'ACTIVE' ? 'success' : worker.status === 'ON_LEAVE' ? 'warning' : 'neutral'}>{workerStatusLabels[worker.status]}</Badge></td><td><Link to={`/app/trabalhadores/${worker.id}`} aria-label={`Consultar ${worker.fullName}`}>Consultar →</Link></td></tr>)}</tbody></table></div>
        <div className="toolbar"><p className="muted">{workers.data.total} registro(s) · Página {page} de {Math.max(1, Math.ceil(workers.data.total / workers.data.pageSize))}</p><div className="actions"><Button variant="secondary" disabled={page <= 1} onClick={() => setParams(previous => { const next = new URLSearchParams(previous); next.set('page', String(page - 1)); return next; })}>Anterior</Button><Button variant="secondary" disabled={page * workers.data.pageSize >= workers.data.total} onClick={() => setParams(previous => { const next = new URLSearchParams(previous); next.set('page', String(page + 1)); return next; })}>Próxima</Button></div></div>
      </> : <><EmptyState title={page > 1 ? 'Esta página não possui resultados' : q || status ? 'Nenhum resultado para estes filtros' : 'Nenhum trabalhador cadastrado'} description={page > 1 ? 'Volte à primeira página para consultar os trabalhadores com os filtros atuais.' : q || status ? 'Revise a busca ou limpe os filtros para consultar outros registros.' : 'Cadastre o primeiro vínculo para organizar os documentos da equipe.'} />{page > 1 && <Button variant="secondary" onClick={() => setParams(previous => { const next = new URLSearchParams(previous); next.delete('page'); return next; })}>Voltar à primeira página</Button>}</>)}
    </section>
  </>;
}

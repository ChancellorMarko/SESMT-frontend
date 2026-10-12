import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { WorkAuthorizationDto, WorkAuthorizationStatus } from '../../shared/contracts/work-authorizations';
import { formatDate } from '../../shared/lib/format';
import { Badge, Button, EmptyState, Feedback, Field, PageHeader, Spinner } from '../../shared/ui';
import { authorizationError, authorizationLabels, authorizationTones, useAuthorizationClock } from './support';
import styles from './authorizations.module.css';
import { authorizationWindowNotice } from './print-record';

export function WorkAuthorizationsPage() {
  const { can, sessionKey, unitId } = useSession();
  const now = useAuthorizationClock();
  const [search, setSearch] = useState(''); const [status, setStatus] = useState('');
  const list = useQuery({ queryKey: ['work-authorizations', sessionKey, unitId], queryFn: ({ signal }) => api.get<WorkAuthorizationDto[]>('/work-authorizations', { query: { unitId }, signal }), enabled: can('at.read') && Boolean(unitId) });
  if (!can('at.read')) return <EmptyState title="Acesso restrito" description="Seu perfil não pode consultar ATs." />;
  if (!unitId) return <EmptyState title="Selecione uma unidade" />;
  const query = search.trim().toLocaleLowerCase('pt-BR');
  const items = (list.data || []).filter(item => item.unitId === unitId && (!status || item.status === status) && [item.code, item.appointment.code, item.appointment.teamName, item.appointment.location, item.appointment.serviceLabel].some(value => value.toLocaleLowerCase('pt-BR').includes(query)));
  return <div className="stack"><PageHeader eyebrow="MODELOS SST" title="Autorizações de Trabalho" description="ATs do modelo RI-S-36002 vinculadas aos atendimentos da unidade." actions={can('at.write') && <Link className="button button--primary" to="/app/ats/nova">Criar AT</Link>} />
    <Feedback tone="info">Demonstração em memória, sem validade operacional. A AT possui seu próprio registro e não libera a execução de uma PT.</Feedback>
    <div className="panel form-grid"><Field label="Pesquisar AT"><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Código, atendimento, equipe ou local" /></Field><Field label="Estado da AT"><select value={status} onChange={event => setStatus(event.target.value)}><option value="">Todos</option>{Object.entries(authorizationLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field></div>
    {list.isPending ? <Spinner /> : list.isError ? <div className="panel stack"><Feedback tone="danger">{authorizationError(list.error)}</Feedback><Button variant="secondary" onClick={() => void list.refetch()}>Tentar novamente</Button></div> : !items.length ? <EmptyState title="Nenhuma AT encontrada" description="Ajuste a pesquisa ou crie uma AT para um atendimento confirmado." /> : <div className={styles.grid}>{items.map(item => <article className={`panel stack ${styles.card}`} key={item.id}><div className={styles.top}><h2>{item.code}</h2><Badge tone={authorizationTones[item.status as WorkAuthorizationStatus]}>{authorizationLabels[item.status]}</Badge></div>{authorizationWindowNotice(item, now) && <p className="muted">{authorizationWindowNotice(item, now)}</p>}<p>{item.appointment.serviceLabel} · {item.appointment.teamName}</p><p className="muted">{item.appointment.location} · {formatDate(item.appointment.startsAt)}</p><p className="muted">Atendimento {item.appointment.code}{item.permitCode ? ` · PT ${item.permitCode}` : ' · Sem PT vinculada'}</p><Link className="button button--secondary" to={`/app/ats/${item.id}`}>Consultar {item.code}</Link></article>)}</div>}
  </div>;
}

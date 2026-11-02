import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { api, ApiError } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import { InvalidReadResponse, useVerifiedRead } from '../../shared/lib/verified-read';
import { formatDate } from '../../shared/lib/format';
import { Badge, Button, EmptyState, Feedback, Field, InfoButton, Modal, PageHeader, Spinner } from '../../shared/ui';
import { checkedNativeDesignations, nativeDesignationTypes, nativeId, type NativeDesignation } from './contracts';
import { NativeCommandDialog } from './NativeCommandDialog';
import styles from '../../shared/ui/NativeRecords.module.css';

export function NativeDesignationsPage() {
  const { sessionKey, unitId } = useSession();
  return <Designations key={`${sessionKey}:${unitId}`}/>;
}
function Designations() {
  const { sessionKey, unitId, can } = useSession(), client = useQueryClient(), location=useLocation(),navigate=useNavigate(),{id}=useParams();
  const [type, setType] = useState(''), [localOnly, setLocal] = useState(false), [page, setPage] = useState(1), [selected, select] = useState<NativeDesignation>(), [confirmation, setConfirmation] = useState('');
  const validId=!id||nativeId.safeParse(id).success;
  const result = useVerifiedRead({ queryKey: ['native-designations', sessionKey], enabled: validId, request: signal => api.get<unknown>('/designations', { signal }), validate: checkedNativeDesignations });
  const deep=id&&validId?result.data?.find(item=>item.id===id.toLowerCase()):undefined;
  const items = result.data?.filter(item => (!type || item.type === type) && (!localOnly || item.locationIds.includes(unitId ?? ''))) ?? [];
  const pages = Math.max(1, Math.ceil(items.length / 10)), current = Math.min(page, pages);
  return <div className="stack"><PageHeader title="Designações" description="Designações retornadas pela API para os escopos da conta. A situação indica revogação; a validade para uma operação depende também do período, serviços e locais da designação." actions={<><Button variant="secondary" disabled={result.isFetching} onClick={() => void result.refetch()}>Atualizar designações</Button>{can('pt:editar')&&<Link className="button button--primary" to="/app/designacoes/nova">Nova designação</Link>}</>}/>
    {location.state?.nativeCreated===true&&<Feedback tone="success">Designação registrada.</Feedback>}
    {(!validId||id&&result.data&&!deep)&&<Feedback tone="warning">Designação não encontrada nos acessos atuais.</Feedback>}
    <div className={`panel ${styles.toolbar}`}><Field label="Tipo de designação"><select value={type} onChange={event => { setType(event.target.value); setPage(1); }}><option value="">Todos</option>{Object.entries(nativeDesignationTypes).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></Field><label><input type="checkbox" checked={localOnly} disabled={!unitId} onChange={event => { setLocal(event.target.checked); setPage(1); }}/> Somente unidade selecionada</label></div>
    {result.isPending && <Spinner/>}{result.isError && <Feedback tone="danger">{result.error instanceof ApiError && result.error.status === 403 ? 'A API não autorizou a consulta de designações para esta conta.' : 'Não foi possível conferir as designações.'}</Feedback>}
    {confirmation && result.data && <Feedback tone="success">{confirmation}</Feedback>}
    {result.data && <section className={styles.results} aria-label="Designações da conta">{!items.length ? <EmptyState title="Nenhuma designação encontrada" description="Não há registros para este filtro e seus acessos atuais."/> : <div className={styles.scroll} role="region" aria-label="Tabela de designações" tabIndex={0}><table className={`data-table ${styles.table}`}><thead><tr><th scope="col">Tipo e origem</th><th scope="col">Vigência</th><th scope="col">Situação e ações</th></tr></thead><tbody>{items.slice((current-1)*10,current*10).map(item => <tr key={item.id}><td><strong>{nativeDesignationTypes[item.type]}</strong><small>{item.origin}</small></td><td>{formatDate(item.startsAt)}<small>{formatDate(item.endsAt)}</small></td><td><Badge>{item.revokedAt ? 'Revogada' : item.active ? 'Não revogada' : 'Inativa'}</Badge><div className="actions"><InfoButton title={`Designação: ${item.origin}`}><dl className={styles.details}><dt>Designação</dt><dd>{item.id}</dd><dt>Trabalhador</dt><dd>{item.personId}</dd><dt>Serviços</dt><dd>{item.serviceIds.join(' · ')}</dd><dt>Locais</dt><dd>{item.locationIds.join(' · ')}</dd><dt>Atribuída por</dt><dd>{item.assignedBy}</dd><dt>Versão</dt><dd>{item.version}</dd><dt>Revogação</dt><dd>{formatDate(item.revokedAt)}</dd></dl></InfoButton>{can('pt:editar') && item.active && !item.revokedAt && <Button variant="ghost" disabled={result.isFetching} aria-label={`Revogar ${item.origin}`} onClick={() => { select(item); setConfirmation(''); }}>Revogar</Button>}</div></td></tr>)}</tbody></table></div>}
    <nav className={styles.footer} aria-label="Paginação de designações"><span>{items.length} designação(ões) · página {current} de {pages}</span><div className="actions"><Button variant="secondary" disabled={current<=1} onClick={()=>setPage(current-1)}>Anterior</Button><Button variant="secondary" disabled={current>=pages} onClick={()=>setPage(current+1)}>Próxima</Button></div></nav></section>}
    {selected && result.data?.some(item => item.id === selected.id) && can('pt:editar') && <NativeCommandDialog title="Revogar designação" dirty={false} onClose={() => select(undefined)} submitLabel="Confirmar revogação" perform={async signal => {
      const value = await api.post<unknown>(`/designations/${selected.id}/revoke`, { expectedVersion: selected.version }, { signal });
      const updated = checkedNativeDesignations([value])[0];
      if (updated.id !== selected.id || updated.personId !== selected.personId || updated.active || !updated.revokedAt || updated.version !== selected.version+1) throw new InvalidReadResponse();
    }} onDone={async () => { select(undefined); setConfirmation('Revogação confirmada pela API.'); await Promise.all([client.invalidateQueries({ queryKey: ['native-designations', sessionKey] }), client.invalidateQueries({ queryKey: ['native-dashboard', sessionKey] })]); }}>{() => <p>Revogar a designação de <strong>{nativeDesignationTypes[selected.type]}</strong> com origem <strong>{selected.origin}</strong>?</p>}</NativeCommandDialog>}
    <Modal open={Boolean(deep)} title="Detalhes da designação" onClose={()=>void navigate('/app/designacoes',{replace:true})}>{deep&&<dl className={styles.details}><dt>Tipo</dt><dd>{nativeDesignationTypes[deep.type]}</dd><dt>Origem</dt><dd>{deep.origin}</dd><dt>Trabalhador</dt><dd>{deep.personId}</dd><dt>Início</dt><dd>{formatDate(deep.startsAt)}</dd><dt>Término</dt><dd>{formatDate(deep.endsAt)}</dd><dt>Locais</dt><dd>{deep.locationIds.join(' · ')}</dd><dt>Serviços</dt><dd>{deep.serviceIds.join(' · ')}</dd><dt>Versão</dt><dd>{deep.version}</dd></dl>}</Modal>
  </div>;
}

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useSearchParams } from 'react-router';
import { api } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { PageDto } from '../../shared/contracts';
import type { ConfinedSpacePermitDto } from '../../shared/contracts/confined-space-permits';
import { Badge, Button, EmptyState, Feedback, Field, PageHeader, Spinner } from '../../shared/ui';
import { TerminologyHelp } from '../../shared/ui/TerminologyGuide';
import { formatDate } from '../../shared/lib/format';
import { preparationNavigation } from '../../shared/lib/preparation-navigation';
import { petError, petPage } from './support';
import styles from './PetPages.module.css';

export function PetsPage() {
  const session=useSession(); const location=useLocation(); const [params,setParams]=useSearchParams();
  const listNavigation=preparationNavigation({fromPreparationList:'pets',fromSearch:location.search,fromUnitId:session.unitId},session.unitId,'pets');
  const q=(params.get('q') ?? '').trim().slice(0,200),page=petPage(params.get('page'));
  const [search,setSearch]=useState(q);
  useEffect(()=>setSearch(q),[q]);
  const urlUnit=params.get('unitId');
  useEffect(()=>{
    if(!session.unitId || urlUnit===session.unitId) return;
    const next=new URLSearchParams(params);next.set('unitId',session.unitId);
    if(urlUnit) next.delete('page');setParams(next,{replace:true});
  },[session.unitId,urlUnit,params,setParams]);
  const list=useQuery({queryKey:['confined-space-permits',session.sessionKey,session.unitId,page,q],queryFn:({signal})=>api.get<PageDto<ConfinedSpacePermitDto>>('/confined-space-permits',{signal,query:{unitId:session.unitId,page,pageSize:10,q}}),enabled:session.can('pet.read')&&Boolean(session.unitId)&&(!urlUnit||urlUnit===session.unitId)});
  function setPage(value:number){const next=new URLSearchParams(params);next.set('page',String(value));setParams(next);}
  return <div className="stack"><PageHeader eyebrow="ESPAÇOS CONFINADOS · PREPARAÇÃO DOCUMENTAL" title="Permissões de entrada e trabalho (PET)" description="Prepare o rascunho com a identificação do espaço, as funções previstas, os controles e os registros atmosféricos." actions={<div className="actions"><TerminologyHelp related={['PT','AT','PET']}>Entenda PT, AT e PET</TerminologyHelp>{session.can('pet.write')&&<Link className="button button--primary" to="/app/pets/nova" state={listNavigation}>Nova PET</Link>}</div>}/>
    <Feedback>Esta etapa organiza rascunhos. A emissão da PET e o controle de entrada ainda não estão disponíveis.</Feedback>
    <form className="panel toolbar" onSubmit={event=>{event.preventDefault();const next=new URLSearchParams(params);next.delete('page');if(search.trim())next.set('q',search.trim().slice(0,200));else next.delete('q');setParams(next);}}><Field label="Buscar PET por código, espaço ou tarefa"><input maxLength={200} value={search} onChange={event=>setSearch(event.target.value)} placeholder="Ex.: PET, tanque, inspeção"/></Field><Button type="submit">Buscar</Button>{q&&<Button variant="secondary" onClick={()=>{const next=new URLSearchParams(params);next.delete('q');next.delete('page');setParams(next);}}>Limpar busca</Button>}</form>
    {!session.can('pet.read')?<EmptyState title="Acesso restrito"/>:!session.unitId?<EmptyState title="Selecione uma unidade"/>:list.isPending?<Spinner/>:list.isError?<div className="panel stack"><Feedback tone="danger">{petError(list.error)}</Feedback><Button onClick={()=>void list.refetch()}>Tentar novamente</Button></div>:<section className="panel stack" aria-label="Preparações de PET">
      {!list.data?.items.length?<EmptyState title="Nenhuma preparação de PET encontrada" description={page>1?'Volte à primeira página para consultar os registros disponíveis.':'Crie um rascunho a partir de um atendimento da unidade ou ajuste a busca.'}/>:<div className={styles.records}>{list.data.items.map(record=><article key={record.id} className={styles.record}><div><Link to={`/app/pets/${record.id}`} state={listNavigation}><strong>{record.code}</strong></Link><h2>{record.preparation.identification.spaceCode||'Espaço ainda não identificado'}</h2><p>{record.preparation.identification.task||record.appointment.serviceLabel}</p><small>{record.appointment.code} · {record.appointment.location}</small></div><div className={styles.recordMeta}><Badge tone="warning">Rascunho · entrada não autorizada</Badge><span>Revisão {record.revision}</span><small>Atualizado em {formatDate(record.updatedAt)}</small></div></article>)}</div>}
      <div className="pagination"><span>{list.data?.total ?? 0} preparação(ões) · página {page}</span><div className="actions">{page>1&&!list.data?.items.length&&<Button variant="secondary" onClick={()=>setPage(1)}>Primeira página</Button>}<Button variant="secondary" disabled={page<=1||list.isFetching} onClick={()=>setPage(page-1)}>Anterior</Button><Button variant="secondary" disabled={page*10>=(list.data?.total ?? 0)||list.isFetching} onClick={()=>setPage(page+1)}>Próxima</Button></div></div>
    </section>}
  </div>;
}

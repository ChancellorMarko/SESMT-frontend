import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useParams } from 'react-router';
import { useAppQueryParams } from '../../shared/lib/app-query-params';
import { api } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { ConfinedSpacePermitDto } from '../../shared/contracts/confined-space-permits';
import { Badge, Button, EmptyState, Feedback, Field, PageHeader, Spinner } from '../../shared/ui';
import { formatDate } from '../../shared/lib/format';
import { preparationListPath, preparationOrigin } from '../../shared/lib/preparation-navigation';
import { petError, petEventLabels, petKey } from './support';
import { preparationPending } from './model';
import { PetPreparationView } from './PetPreparationView';
import styles from './PetPages.module.css';

export function PetDetailPage() {
  const {id}=useParams(); const session=useSession(),location=useLocation();const [params,setParams]=useAppQueryParams();
  const listNavigation=preparationOrigin(location.state,session.unitId,'pets');
  const returnPath=preparationListPath(listNavigation,'pets');
  const returnLabel=listNavigation&&'fromConsulta' in listNavigation?'Voltar à consulta':'Voltar às PETs';
  const query=useQuery({queryKey:petKey(session.sessionKey,session.unitId,id),queryFn:({signal})=>api.get<ConfinedSpacePermitDto>(`/confined-space-permits/${id}`,{signal,query:{unitId:session.unitId}}),enabled:session.can('pet.read')&&Boolean(session.unitId&&id)});
  if(!session.can('pet.read'))return <EmptyState title="Acesso restrito"/>;
  if(!session.unitId)return <EmptyState title="Selecione uma unidade"/>;
  if(query.isPending)return <Spinner/>;
  if(query.isError||!query.data)return <div className="panel stack"><Feedback tone="danger">{petError(query.error)}</Feedback><Button onClick={()=>void query.refetch()}>Tentar novamente</Button><Link to={returnPath}>{returnLabel}</Link></div>;
  const record=query.data;if(record.id!==id||record.unitId!==session.unitId||record.appointment.unitId!==session.unitId)return <EmptyState title="PET de outra unidade"/>;
  const revisionParam=params.get('revision'),revision=revisionParam===null?record.revision:Number(revisionParam);
  const snapshot=record.snapshots.find(item=>item.revision===revision);
  if(!Number.isSafeInteger(revision)||revision<1||revision!==record.revision&&!snapshot)return <div className="panel stack"><EmptyState title="Revisão não encontrada" description="A revisão solicitada não será substituída por outra."/><Button onClick={()=>setParams({},{replace:true,state:listNavigation,flushSync:true})}>Consultar revisão atual</Button></div>;
  const preparation=revision===record.revision?record.preparation:snapshot!.preparation;
  const pending=preparationPending(preparation),historical=revision!==record.revision;
  const success=(location.state as {success?:string}|null)?.success;
  return <div className="stack"><PageHeader eyebrow="RI-S-36003 · PREPARAÇÃO" title={record.code} description={`${record.appointment.code} · ${preparation.identification.spaceCode||'Espaço ainda não identificado'}`} actions={<><Link className="button button--secondary" to={returnPath}>{returnLabel}</Link>{!historical&&record.availableActions.includes('EDIT')&&session.can('pet.write')&&<Link className="button button--primary" to={`/app/pets/${id}/editar`} state={listNavigation}>Editar preparação</Link>}<Link className="button button--secondary" to={`/app/pets/${id}/imprimir?revision=${revision}`} state={listNavigation}>Visualizar / imprimir rascunho</Link></>}/>
    {success&&!historical&&<Feedback tone="success">{success}</Feedback>}
    <Feedback tone="warning">Rascunho de preparação · entrada não autorizada. A emissão da PET e o controle de entrada ainda não estão disponíveis.</Feedback>
    <section className="panel stack"><div className="actions"><Badge tone={historical?'neutral':'warning'}>{historical?'Revisão histórica':'Rascunho atual'}</Badge><span className="muted">Revisão {revision} · {formatDate(historical?snapshot!.savedAt:record.updatedAt)}</span></div><Field label="Revisão da preparação"><select value={revision} onChange={event=>{const next=new URLSearchParams(params);next.set('revision',event.target.value);setParams(next,{state:listNavigation,flushSync:true});}}>{record.snapshots.map(item=><option key={item.revision} value={item.revision}>Revisão {item.revision}{item.revision===record.revision?' · atual':''} · {formatDate(item.savedAt)}</option>)}</select></Field><p className="muted">Atendimento de origem: {record.appointment.serviceLabel} · {record.appointment.location}. O rascunho conserva o contexto do atendimento usado em sua criação.</p>{session.can('appointments.read')&&<Link to={`/app/agenda/${record.appointment.id}`}>Consultar atendimento de origem →</Link>}</section>
    <section className="panel stack"><h2>Preenchimento da preparação</h2>{pending.length?<><p className="muted">Informações ainda não preenchidas. Esta lista verifica o preenchimento do rascunho.</p><ul className={styles.pending}>{pending.map((item,index)=><li key={`${index}:${item}`}>{item}</li>)}</ul></>:<p className="muted">Os campos acompanhados estão preenchidos. Isso não constitui emissão da PET nem avaliação de segurança.</p>}</section>
    <article className={`panel ${styles.preparation}`} aria-label="Preparação da PET"><PetPreparationView value={preparation}/></article>
    <section className="panel stack"><h2>Histórico de salvamento</h2><ol className={styles.history}>{record.history.filter(item=>!item.version||item.version<=revision).map(event=><li key={event.id}><strong>{petEventLabels[event.action]||event.action.replaceAll('_',' ')}</strong><p>{event.actorName} · {formatDate(event.occurredAt)}{event.version?` · revisão ${event.version}`:''}</p></li>)}</ol><details><summary>Origem documental</summary><p className={styles.hash}>{record.sourceId} · revisão {record.sourceRevision}<br/>SHA-256: {record.sourceSha256}</p></details></section>
  </div>;
}

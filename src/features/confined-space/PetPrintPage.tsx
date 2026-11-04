import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useParams, useSearchParams } from 'react-router';
import { Printer } from 'lucide-react';
import { api, API_MODE } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import { BrandLogo } from '../../shared/brand/BrandLogo';
import type { ConfinedSpacePermitDto } from '../../shared/contracts/confined-space-permits';
import { Button, EmptyState, Feedback, PageHeader, Spinner } from '../../shared/ui';
import { formatDate } from '../../shared/lib/format';
import { preparationOrigin } from '../../shared/lib/preparation-navigation';
import { petError, petKey } from './support';
import { PetPreparationView } from './PetPreparationView';
import styles from '../permits/print.module.css';

export function PetPrintPage() {
  const {id}=useParams();const [params]=useSearchParams();const session=useSession();
  const location=useLocation();const listNavigation=preparationOrigin(location.state,session.unitId,'pets');
  const query=useQuery({queryKey:petKey(session.sessionKey,session.unitId,id),queryFn:({signal})=>api.get<ConfinedSpacePermitDto>(`/confined-space-permits/${id}`,{signal,query:{unitId:session.unitId}}),enabled:session.can('pet.read')&&Boolean(session.unitId&&id)});
  const record=query.data,revision=params.has('revision')?Number(params.get('revision')):record?.revision;
  const titleAllowed=session.can('pet.read')&&!query.isError&&record?.id===id&&record?.unitId===session.unitId&&record?.appointment.unitId===session.unitId;
  useEffect(()=>{if(!record||!titleAllowed)return;const previous=document.title;document.title=`${record.code} — rascunho ${revision} — Ampara SESMT`;return ()=>{document.title=previous;};},[record?.code,revision,titleAllowed]);
  if(!session.can('pet.read'))return <EmptyState title="Acesso restrito"/>;
  if(!session.unitId)return <EmptyState title="Selecione uma unidade"/>;
  if(query.isPending)return <Spinner/>;
  if(query.isError||!record)return <div className="panel stack"><Feedback tone="danger">{petError(query.error)}</Feedback><Button onClick={()=>void query.refetch()}>Tentar novamente</Button></div>;
  if(record.id!==id||record.unitId!==session.unitId||record.appointment.unitId!==session.unitId)return <EmptyState title="PET de outra unidade"/>;
  const snapshot=record.snapshots.find(item=>item.revision===revision);
  if(!Number.isSafeInteger(revision)||(revision ?? 0)<1||revision!==record.revision&&!snapshot)return <div className="panel stack"><EmptyState title="Revisão não encontrada" description="Nenhum rascunho será impresso em lugar da revisão solicitada."/><Link to={`/app/pets/${id}`} state={listNavigation}>Voltar à PET</Link></div>;
  const preparation=revision===record.revision?record.preparation:snapshot!.preparation;
  const label=`${record.code} · revisão ${revision} · RASCUNHO · ENTRADA NÃO AUTORIZADA`;
  return <div className={`stack ${styles.page}`}><style media="print">{`@page { @bottom-center { content: ${JSON.stringify(label)} " · Página " counter(page) " de " counter(pages); font: 7pt Arial,sans-serif; color:#596c63; } }`}</style>
    <div className={styles.toolbar}><PageHeader eyebrow="PREPARAÇÃO DA PET" title="Visualização e impressão do rascunho PET" description="O documento registra a preparação salva, sem emissão ou autorização de entrada." actions={<><Link className="button button--secondary" to={`/app/pets/${id}?revision=${revision}`} state={listNavigation}>Voltar à PET</Link><Button onClick={()=>window.print()}><Printer size={16} aria-hidden="true"/> Imprimir / salvar PDF</Button></>}/></div>
    <article className={styles.paper} aria-label="Rascunho imprimível da PET" data-print-record><header className={styles.documentHeader}><div><BrandLogo className={styles.documentBrand}/><p className={styles.kicker}>AMPARA SESMT · PREPARAÇÃO DE PET</p><h1>{record.code}</h1><p>Revisão do rascunho {revision} · {record.sourceId} · revisão de origem {record.sourceRevision}</p></div><strong className={styles.status}>RASCUNHO · ENTRADA NÃO AUTORIZADA</strong></header>
      <p className={styles.demo}>RASCUNHO DE PREPARAÇÃO · NÃO EMITIDO · ENTRADA NÃO AUTORIZADA</p>{API_MODE==='demo'&&<p className={styles.notice}>DEMONSTRAÇÃO · DADOS FICTÍCIOS · SEM VALIDADE OPERACIONAL</p>}
      <section><h2>Atendimento de origem</h2><dl className={styles.facts}><div><dt>Atendimento</dt><dd>{record.appointment.code} · {record.appointment.serviceLabel}</dd></div><div><dt>Equipe / local</dt><dd>{record.appointment.teamName} · {record.appointment.location}</dd></div><div><dt>Revisão salva por</dt><dd>{snapshot?.actorName||record.createdByName}</dd></div><div><dt>Data de salvamento · Brasília</dt><dd>{formatDate(snapshot?.savedAt||record.updatedAt)}</dd></div></dl></section>
      <PetPreparationView value={preparation}/>
      <section><h2>Emissão e controle de entrada</h2><p>A emissão, as assinaturas certificadas, os registros de entrada/saída, o monitoramento durante a atividade e o encerramento operacional não compõem este rascunho. Sua impressão não autoriza entrada.</p></section>
      <footer className={styles.documentFooter}>{label}<br/>Origem: {record.sourceId} · revisão {record.sourceRevision} · SHA-256: {record.sourceSha256}</footer>
    </article>
  </div>;
}

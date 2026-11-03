import {useEffect,useRef,useState,type FormEvent} from 'react';
import {Link,useSearchParams} from 'react-router';
import {useQueryClient} from '@tanstack/react-query';
import {api,nativeDocumentTypesApi} from '../../shared/api/client';
import {useSession} from '../../shared/auth/SessionProvider';
import {InvalidReadResponse,useVerifiedRead} from '../../shared/lib/verified-read';
import {formatDate} from '../../shared/lib/format';
import {Badge,Button,EmptyState,Feedback,Field,Modal,PageHeader,Spinner} from '../../shared/ui';
import {NativeCommandDialog,NativeContextConflict,NativeFormError} from '../native-operations/NativeCommandDialog';
import {checkedContext,checkedHistory,checkedNativeType,checkedPage,checkedType,creationFields,historyLabels,secrecyLabels,type ManagedType} from './contracts';
import styles from '../../shared/ui/NativeRecords.module.css';

export function NativeDocumentTypesPage(){const{sessionKey}=useSession();return <Workspace key={sessionKey}/>;}
function Workspace(){
  const{sessionKey,can}=useSession(),client=useQueryClient();const[params,setParams]=useSearchParams();
  const q=params.get('q')??'',page=Number(params.get('page')??'1'),selected=params.get('registro');
  const[input,setInput]=useState(q),[editor,setEditor]=useState<{opening?:ManagedType}>(),[success,setSuccess]=useState('');useEffect(()=>setInput(q),[q]);
  const valid=q.length<=160&&Number.isInteger(page)&&page>0&&page<=1000000&&['q','page','registro'].every(k=>params.getAll(k).length<=1);
  const enabled=can('documento:ler')||can('parametro:ler')||can('parametro:editar');
  const context=useVerifiedRead({queryKey:['native-document-types',sessionKey,'context'],enabled,request:signal=>api.get<unknown>('/document-type-management/context',{signal}),validate:checkedContext});
  const list=useVerifiedRead({queryKey:['native-document-types',sessionKey,'list',page,q],enabled:enabled&&Boolean(context.data)&&valid,request:signal=>api.get<unknown>('/document-type-management',{query:{q,page,pageSize:20},signal}),validate:v=>checkedPage(v,page,q)});
  const validId=Boolean(selected&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(selected));
  const detail=useVerifiedRead({queryKey:['native-document-types',sessionKey,'detail',selected],enabled:enabled&&Boolean(context.data)&&valid&&validId,request:signal=>api.get<unknown>(`/document-type-management/${selected}`,{signal}),validate:v=>checkedType(v,selected!)});
  const history=useVerifiedRead({queryKey:['native-document-types',sessionKey,'history',selected,detail.data?.version],enabled:Boolean(context.data?.canManage&&detail.data),request:signal=>api.get<unknown>(`/document-type-management/${selected}/history`,{signal}),validate:checkedHistory});
  function criteria(values:{q?:string;page?:number;registro?:string}){const p=new URLSearchParams();for(const[k,v]of Object.entries(values))if(v&&!(k==='page'&&v===1))p.set(k,String(v));return p;}
  function close(){setParams(criteria({q,page}));}
  async function saved(id:string){setEditor(undefined);setSuccess('Tipo documental salvo.');await Promise.all([client.invalidateQueries({queryKey:['native-document-types',sessionKey]}),client.invalidateQueries({queryKey:['document-types']}),client.invalidateQueries({queryKey:['native-documents']})]);setParams(criteria({registro:id}));}
  function search(e:FormEvent){e.preventDefault();setParams(criteria({q:input.trim()}));if(input.trim()===q&&page===1)void list.refetch();}
  return <div className="stack"><PageHeader title="Tipos documentais" description="Consulte as classificações e regras cadastradas para os documentos." actions={context.data&&<><Button variant="secondary" onClick={()=>void client.invalidateQueries({queryKey:['native-document-types',sessionKey]})}>Atualizar</Button>{context.data.canManage?<Button onClick={()=>{close();setEditor({});}}>Cadastrar tipo</Button>:<Badge>Somente consulta</Badge>}</>}/>
    {!enabled?<Feedback tone="warning">Seu acesso não permite esta consulta.</Feedback>:context.isPending?<Spinner/>:context.isError?<Feedback tone="danger">Não foi possível consultar os tipos documentais.</Feedback>:context.data&&<>
      {success&&<Feedback tone="success">{success}</Feedback>}<form className={`panel ${styles.toolbar}`} onSubmit={search}><Field label="Buscar nome, código ou categoria"><input maxLength={160} value={input} onChange={e=>setInput(e.target.value)}/></Field><Button type="submit" disabled={list.isFetching}>Buscar</Button></form>
      {!valid?<Feedback tone="warning">Filtros inválidos. <Button variant="ghost" onClick={()=>setParams(criteria({}))}>Limpar filtros</Button></Feedback>:list.isPending?<Spinner/>:list.isError?<Feedback tone="danger">Não foi possível ler os tipos cadastrados. Atualize a consulta.</Feedback>:list.data&&(list.data.items.length?<div className={styles.results}><div className={styles.scroll} role="region" aria-label="Tabela de tipos documentais" tabIndex={0}><table className={`data-table ${styles.table}`}><thead><tr><th scope="col">Tipo</th><th scope="col">Categoria</th><th scope="col">Classificação</th><th scope="col">Requisitos</th></tr></thead><tbody>{list.data.items.map(({item:t})=><tr key={t.id}><td><Link to={{search:`?${criteria({q,page,registro:t.id})}`}}>{t.name}</Link><small>{t.code}</small></td><td>{t.category}</td><td>{secrecyLabels[t.secrecyLevel]??t.secrecyLevel}</td><td>{t.requiresApproval?'Aprovação exigida':'Sem exigência de aprovação'}<small>{t.requiresSignature?'Assinatura exigida':'Sem exigência de assinatura'}</small></td></tr>)}</tbody></table></div><div className={styles.footer}><span>{list.data.total} tipo(s) · página {page}</span><div className="actions"><Button variant="secondary" disabled={page<=1} onClick={()=>setParams(criteria({q,page:page-1}))}>Anterior</Button><Button variant="secondary" disabled={page*20>=list.data!.total} onClick={()=>setParams(criteria({q,page:page+1}))}>Próxima</Button></div></div></div>:<EmptyState title="Nenhum tipo encontrado" description="Ajuste a busca ou cadastre um tipo documental."/>)}
    </>}
    {selected&&<Modal open title="Tipo documental" onClose={close}>{!validId||!valid||detail.isError?<Feedback tone="danger">Tipo indisponível ou fora do seu acesso.</Feedback>:!detail.data?<Spinner/>:<div className="stack"><TypeDetails data={detail.data}/>{context.data?.canManage&&<Button variant="secondary" onClick={()=>{setEditor({opening:detail.data});close();}}>Editar identificação</Button>}
      {context.data?.canManage&&<details><summary>Histórico de alterações</summary>{history.isPending?<Spinner/>:history.isError?<Feedback tone="danger">Não foi possível consultar o histórico.</Feedback>:history.data?.length?<ol>{history.data.map(e=><li key={e.id}><strong>{historyLabels[e.action]}</strong><p>{e.actorName||'Responsável'} · {formatDate(e.occurredAt)}</p></li>)}</ol>:<p>Nenhuma alteração registrada neste fluxo.</p>}</details>}</div>}</Modal>}
    {editor&&context.data?.canManage&&<TypeEditor opening={editor.opening} onClose={()=>setEditor(undefined)} onSaved={saved}/>}
  </div>;
}
function TypeDetails({data:{item:t}}:{data:ManagedType}){return <dl className={styles.details}><dt>Nome</dt><dd>{t.name}</dd><dt>Código</dt><dd>{t.code}</dd><dt>Categoria</dt><dd>{t.category}</dd><dt>Classificação</dt><dd>{secrecyLabels[t.secrecyLevel]??t.secrecyLevel}</dd>{t.description&&<><dt>Descrição</dt><dd>{t.description}</dd></>}<dt>Aprovação</dt><dd>{t.requiresApproval?'Exigida':'Não exigida'}</dd><dt>Assinatura</dt><dd>{t.requiresSignature?'Exigida':'Não exigida'}</dd><dt>Periodicidade</dt><dd>{t.periodicityInDays==null?'Não informada':`${t.periodicityInDays} dias`}</dd><dt>Prazo de guarda</dt><dd>{t.retentionPeriodInYears==null?'Não informado':`${t.retentionPeriodInYears} anos`}</dd></dl>;}
function TypeEditor({opening,onClose,onSaved}:{opening?:ManagedType;onClose:()=>void;onSaved:(id:string)=>Promise<void>}){
  const[f,set]=useState({code:opening?.item.code??'',name:opening?.item.name??'',description:opening?.item.description??'',category:opening?.item.category??'',secrecyLevel:opening?.item.secrecyLevel??'INTERNO',requiresApproval:opening?.item.requiresApproval??true,requiresSignature:opening?.item.requiresSignature??false,days:opening?.item.periodicityInDays==null?'':String(opening.item.periodicityInDays),years:opening?.item.retentionPeriodInYears==null?'':String(opening.item.retentionPeriodInYears)});
  const[dirty,setDirty]=useState(false),[confirmed,confirm]=useState(false),savedId=useRef('');
  function field<K extends keyof typeof f>(key:K,value:typeof f[K]){set(old=>({...old,[key]:value}));setDirty(true);confirm(false);}
  async function perform(signal:AbortSignal){
    if(!confirmed)throw new NativeFormError('Confira os dados do tipo documental.');
    if(!checkedContext(await api.get<unknown>('/document-type-management/context',{signal})).canManage)throw new NativeContextConflict('O acesso à configuração mudou. Atualize a consulta.');
    let body:Record<string,unknown>;
    if(opening){
      if(!f.name.trim()||f.name.trim().length>150||f.description.trim().length>1000)throw new NativeFormError('Confira nome e descrição.');
      const current=checkedType(await api.get<unknown>(`/document-type-management/${opening.item.id}`,{signal}),opening.item.id);
      if(current.version!==opening.version)throw new NativeContextConflict('O tipo documental mudou. Atualize a consulta antes de salvar.');
      const{id:_id,code:_code,active:_active,...policy}=opening.item;body={...policy,name:f.name.trim(),description:f.description.trim()||null};
    }else{
      const parsed=creationFields.safeParse(f);if(!parsed.success)throw new NativeFormError('Confira código, nome, categoria e prazos.');const p=parsed.data;
      body={code:p.code,name:p.name,description:p.description||null,category:p.category,secrecyLevel:p.secrecyLevel,requiresApproval:p.requiresApproval,requiresSignature:p.requiresSignature,periodicityInDays:p.days?Number(p.days):null,retentionPeriodInYears:p.years?Number(p.years):null,metadataSchema:'{}',schemaVersion:1};
    }
    const response=checkedNativeType(opening?await nativeDocumentTypesApi.rename(opening.item.id,opening.version,body,signal):await nativeDocumentTypesApi.create(body,signal));
    if(opening&&response.id!==opening.item.id||Object.entries(body).some(([key,value])=>(response as unknown as Record<string,unknown>)[key]!==value))throw new InvalidReadResponse();
    const stored=checkedType(await api.get<unknown>(`/document-type-management/${response.id}`,{signal}),response.id);
    if(JSON.stringify(stored.item)!==JSON.stringify(response)||opening&&stored.version===opening.version)throw new InvalidReadResponse();savedId.current=response.id;
  }
  return <NativeCommandDialog title={opening?'Editar identificação do tipo':'Cadastrar tipo documental'} dirty={dirty} disabled={!dirty||!confirmed} onClose={onClose} onDone={()=>onSaved(savedId.current)} perform={perform} submitLabel={opening?'Salvar identificação':'Cadastrar tipo'}>{busy=><>
    {opening?<p>Código: {opening.item.code}</p>:<Field label="Código do tipo" required><input maxLength={50} disabled={busy} value={f.code} onChange={e=>field('code',e.target.value)}/></Field>}
    <Field label="Nome do tipo" required><input maxLength={150} disabled={busy} value={f.name} onChange={e=>field('name',e.target.value)}/></Field><Field label="Descrição"><textarea maxLength={1000} disabled={busy} value={f.description} onChange={e=>field('description',e.target.value)}/></Field>
    {opening?<details><summary>Política cadastrada</summary><TypeDetails data={opening}/><p>Para outra classificação ou regra, cadastre um novo tipo.</p></details>:<><Field label="Categoria" required><input maxLength={30} disabled={busy} value={f.category} onChange={e=>field('category',e.target.value)}/></Field><Field label="Classificação" required><select disabled={busy} value={f.secrecyLevel} onChange={e=>field('secrecyLevel',e.target.value)}><option value="INTERNO">Interno</option><option value="RESTRITO">Restrito</option><option value="MEDICO">Médico</option></select></Field>
      <div className="form-grid"><Field label="Periodicidade cadastrada (dias)"><input type="number" min={1} step={1} disabled={busy} value={f.days} onChange={e=>field('days',e.target.value)}/></Field><Field label="Prazo de guarda cadastrado (anos)"><input type="number" min={1} step={1} disabled={busy} value={f.years} onChange={e=>field('years',e.target.value)}/></Field></div>
      <label className="check-label"><input type="checkbox" disabled={busy} checked={f.requiresApproval} onChange={e=>field('requiresApproval',e.target.checked)}/>Exigir aprovação</label><label className="check-label"><input type="checkbox" disabled={busy} checked={f.requiresSignature} onChange={e=>field('requiresSignature',e.target.checked)}/>Exigir assinatura</label></>}
    <label className="check-label"><input type="checkbox" disabled={busy} checked={confirmed} onChange={e=>confirm(e.target.checked)}/>Conferi a identificação e as regras deste tipo.</label>
  </>}</NativeCommandDialog>;
}

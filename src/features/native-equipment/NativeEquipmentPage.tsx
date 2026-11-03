import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import { InvalidReadResponse, useVerifiedRead } from '../../shared/lib/verified-read';
import { Badge, Button, EmptyState, Feedback, Field, Modal, PageHeader, Spinner } from '../../shared/ui';
import { NativeCommandDialog, NativeContextConflict, NativeFormError } from '../native-operations/NativeCommandDialog';
import { catalogFields, checkedDelivery, checkedEquipment, checkedEquipmentContext, checkedEquipmentPage, deliveryFields, equipmentDay, localEquipmentDay, type Delivery, type Equipment, type EquipmentContext, type EquipmentScope } from './contracts';
import styles from '../../shared/ui/NativeRecords.module.css';

export function NativeEquipmentPage() {
  const { sessionKey, unitId } = useSession();
  return <EquipmentWorkspace key={`${sessionKey}:${unitId}`}/>;
}
function EquipmentWorkspace() {
  const { me, sessionKey, unitId, can } = useSession(), client = useQueryClient(), location = useLocation(), navigate = useNavigate();
  const [tab, setTab] = useState('deliveries'), [q, setQ] = useState(''), [search, apply] = useState(''), [status, setStatus] = useState(''), [page, setPage] = useState(1);
  const [editor, setEditor] = useState<'catalog' | 'delivery' | 'return'>(), [selectedEquipment, selectEquipment] = useState<Equipment>(), [selectedDelivery, selectDelivery] = useState<Delivery>(), [success, setSuccess] = useState('');
  const scope: EquipmentScope = { unitId: unitId ?? '', companyIds: me?.scope.companyIds ?? [], ownOnly: Boolean(me?.scope.ownOnly), workerId: me?.workerId };
  const enabled = Boolean(unitId && can('epi:ler'));
  const context = useVerifiedRead({ queryKey:['native-equipment',sessionKey,unitId,'context'], enabled,
    request: signal => api.get<unknown>('/equipment/context',{query:{unitId},signal}), validate:value=>checkedEquipmentContext(value,scope) });
  const selectedScope = { ...scope, companyIds: context.data ? [context.data.companyId] : scope.companyIds };
  const data = useVerifiedRead({ queryKey:['native-equipment',sessionKey,unitId,tab,search,status,page], enabled:enabled && Boolean(context.data),
    request:signal=>api.get<unknown>(tab === 'catalog' ? '/equipment' : '/equipment/deliveries',{query:{unitId,q:search,page,pageSize:20,...(tab==='deliveries' && status ? {status} : {})},signal}),
    validate:value=>checkedEquipmentPage(value,selectedScope,page,tab==='deliveries') });
  const detailId = new URLSearchParams(location.search).get('entrega');
  const validDetail = Boolean(detailId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(detailId));
  const details = useVerifiedRead({ queryKey:['native-equipment',sessionKey,unitId,'detail',detailId],enabled:enabled && Boolean(context.data && validDetail),
    request:signal=>api.get<unknown>(`/equipment/deliveries/${detailId}`,{query:{unitId},signal}), validate:value=>{const item=checkedDelivery(value,selectedScope);if(item.id!==detailId)throw new InvalidReadResponse();return item;} });
  const close = () => { setEditor(undefined); selectEquipment(undefined); selectDelivery(undefined); };
  async function saved() { close(); setSuccess('Registro salvo.'); await client.invalidateQueries({queryKey:['native-equipment',sessionKey]}); }
  function find(event:FormEvent) { event.preventDefault(); apply(q.trim()); setPage(1); if(search===q.trim()&&page===1) void data.refetch(); }
  function changeTab(value:string) { setTab(value);setPage(1);setQ('');apply('');setStatus(''); }
  return <div className="stack"><PageHeader title="EPIs" actions={context.data && <><Button variant="secondary" disabled={data.isFetching} onClick={()=>void Promise.all([data.refetch(),context.refetch()])}>Atualizar</Button>{context.data.canCreate&&<Button variant="secondary" onClick={()=>{selectEquipment(undefined);setEditor('catalog');}}>Cadastrar EPI</Button>}{context.data.canDeliver&&<Button onClick={()=>setEditor('delivery')}>Registrar entrega</Button>}</>}/>
    {!enabled?<Feedback tone="warning">Selecione uma unidade com acesso a EPIs.</Feedback>:context.isPending?<Spinner/>:context.isError?<Feedback tone="danger">Não foi possível consultar os EPIs desta unidade.</Feedback>:context.data&&<>
      <div className="actions" role="tablist" aria-label="Controle de EPIs"><Button role="tab" aria-selected={tab==='deliveries'} variant={tab==='deliveries'?'primary':'secondary'} onClick={()=>changeTab('deliveries')}>Entregas</Button><Button role="tab" aria-selected={tab==='catalog'} variant={tab==='catalog'?'primary':'secondary'} onClick={()=>changeTab('catalog')}>Catálogo de EPIs</Button></div>
      {success&&<Feedback tone="success">{success}</Feedback>}
      <form className={`panel ${styles.toolbar}`} onSubmit={find}><Field label={tab==='catalog'?'Buscar equipamento ou CA':'Buscar trabalhador ou equipamento'}><input maxLength={160} value={q} onChange={event=>setQ(event.target.value)}/></Field>{tab==='deliveries'&&<Field label="Situação"><select value={status} onChange={event=>{setStatus(event.target.value);setPage(1);}}><option value="">Todas</option><option value="ACTIVE">Em uso</option><option value="RETURNED">Devolvido</option><option value="DUE">Troca prevista até hoje</option></select></Field>}<Button type="submit" disabled={data.isFetching}>Buscar</Button></form>
      {data.isPending&&<Spinner/>}{data.isError&&<Feedback tone="danger">Não foi possível conferir os registros de EPI. Atualize a consulta.</Feedback>}
      {data.data&&<section className={styles.results} aria-label={tab==='catalog'?'Catálogo de EPIs':'Entregas de EPI'}>{!data.data.items.length?<EmptyState title={tab==='catalog'?'Nenhum equipamento encontrado':'Nenhuma entrega encontrada'} description="Ajuste os filtros ou cadastre um novo registro."/>:<div className={styles.scroll} role="region" aria-label="Tabela de EPIs" tabIndex={0}><table className={`data-table ${styles.table}`}><thead><tr>{tab==='catalog'?<><th>Equipamento</th><th>CA</th><th>Fabricante e modelo</th><th>Ações</th></>:<><th>Equipamento</th><th>Trabalhador</th><th>Entrega e quantidade</th><th>Troca prevista</th><th>Situação e ações</th></>}</tr></thead><tbody>{data.data.items.map(item=>tab==='catalog'?<tr key={item.id}><td><strong>{(item as Equipment).name}</strong><small>{(item as Equipment).code}</small></td><td>{item.approvalCertificate||'Não informado'}</td><td>{(item as Equipment).manufacturer||'—'}<small>{(item as Equipment).model}</small></td><td>{context.data!.canEdit&&<Button variant="ghost" onClick={()=>{selectEquipment(item as Equipment);setEditor('catalog');}}>Editar</Button>}</td></tr>:<DeliveryRow key={item.id} item={item as Delivery} canReturn={context.data!.canReturn} onReturn={()=>{selectDelivery(item as Delivery);setEditor('return');}}/>)}</tbody></table></div>}
        <nav className={styles.footer} aria-label="Paginação dos EPIs"><span>{data.data.total} registro(s) · página {page} de {Math.max(1,Math.ceil(data.data.total/20))}</span><div className="actions"><Button variant="secondary" disabled={page<=1||data.isFetching} onClick={()=>setPage(page-1)}>Anterior</Button><Button variant="secondary" disabled={page*20>=data.data!.total||data.isFetching} onClick={()=>setPage(page+1)}>Próxima</Button></div></nav></section>}
      {editor==='catalog'&&<CatalogEditor opening={selectedEquipment} context={context.data} scope={selectedScope} onClose={close} onDone={saved}/>}
      {editor==='delivery'&&<DeliveryEditor context={context.data} scope={selectedScope} onClose={close} onDone={saved}/>}
      {editor==='return'&&selectedDelivery&&<ReturnEditor opening={selectedDelivery} scope={selectedScope} onClose={close} onDone={saved}/>}
      {detailId&&<Modal open title="Entrega de EPI" onClose={()=>void navigate('/app/epis',{replace:true})}>{!validDetail||details.isError?<Feedback tone="danger">Entrega não encontrada ou fora do seu acesso.</Feedback>:details.isPending?<Spinner/>:details.data&&<DeliveryDetails item={details.data}/>}</Modal>}
    </>}
  </div>;
}
function DeliveryRow({item,canReturn,onReturn}:{item:Delivery;canReturn:boolean;onReturn:()=>void}) {
  const due=!item.returnedOn&&item.replacementOn&&item.replacementOn<=localEquipmentDay();
  return <tr><td><Link to={`/app/epis?entrega=${item.id}`}>{item.equipmentName}</Link><small>{item.equipmentCode}{item.size?` · ${item.size}`:''}</small></td><td>{item.workerName}</td><td>{equipmentDay(item.deliveredOn)}<small>{item.quantity} unidade(s)</small></td><td>{equipmentDay(item.replacementOn)}</td><td><Badge tone={item.returnedOn?'neutral':due?'warning':'success'}>{item.returnedOn?'Devolvido':due?'Troca prevista':'Em uso'}</Badge>{canReturn&&!item.returnedOn&&<Button variant="ghost" onClick={onReturn}>Devolver</Button>}</td></tr>;
}
function DeliveryDetails({item}:{item:Delivery}) {
  return <dl className={styles.details}><dt>Trabalhador</dt><dd>{item.workerName}</dd><dt>Equipamento</dt><dd>{item.equipmentName} · {item.equipmentCode}</dd><dt>CA registrado</dt><dd>{item.approvalCertificate||'Não informado'}</dd><dt>Quantidade</dt><dd>{item.quantity}</dd><dt>Tamanho</dt><dd>{item.size||'—'}</dd><dt>Entrega</dt><dd>{equipmentDay(item.deliveredOn)}</dd><dt>Troca prevista</dt><dd>{equipmentDay(item.replacementOn)}</dd><dt>Observações</dt><dd className={styles.message}>{item.notes||'—'}</dd><dt>Devolução</dt><dd>{equipmentDay(item.returnedOn)}</dd><dt>Motivo</dt><dd>{item.returnReason||'—'}</dd></dl>;
}
async function freshContext(scope:EquipmentScope,signal:AbortSignal) {return checkedEquipmentContext(await api.get<unknown>('/equipment/context',{query:{unitId:scope.unitId},signal}),scope);}
function CatalogEditor({opening,context,scope,onClose,onDone}:{opening?:Equipment;context:EquipmentContext;scope:EquipmentScope;onClose:()=>void;onDone:()=>Promise<void>}) {
  const [fields,setFields]=useState({code:opening?.code??'',name:opening?.name??'',approvalCertificate:opening?.approvalCertificate??'',manufacturer:opening?.manufacturer??'',model:opening?.model??''}),[confirmed,confirm]=useState(false);
  function field(key:keyof typeof fields,value:string){setFields(old=>({...old,[key]:value}));confirm(false);}
  async function perform(signal:AbortSignal) {
    const parsed=catalogFields.safeParse(fields);if(!parsed.success||!confirmed)throw new NativeFormError('Confira código, nome e a confirmação do cadastro.');
    const fresh=await freshContext(scope,signal);if(opening?!fresh.canEdit:!fresh.canCreate)throw new NativeContextConflict('Seu acesso ao cadastro mudou. Atualize a consulta.');
    if(opening){const current=checkedEquipment(await api.get<unknown>(`/equipment/${opening.id}`,{query:{unitId:scope.unitId},signal}),scope);if(current.revision!==opening.revision||current.id!==opening.id)throw new NativeContextConflict('O equipamento foi alterado. Atualize a consulta.');}
    const data=parsed.data, body={...data,approvalCertificate:data.approvalCertificate||null,manufacturer:data.manufacturer||null,model:data.model||null,unitId:scope.unitId,confirmation:true,...(opening?{expectedRevision:opening.revision}:{})};
    let reply:unknown;try{reply=opening?await api.put<unknown>(`/equipment/${opening.id}`,body,{signal}):await api.post<unknown>('/equipment',body,{signal});}catch(error){if(error instanceof ApiError&&error.code==='DUPLICATE_CODE')throw new NativeFormError('Este código já está em uso. Informe outro código.');throw error;}
    const saved=checkedEquipment(reply,scope);if(saved.companyId!==context.companyId||saved.revision!==(opening?opening.revision+1:1)||opening&&saved.id!==opening.id||Object.entries(data).some(([key,value])=>(saved[key as keyof Equipment]??'')!==value))throw new InvalidReadResponse();
    const stored=checkedEquipment(await api.get<unknown>(`/equipment/${saved.id}`,{query:{unitId:scope.unitId},signal}),scope);if(JSON.stringify(stored)!==JSON.stringify(saved))throw new InvalidReadResponse();
  }
  return <NativeCommandDialog title={opening?'Editar EPI':'Cadastrar EPI'} dirty={Object.values(fields).some(Boolean)} disabled={!confirmed} onClose={onClose} onDone={onDone} perform={perform} submitLabel="Salvar EPI">{busy=><>
    <Field label="Código" required><input maxLength={30} value={fields.code} disabled={busy} onChange={e=>field('code',e.target.value)}/></Field><Field label="Nome do equipamento" required><input maxLength={160} value={fields.name} disabled={busy} onChange={e=>field('name',e.target.value)}/></Field>
    <Field label="CA"><input maxLength={30} value={fields.approvalCertificate} disabled={busy} onChange={e=>field('approvalCertificate',e.target.value)}/></Field><Field label="Fabricante"><input maxLength={120} value={fields.manufacturer} disabled={busy} onChange={e=>field('manufacturer',e.target.value)}/></Field><Field label="Modelo"><input maxLength={120} value={fields.model} disabled={busy} onChange={e=>field('model',e.target.value)}/></Field>
    <label className="check-label"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>confirm(e.target.checked)}/>Conferi os dados do equipamento.</label>
  </>}</NativeCommandDialog>;
}
function DeliveryEditor({context,scope,onClose,onDone}:{context:EquipmentContext;scope:EquipmentScope;onClose:()=>void;onDone:()=>Promise<void>}) {
  const [commandId]=useState(()=>crypto.randomUUID()),[fields,setFields]=useState({workerId:'',equipmentId:'',quantity:1,size:'',deliveredOn:localEquipmentDay(),replacementOn:'',notes:''}),[confirmed,confirm]=useState(false);
  function field(key:keyof typeof fields,value:string|number){setFields(old=>({...old,[key]:value}));confirm(false);}
  async function perform(signal:AbortSignal) {
    const parsed=deliveryFields.safeParse(fields);if(!parsed.success||!confirmed||parsed.data.deliveredOn>localEquipmentDay())throw new NativeFormError('Confira trabalhador, equipamento, quantidade e datas da entrega.');
    const fresh=await freshContext(scope,signal);if(!fresh.canDeliver||!fresh.workers.some(w=>w.id===fields.workerId)||!fresh.equipment.some(e=>e.id===fields.equipmentId))throw new NativeContextConflict('O cadastro ou seu acesso mudou. Atualize a consulta antes de registrar a entrega.');
    const saved=checkedDelivery(await api.post<unknown>('/equipment/deliveries',{...parsed.data,size:fields.size||null,notes:fields.notes.trim()||null,replacementOn:fields.replacementOn||null,unitId:scope.unitId,commandId,confirmation:true},{signal}),scope);
    if(saved.companyId!==context.companyId||saved.workerId!==fields.workerId||saved.equipmentId!==fields.equipmentId||saved.quantity!==fields.quantity||saved.deliveredOn!==fields.deliveredOn||saved.replacementOn!==(fields.replacementOn||null)||saved.returnedOn||saved.revision!==1)throw new InvalidReadResponse();
    const stored=checkedDelivery(await api.get<unknown>(`/equipment/deliveries/${saved.id}`,{query:{unitId:scope.unitId},signal}),scope);if(JSON.stringify(stored)!==JSON.stringify(saved))throw new InvalidReadResponse();
  }
  return <NativeCommandDialog title="Registrar entrega de EPI" dirty={Boolean(fields.workerId||fields.equipmentId||fields.notes)} disabled={!confirmed} onClose={onClose} onDone={onDone} perform={perform} submitLabel="Registrar entrega">{busy=><>
    <Field label="Trabalhador" required><select value={fields.workerId} disabled={busy} onChange={e=>field('workerId',e.target.value)}><option value="">Selecionar trabalhador</option>{context.workers.map(w=><option key={w.id} value={w.id}>{w.name} · {w.enrollment}</option>)}</select></Field>
    <Field label="Equipamento" required><select value={fields.equipmentId} disabled={busy} onChange={e=>field('equipmentId',e.target.value)}><option value="">Selecionar equipamento</option>{context.equipment.map(e=><option key={e.id} value={e.id}>{e.name} · {e.code}</option>)}</select></Field>
    <Field label="Quantidade" required><input type="number" min={1} max={1000} value={fields.quantity} disabled={busy} onChange={e=>field('quantity',Number(e.target.value))}/></Field><Field label="Tamanho"><input maxLength={30} value={fields.size} disabled={busy} onChange={e=>field('size',e.target.value)}/></Field>
    <Field label="Data da entrega" required><input type="date" max={localEquipmentDay()} value={fields.deliveredOn} disabled={busy} onChange={e=>field('deliveredOn',e.target.value)}/></Field><Field label="Troca prevista"><input type="date" min={fields.deliveredOn} value={fields.replacementOn} disabled={busy} onChange={e=>field('replacementOn',e.target.value)}/></Field><Field label="Observações"><textarea maxLength={500} value={fields.notes} disabled={busy} onChange={e=>field('notes',e.target.value)}/></Field>
    <label className="check-label"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>confirm(e.target.checked)}/>Confirmo o registro desta entrega.</label>
  </>}</NativeCommandDialog>;
}
function ReturnEditor({opening,scope,onClose,onDone}:{opening:Delivery;scope:EquipmentScope;onClose:()=>void;onDone:()=>Promise<void>}) {
  const [on,setOn]=useState(localEquipmentDay()),[reason,setReason]=useState(''),[confirmed,confirm]=useState(false);
  async function perform(signal:AbortSignal) {
    if(!confirmed||reason.trim().length<3||reason.trim().length>200||on<opening.deliveredOn||on>localEquipmentDay())throw new NativeFormError('Confira data, motivo e confirmação da devolução.');
    const fresh=checkedDelivery(await api.get<unknown>(`/equipment/deliveries/${opening.id}`,{query:{unitId:scope.unitId},signal}),scope);if(fresh.id!==opening.id||fresh.revision!==opening.revision||fresh.returnedOn)throw new NativeContextConflict('A entrega foi alterada. Atualize a consulta.');
    const saved=checkedDelivery(await api.post<unknown>(`/equipment/deliveries/${opening.id}/return`,{unitId:scope.unitId,expectedRevision:opening.revision,returnedOn:on,reason:reason.trim(),confirmation:true},{signal}),scope);
    const wanted={...opening,returnedOn:on,returnReason:reason.trim(),revision:opening.revision+1};if(JSON.stringify(saved)!==JSON.stringify(wanted))throw new InvalidReadResponse();
    const stored=checkedDelivery(await api.get<unknown>(`/equipment/deliveries/${opening.id}`,{query:{unitId:scope.unitId},signal}),scope);if(JSON.stringify(stored)!==JSON.stringify(saved))throw new InvalidReadResponse();
  }
  return <NativeCommandDialog title="Registrar devolução" dirty={Boolean(reason)} disabled={!confirmed} onClose={onClose} onDone={onDone} perform={perform} submitLabel="Registrar devolução">{busy=><>
    <p><strong>{opening.equipmentName}</strong><br/>{opening.workerName} · {opening.quantity} unidade(s)</p><Field label="Data da devolução" required><input type="date" min={opening.deliveredOn} max={localEquipmentDay()} value={on} disabled={busy} onChange={e=>{setOn(e.target.value);confirm(false);}}/></Field><Field label="Motivo da devolução" required><textarea maxLength={200} value={reason} disabled={busy} onChange={e=>{setReason(e.target.value);confirm(false);}}/></Field>
    <label className="check-label"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>confirm(e.target.checked)}/>Confirmo a devolução dos itens desta entrega.</label>
  </>}</NativeCommandDialog>;
}

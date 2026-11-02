import { useState } from 'react';
import { api } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import { InvalidReadResponse, useVerifiedRead } from '../../shared/lib/verified-read';
import { Button, Feedback, Field, Spinner } from '../../shared/ui';
import { appointmentInstant } from '../agenda/support';
import { checkedNativeAppointment, checkedNativeDesignations, checkedNativeServices, checkedNativeTeam, nativeDesignationTypes, type NativeAppointment } from './contracts';
import { checkedNativeDirectory, checkedNativePeople, checkedNativeTeamPeople, loadNativeTeamPeople } from './directory';
import { loadNativeTeams } from './queries';
import { NativeCommandDialog, NativeFormError } from './NativeCommandDialog';

export function NativeCreationDialog({ kind, initial, onClose, onDone }: { kind: 'appointment'|'designation'|'context'; initial?: NativeAppointment; onClose: () => void; onDone: () => Promise<void> }) {
  const { sessionKey, unitId: headerUnit, can } = useSession(), appointment = kind !== 'designation', context = kind === 'context';
  const allowed = can(kind === 'appointment' ? 'pt:criar' : 'pt:editar'), catalogsAllowed = allowed && can('organization.read') && can('workers.read') && (!appointment || can('equipe:ler'));
  const [unitId, setUnit] = useState(context ? initial?.locationId ?? '' : headerUnit ?? ''), [teamId, setTeam] = useState(''), [personId, setPerson] = useState('');
  const [title, setTitle] = useState(initial?.title ?? ''), [origin, setOrigin] = useState(''), [type, setType] = useState('atender');
  const [startsAt, setStart] = useState(''), [endsAt, setEnd] = useState(''), [serviceIds, setServices] = useState<string[]>([]), [participants, setParticipants] = useState<string[]>([]);
  const [search, setSearch] = useState(''), [appliedSearch, setAppliedSearch] = useState(''), [peoplePage, setPeoplePage] = useState(1), [teamPage, setTeamPage] = useState(1);
  const organization = useVerifiedRead({ queryKey: ['native-operational-directory',sessionKey], enabled: catalogsAllowed, request: signal => api.get<unknown>('/organization',{signal}), validate: checkedNativeDirectory });
  const unit = organization.data?.units.find(item => item.id === unitId && item.status === 'ACTIVE' && organization.data?.companies.some(company=>company.id===item.companyId&&company.status==='ACTIVE'));
  const services = useVerifiedRead({ queryKey:['native-services',sessionKey], enabled: allowed, request: signal=>api.get<unknown>('/work-permits/services',{signal}), validate: checkedNativeServices });
  const teams = useVerifiedRead({ queryKey:['native-creation-teams',sessionKey,unit?.id,unit?.companyId,teamPage], scope:['native-creation-teams',sessionKey,unit?.id,unit?.companyId], enabled: Boolean(appointment && catalogsAllowed && unit && !organization.isFetching),
    request: signal=>loadNativeTeams({unitId:unit!.id,companyIds:[unit!.companyId],page:teamPage},signal),
    validate: value=>{ if(!value||typeof value!=='object'||!('items'in value)||!Array.isArray(value.items)||!('count'in value)||value.count!==value.items.length||value.items.length>10)throw new InvalidReadResponse();
      return {items:value.items.map(item=>checkedNativeTeam(item,{id:String(item?.id),unitId:unit!.id,companyIds:[unit!.companyId]})),count:Number(value.count)}; } });
  const team = teams.data?.items.find(item=>item.id===teamId);
  const members = useVerifiedRead({ queryKey:['native-team-people',sessionKey,unit?.id,team], scope:['native-team-people',sessionKey,unit?.id], enabled:Boolean(appointment&&team&&catalogsAllowed&&!teams.isFetching),
    request: signal=>loadNativeTeamPeople(team!,signal),validate:value=>checkedNativeTeamPeople(value,team!) });
  const people = useVerifiedRead({ queryKey:['native-creation-people',sessionKey,unit?.id,unit?.companyId,appliedSearch,peoplePage],scope:['native-creation-people',sessionKey,unit?.id,unit?.companyId],enabled:Boolean(!appointment&&catalogsAllowed&&unit&&!organization.isFetching),
    request:signal=>api.get<unknown>('/workers',{query:{unitId:unit!.id,status:'ACTIVE',q:appliedSearch||undefined,page:peoplePage,pageSize:20},signal}),validate:value=>checkedNativePeople(value,{unitId:unit!.id,companyId:unit!.companyId,page:peoplePage}) });
  const ready = Boolean(catalogsAllowed && unit && services.data && !services.isFetching && !organization.isFetching
    && (appointment ? team && members.data && !members.isFetching && !teams.isFetching : people.data && !people.isFetching));
  const lookupError = organization.isError || services.isError || teams.isError || members.isError || people.isError;
  const loading = organization.isPending || services.isPending || teams.isPending || members.isPending || people.isPending;
  function changeUnit(value:string){setUnit(value);setTeam('');setPerson('');setParticipants([]);setTeamPage(1);setPeoplePage(1);setAppliedSearch('');setSearch('');}
  function lookupPeople(){setAppliedSearch(search.trim());setPeoplePage(1);setPerson('');}
  function toggle(values:string[],id:string,checked:boolean){return checked?[...values,id]:values.filter(value=>value!==id);}
  const dirty=Boolean(!context&&title||origin||startsAt||endsAt||personId||teamId||participants.length||serviceIds.length);
  async function perform(signal:AbortSignal){
    if(!allowed||!ready||lookupError||!unit)throw new NativeFormError('Atualize os cadastros e selecione local, serviços e pessoas autorizados.');
    const start=context?initial?.startsAt:appointmentInstant(startsAt),end=context?initial?.endsAt:appointmentInstant(endsAt);
    if(!start||!end||Date.parse(end)<=Date.parse(start)||kind==='appointment'&&Date.parse(start)<Date.now())throw new NativeFormError(appointment?'Informe início futuro e término posterior, em Brasília.':'Informe uma vigência válida, em Brasília.');
    if(!serviceIds.length||serviceIds.some(id=>!services.data?.some(service=>service.id===id)))throw new NativeFormError('Selecione ao menos um serviço disponível.');
    if(appointment){
      if(!title.trim()||title.trim().length>200||!participants.length||participants.some(id=>!members.data?.some(person=>person.id===id&&person.status==='ACTIVE'&&person.admissionDate<=start.slice(0,10))))throw new NativeFormError('Informe título e participantes ativos da equipe para o período.');
      const payload={companyId:unit.companyId,locationId:unit.id,teamId:team!.id,title:title.trim(),startsAt:start,endsAt:end,serviceIds,participantIds:participants};
      if(context&&(!initial||initial.status!=='REQUESTED'||unit.id!==initial.locationId||unit.companyId!==initial.companyId))throw new NativeFormError('Atualize o agendamento antes de alterar a equipe.');
      const response=context?await api.put<unknown>(`/appointments/${initial!.id}/context`,{expectedVersion:initial!.version,teamId:team!.id,serviceIds,participantIds:participants},{signal}):await api.post<unknown>('/appointments',payload,{signal});
      const updated=checkedNativeAppointment(response,context?initial!.id:undefined);
      const expectedCodes=services.data!.filter(service=>serviceIds.includes(service.id)).map(service=>service.code);
      if(updated.companyId!==payload.companyId||updated.locationId!==payload.locationId||updated.teamId!==payload.teamId||updated.title!==payload.title||updated.status!=='REQUESTED'||Date.parse(updated.startsAt)!==Date.parse(start)||Date.parse(updated.endsAt)!==Date.parse(end)||!same(updated.participantIds,participants)||!same(updated.serviceCodes,expectedCodes)||context&&updated.version!==initial!.version+1)throw new InvalidReadResponse();
    }else{
      if(!origin.trim()||origin.trim().length>120||!people.data?.items.some(person=>person.id===personId))throw new NativeFormError('Selecione o trabalhador e informe uma origem de até 120 caracteres.');
      const payload={personId,serviceIds,locationIds:[unit.id],type,startsAt:start,endsAt:end,origin:origin.trim()};
      const updated=checkedNativeDesignations([await api.post<unknown>('/designations',payload,{signal})])[0];
      if(updated.personId!==personId||updated.type!==type||updated.origin!==payload.origin||!updated.active||Date.parse(updated.startsAt)!==Date.parse(start)||Date.parse(updated.endsAt)!==Date.parse(end)||!same(updated.serviceIds,serviceIds)||!same(updated.locationIds,[unit.id]))throw new InvalidReadResponse();
    }
  }
  return <NativeCommandDialog title={context?'Alterar equipe e participantes':appointment?'Solicitar agendamento':'Nova designação'} dirty={dirty} disabled={!ready||lookupError} onClose={onClose} onDone={onDone} perform={perform} submitLabel={context?'Salvar contexto':appointment?'Solicitar agendamento':'Criar designação'}>{busy=><>
    {!catalogsAllowed&&<Feedback tone="warning">Sua conta precisa de acesso aos cadastros de locais, pessoas e equipes para preencher esta solicitação.</Feedback>}{loading&&<Spinner/>}{lookupError&&<Feedback tone="danger">Não foi possível conferir os cadastros desta solicitação. Feche a janela e atualize a consulta antes de tentar novamente.</Feedback>}
    <Field label="Local"><select value={unitId} disabled={busy||context||!organization.data} onChange={event=>changeUnit(event.target.value)}><option value="">Selecione</option>{organization.data?.units.filter(item=>item.status==='ACTIVE').map(item=><option key={item.id} value={item.id}>{organization.data!.companies.find(company=>company.id===item.companyId)?.name} · {item.name}</option>)}</select></Field>
    {appointment?<><Field label="Título" required><input value={title} maxLength={200} disabled={busy||context} onChange={event=>setTitle(event.target.value)}/></Field><Field label="Equipe"><select value={teamId} disabled={busy||!teams.data||teams.isFetching} onChange={event=>{setTeam(event.target.value);setParticipants([]);}}><option value="">Selecione</option>{teams.data?.items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>{teams.data&&(teamPage>1||teams.data.count===10)&&<div className="actions"><Button variant="ghost" disabled={busy||teamPage<=1||teams.isFetching} onClick={()=>{setTeamPage(teamPage-1);setTeam('');setParticipants([]);}}>Equipes anteriores</Button><Button variant="ghost" disabled={busy||teams.data.count<10||teams.isFetching} onClick={()=>{setTeamPage(teamPage+1);setTeam('');setParticipants([]);}}>Próximas equipes</Button></div>}
    <fieldset disabled={busy||!members.data||members.isFetching}><legend>Participantes da equipe</legend>{members.data?.filter(person=>person.status==='ACTIVE').map(person=><label className="field" key={person.id}><span><input type="checkbox" checked={participants.includes(person.id)} onChange={event=>setParticipants(toggle(participants,person.id,event.target.checked))}/> {person.fullName} · {person.registration}</span></label>)}</fieldset></>:<>
      <Field label="Buscar trabalhador"><input type="search" maxLength={200} value={search} disabled={busy} onChange={event=>setSearch(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();lookupPeople();}}}/></Field><Button variant="secondary" disabled={busy||!unit||people.isFetching} onClick={lookupPeople}>Consultar trabalhadores</Button>
      <Field label="Trabalhador"><select value={personId} disabled={busy||!people.data||people.isFetching} onChange={event=>setPerson(event.target.value)}><option value="">Selecione</option>{people.data?.items.map(person=><option key={person.id} value={person.id}>{person.fullName} · {person.registration}</option>)}</select></Field>
      {people.data&&(peoplePage>1||people.data.total>20)&&<div className="actions"><Button variant="ghost" disabled={busy||peoplePage<=1||people.isFetching} onClick={()=>{setPeoplePage(peoplePage-1);setPerson('');}}>Pessoas anteriores</Button><Button variant="ghost" disabled={busy||peoplePage*20>=people.data.total||people.isFetching} onClick={()=>{setPeoplePage(peoplePage+1);setPerson('');}}>Próximas pessoas</Button></div>}
      <Field label="Tipo"><select value={type} disabled={busy} onChange={event=>setType(event.target.value)}>{Object.entries(nativeDesignationTypes).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></Field><Field label="Origem" required><input value={origin} maxLength={120} disabled={busy} onChange={event=>setOrigin(event.target.value)}/></Field>
    </>}
    {!context&&<><Field label="Início (Brasília)" required><input type="datetime-local" value={startsAt} disabled={busy} onChange={event=>setStart(event.target.value)}/></Field><Field label="Término (Brasília)" required><input type="datetime-local" value={endsAt} disabled={busy} onChange={event=>setEnd(event.target.value)}/></Field></>}
    <fieldset disabled={busy||!services.data||services.isFetching}><legend>Serviços</legend>{services.data?.map(service=><label className="field" key={service.id}><span><input type="checkbox" checked={serviceIds.includes(service.id)} onChange={event=>setServices(toggle(serviceIds,service.id,event.target.checked))}/> {service.name}</span></label>)}</fieldset>
  </>}</NativeCommandDialog>;
}
function same(a:readonly string[],b:readonly string[]){return a.length===b.length&&a.every(id=>b.includes(id));}

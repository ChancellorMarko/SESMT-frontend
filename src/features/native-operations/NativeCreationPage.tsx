import { useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router';
import { useSession } from '../../shared/auth/SessionProvider';
import { Feedback, PageHeader } from '../../shared/ui';
import { NativeCreationDialog } from './NativeCreationDialog';
import { nativeAgendaReturn } from './NativeAppointmentDetail';

export function NativeCreationPage({ kind }: { kind: 'appointment'|'designation' }) {
  const { sessionKey, can } = useSession(), navigate = useNavigate(), location = useLocation(), client = useQueryClient();
  const appointment=kind==='appointment',back=appointment?nativeAgendaReturn(location.state?.nativeReturnTo):'/app/designacoes';
  return <div className="stack"><PageHeader title={appointment?'Agenda':'Designações'}/>{!can(appointment?'pt:criar':'pt:editar')?<Feedback tone="warning">Seu acesso não permite criar este registro.</Feedback>:<NativeCreationDialog kind={kind} onClose={()=>void navigate(back,{replace:true})} onDone={async()=>{
    await Promise.all([client.invalidateQueries({queryKey:[appointment?'native-agenda':'native-designations',sessionKey]}),client.invalidateQueries({queryKey:['native-dashboard',sessionKey]})]);
    void navigate(back,{replace:true,state:{nativeCreated:true}});
  }}/>}</div>;
}

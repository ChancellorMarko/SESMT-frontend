import { api } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import { useVerifiedRead } from '../../shared/lib/verified-read';
import { formatDate } from '../../shared/lib/format';
import { Feedback, Modal, Spinner } from '../../shared/ui';
import { checkedEditProfile, checkedOrganizationHistory, type OrganizationEditProfile } from './native-organization-edit';
import { NativeOrganizationCreate } from './NativeOrganizationCreate';
import type { NativeOrganization, organizationResources } from './native-organization';

export type OrganizationEditTarget = { id: string; companyId: string; unitId: string | null };
export function NativeOrganizationEdit({ target,resource,context,onClose,onDone }: {
  target: OrganizationEditTarget; resource: typeof organizationResources[number]; context: NativeOrganization; onClose: () => void; onDone: () => Promise<void>;
}) {
  const { sessionKey,can } = useSession();
  const enabled = can(resource.editPermission) && context[resource.key].some(r => r.id === target.id && r.canEdit);
  const path = `/organization-management/${resource.key}/${target.id}`;
  const detail = useVerifiedRead({queryKey:['native-organization-edit',sessionKey,resource.key,target.id],enabled,
    request: signal => api.get<unknown>(path,{signal}),validate:value=>checkedEditProfile(value,resource.key,target.id,[target.companyId],target.unitId)});
  const history = useVerifiedRead({queryKey:['native-organization-edit',sessionKey,resource.key,target.id,'history',detail.data?.version],enabled:Boolean(detail.data),
    request: signal=>api.get<unknown>(`${path}/history`,{signal}),validate:checkedOrganizationHistory});
  return detail.data && enabled ? <PinnedEditor initial={detail.data} resource={resource} context={context} onClose={onClose} onDone={onDone}
    history={<details><summary>Histórico de alterações</summary>{history.isPending?<Spinner/>:history.isError?<Feedback tone="danger">Não foi possível consultar o histórico.</Feedback>:history.data?.length?<ol>{history.data.map(e=><li key={e.id}><strong>{e.actorName || 'Responsável'}</strong><p>{formatDate(e.occurredAt)}</p><p>{e.reason || 'Atualização pela API'}</p></li>)}</ol>:<p>Nenhuma alteração registrada neste fluxo.</p>}</details>}/>
    : <Modal open title={`Editar ${resource.singular}`} onClose={onClose}>{!enabled || detail.isError?<Feedback tone="danger">Cadastro indisponível ou sem autorização para editar.</Feedback>:<Spinner/>}</Modal>;
}
import { useState, type ReactNode } from 'react';
// A background read must never replace an editor's version while preserving its old fields.
function PinnedEditor({ initial,...props }: {initial:OrganizationEditProfile; resource:typeof organizationResources[number];context:NativeOrganization;history:ReactNode;onClose:()=>void;onDone:()=>Promise<void>}) {
  const [opening] = useState(initial);
  return <NativeOrganizationCreate {...props} opening={opening}/>;
}

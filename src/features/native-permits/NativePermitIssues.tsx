import { useMemo, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { api } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import { useVerifiedRead } from '../../shared/lib/verified-read';
import { Badge, Button, Feedback, InfoButton, Spinner } from '../../shared/ui';
import { checkedNativeUsers } from '../administration/native-users';
import { checkedDocumentTypes } from '../native-documents/contracts';
import { readActiveDocumentTypes } from '../native-documents/queries';
import type { NativePermit } from './contracts';
import { describeIssues, type PermitIssue } from './permit-issues';
import { plural } from '../../shared/lib/format';
import styles from '../../shared/ui/NativeRecords.module.css';
import local from './NativePermits.module.css';

const PAGE = 10;
type Readiness = { data?: { ready: boolean; issues: PermitIssue[] }; isPending: boolean; isError: boolean };

/** "What is missing to release": each item names the person, document or service involved and the next step.
 * Name lookups reuse reads the account may already do; when one is not allowed the item stays generic. */
export function NativePermitIssues({ permit, readiness, serviceNames }: { permit: NativePermit; readiness: Readiness; serviceNames?: readonly { code: string; name: string }[] }) {
  const { sessionKey, me, can } = useSession(), [selectedPage, setPage] = useState(1);
  const issues = readiness.data?.issues ?? [];
  const needsTypes = issues.some(issue => issue.documentTypeId), needsPeople = issues.some(issue => issue.participantUserId);
  const users = useVerifiedRead({ queryKey: ['native-users', sessionKey], enabled: needsPeople && can('users.read'),
    request: signal => api.get<unknown>('/users', { signal }), validate: checkedNativeUsers });
  const types = useVerifiedRead({ queryKey: ['native-document-types', sessionKey], enabled: needsTypes,
    request: readActiveDocumentTypes, validate: checkedDocumentTypes });
  const described = useMemo(() => describeIssues(issues, permit, {
    currentUserId: me?.user.id,
    userNames: users.data && new Map(users.data.map(user => [user.id.toLowerCase(), user.name])),
    documentTypeNames: types.data && new Map(types.data.map(type => [type.id.toLowerCase(), type.name])),
    serviceNames: serviceNames && new Map(serviceNames.map(service => [service.code, service.name])),
  }), [issues, permit, me?.user.id, users.data, types.data, serviceNames]);
  const pages = Math.max(1, Math.ceil(described.length / PAGE)), page = Math.min(selectedPage, pages);
  return <section className={styles.results} aria-labelledby="pt-issues-title">
    <div className={styles.footer}><h2 id="pt-issues-title">O que falta para liberar</h2>{readiness.data && <Badge tone={readiness.data.ready ? 'success' : 'warning'}>{readiness.data.ready ? 'Sem pendências' : plural(issues.length, 'pendência', 'pendências')}</Badge>}</div>
    {readiness.isPending && <Spinner/>}
    {readiness.isError && <Feedback tone="danger">Não foi possível conferir os requisitos. Liberação, início e retomada ficam indisponíveis até atualizar a PT.</Feedback>}
    {readiness.data && (!described.length
      ? <p className={`${local.inset} ${local.ready}`}><CheckCircle2 size={18} aria-hidden="true"/>A API não retornou pendências. A liberação continua sendo uma decisão de quem libera e é conferida de novo no servidor.</p>
      : <>
        <ul className={local.issueList}>{described.slice((page - 1) * PAGE, page * PAGE).map(item => <li key={item.key}>
          <div className={local.issueText}>
            <strong><span>{item.title}</span>{item.subject && <> · <span className={local.issueSubject}>{item.subject}</span></>}</strong>
            {item.detail && <small>{item.detail}</small>}
            <p>{item.next}</p>
          </div>
          <InfoButton title={`Identificadores: ${item.title}`}><dl className={styles.details}><dt>Código</dt><dd>{item.issue.code}</dd><dt>Participante (usuário)</dt><dd>{item.issue.participantUserId ?? 'Não informado'}</dd><dt>Tipo documental</dt><dd>{item.issue.documentTypeId ?? 'Não informado'}</dd><dt>Serviço</dt><dd>{item.issue.serviceCode ?? 'Não informado'}</dd></dl></InfoButton>
        </li>)}</ul>
        {pages > 1 && <nav className={styles.footer} aria-label="Paginação de pendências"><span>Página {page} de {pages}</span><div className="actions"><Button variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anteriores</Button><Button variant="ghost" disabled={page >= pages} onClick={() => setPage(page + 1)}>Próximas</Button></div></nav>}
      </>)}
  </section>;
}

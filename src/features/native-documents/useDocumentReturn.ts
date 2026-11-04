import { useLocation } from 'react-router';
import { useSession } from '../../shared/auth/SessionProvider';
import { consultationNavigation } from '../../shared/lib/consultation-navigation';
import { documentNavigation } from '../documents/document-navigation';
import { expirationNavigation } from '../documents/expiry-navigation';
import { notificationNavigation } from '../notifications/notification-navigation';
import { workerDocumentDestination, workerDocumentNavigation } from '../workers/worker-document-navigation';
import { nativeDocumentReturn } from './contracts';

/** Preserve the already-validated source flow when switching from projections to native commands. */
export function useDocumentReturn() {
  const location = useLocation(), { unitId, sessionKey, can } = useSession();
  const notification = can('notifications.read') ? notificationNavigation(location.state, unitId) : undefined;
  const expiry = expirationNavigation(location.state, unitId), consultation = consultationNavigation(location.state, unitId);
  const worker = workerDocumentNavigation(location.state, sessionKey, unitId, can('workers.read'), can('eligibility.read'));
  const destination = worker ? workerDocumentDestination(worker) : undefined;
  const list = documentNavigation(location.state, unitId, can('dashboard.read'));
  if (notification) return { to: `/app/notificacoes${notification.notificationReturnTo.search}`, label: 'Voltar às notificações', state: undefined };
  if (expiry) return { to: `/app/vencimentos${expiry.expirationReturnTo.search}`, label: 'Voltar aos vencimentos', state: undefined };
  if (consultation) return { to: `/app/consulta${consultation.fromSearch}`, label: 'Voltar à consulta', state: undefined };
  if (destination) return { to: destination.to, label: 'Voltar ao trabalhador', state: destination.state };
  if (list?.documentListReturnTo) return { to: `/app/documentos${list.documentListReturnTo.search}`, label: 'Voltar aos documentos', state: list };
  if (list?.documentDashboardReturnTo) return { to: `/app/painel-documental${list.documentDashboardReturnTo.search}`, label: 'Voltar ao painel documental', state: list };
  return { to: `/app/documentos${nativeDocumentReturn(location.state?.nativeDocumentsSearch)}`, label: 'Voltar aos documentos', state: undefined };
}

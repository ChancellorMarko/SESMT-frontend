import { Link, useLocation } from 'react-router';
import { useSession } from '../../shared/auth/SessionProvider';
import { readinessReturnPath } from '../requirements/readiness-navigation';

export function WorkerIntegrationLink({ workerId, workerName }: { workerId: string; workerName: string }) {
  const { unitId, can } = useSession();
  const location = useLocation();
  if (!unitId || !can('workers.read') || !/^[A-Za-z0-9_-]+$/.test(workerId)) return null;
  const readinessTarget = can('eligibility.read') && /^\/app\/agenda\/[A-Za-z0-9_-]+$/.test(location.pathname) ? readinessReturnPath(location.state, unitId) : undefined;
  const readinessOrigin = readinessTarget ? { readinessReturnTo: { search: readinessTarget.slice('/app/pendencias'.length), unitId } } : {};
  return <Link className="button button--secondary" aria-label={`Consultar integração de ${workerName}`} to={`/app/trabalhadores/${encodeURIComponent(workerId)}#integracao`} state={{ integrationReturnTo: { pathname: location.pathname, search: location.search, hash: location.hash, unitId, ...readinessOrigin } }}>Consultar integração</Link>;
}

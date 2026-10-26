import { createBrowserRouter } from 'react-router';
import { useSession } from '../shared/auth/SessionProvider';
import { App } from './App';
import { NavigationProtection } from './navigation/NavigationProtection';
import { AppQueryNavigationProvider } from '../shared/lib/app-query-params';

function ProtectedApp() {
  const { sessionKey, unitId } = useSession();
  return <AppQueryNavigationProvider><NavigationProtection contextKey={`${sessionKey}:${unitId}`}><App /></NavigationProtection></AppQueryNavigationProvider>;
}

let router: ReturnType<typeof createBrowserRouter> | undefined;

/** Keep one history owner, initialized after the selected API environment is ready. */
export function getAppRouter() {
  return router ??= createBrowserRouter([{ path: '*', element: <ProtectedApp /> }]);
}

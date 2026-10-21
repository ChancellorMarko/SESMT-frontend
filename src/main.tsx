import { createRoot } from 'react-dom/client';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { MotionConfig } from 'framer-motion';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider, useSession } from './shared/auth/SessionProvider';
import { API_MODE } from './shared/api/client';
import { App } from './app/App';
import './shared/styles/global.css';
import { NavigationProtection } from './app/navigation/NavigationProtection';

function ProtectedApp() {
  const { sessionKey, unitId } = useSession();
  return <NavigationProtection contextKey={`${sessionKey}:${unitId}`}><App /></NavigationProtection>;
}

async function start() {
  if (API_MODE==='demo') {
    const { worker }=await import('./mocks/browser');
    await worker.start({ onUnhandledRequest: 'bypass', serviceWorker:{url:`${import.meta.env.BASE_URL}mockServiceWorker.js`}, quiet:true });
  }
  const queryClient=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:30000,refetchOnWindowFocus:false},mutations:{retry:false}}});
  const router = createBrowserRouter([{ path: '*', element: <ProtectedApp /> }]);
  createRoot(document.getElementById('root')!).render(<MotionConfig reducedMotion="user"><QueryClientProvider client={queryClient}><SessionProvider><RouterProvider router={router} /></SessionProvider></QueryClientProvider></MotionConfig>);
}
start().catch(error=>{console.error('Falha ao inicializar o frontend',error);const root=document.getElementById('root');if(root){root.textContent='Não foi possível iniciar a aplicação. Recarregue a página ou confira a configuração de integração.';root.setAttribute('role','alert');}});

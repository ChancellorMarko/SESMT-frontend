import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from './shared/auth/SessionProvider';
import { API_MODE } from './shared/api/client';
import { App } from './app/App';
import './shared/styles/global.css';

async function start() {
  if (API_MODE==='demo') {
    const { worker }=await import('./mocks/browser');
    await worker.start({ onUnhandledRequest: 'bypass', serviceWorker:{url:`${import.meta.env.BASE_URL}mockServiceWorker.js`}, quiet:true });
  }
  const queryClient=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:30000,refetchOnWindowFocus:false},mutations:{retry:false}}});
  createRoot(document.getElementById('root')!).render(<QueryClientProvider client={queryClient}><SessionProvider><BrowserRouter><App/></BrowserRouter></SessionProvider></QueryClientProvider>);
}
start().catch(error=>{console.error('Falha ao inicializar o frontend',error);const root=document.getElementById('root');if(root){root.textContent='Não foi possível iniciar a aplicação. Recarregue a página ou confira a configuração de integração.';root.setAttribute('role','alert');}});

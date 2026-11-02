import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { useBlocker } from 'react-router';
import { Button, Feedback, Modal } from '../../shared/ui';

type GuardState = { dirty: boolean; busy: boolean };
type RegisteredGuard = GuardState & { contextKey: string };
type ProtectionContext = {
  contextKey: string;
  register: (id: symbol, state: RegisteredGuard) => () => void;
  requestLogout: (action: () => void) => void;
};
const Context = createContext<ProtectionContext | null>(null);

/** One router blocker combines every open editor, including nested PT panels. */
export function NavigationProtection({ children, contextKey }: { children: ReactNode; contextKey: string }) {
  const guards = useRef(new Map<symbol, RegisteredGuard>());
  const [, changed] = useReducer(value => value + 1, 0);
  const [logout, setLogout] = useState<{ contextKey: string; action: () => void }>();
  const blockedContext = useRef(contextKey);
  const currentContext = useRef(contextKey); currentContext.current = contextKey;
  const register = useCallback((id: symbol, state: RegisteredGuard) => {
    guards.current.set(id, state); changed();
    return () => { guards.current.delete(id); changed(); };
  }, []);
  const currentGuards = () => [...guards.current.values()].filter(guard => guard.contextKey === currentContext.current);
  const blocker = useBlocker(({ currentLocation, nextLocation, historyAction }) => {
    // Successful saves use PUSH/REPLACE; anchors within this page preserve drafts.
    if (historyAction !== 'POP' || currentLocation.pathname === nextLocation.pathname && currentLocation.search === nextLocation.search) return false;
    if (!currentGuards().some(guard => guard.dirty || guard.busy)) return false;
    blockedContext.current = currentContext.current;
    return true;
  });
  const requestLogout = useCallback((action: () => void) => {
    const active = [...guards.current.values()].some(guard => guard.contextKey === currentContext.current && (guard.dirty || guard.busy));
    if (!active) { action(); return; }
    setLogout(previous => previous?.contextKey === currentContext.current ? previous : { contextKey: currentContext.current, action });
  }, []);
  const previousContext = useRef(contextKey);
  useEffect(() => {
    if (previousContext.current === contextKey) return;
    previousContext.current = contextKey;
    setLogout(undefined);
    if (blocker.state === 'blocked') blocker.reset();
  }, [contextKey, blocker]);
  const value = useMemo(() => ({ contextKey, register, requestLogout }), [contextKey, register, requestLogout]);
  const busy = currentGuards().some(guard => guard.busy);
  const historyPending = blocker.state === 'blocked' && blockedContext.current === contextKey;
  const logoutPending = logout?.contextKey === contextKey ? logout : undefined;
  function stay() {
    setLogout(undefined);
    if (blocker.state === 'blocked') blocker.reset();
  }
  function discard() {
    if (currentGuards().some(guard => guard.busy)) return;
    if (logoutPending && logoutPending.contextKey === currentContext.current) {
      setLogout(undefined);
      if (blocker.state === 'blocked') blocker.reset();
      logoutPending.action();
    } else if (blocker.state === 'blocked' && blockedContext.current === currentContext.current) blocker.proceed();
  }
  return <Context.Provider value={value}>{children}
    <Modal open={historyPending || Boolean(logoutPending)} title="Alterações não salvas" onClose={stay}>
      <div className="stack">
        {busy ? <Feedback tone="warning">Aguarde a confirmação da ação em andamento antes de sair. Seu preenchimento foi mantido.</Feedback>
          : <p>{logoutPending ? 'Há alterações não salvas. Deseja descartá-las e sair da plataforma?' : 'Há alterações não salvas. Deseja descartá-las e sair desta tela?'}</p>}
        <div className="actions"><Button variant="secondary" onClick={stay}>Continuar preenchendo</Button><Button variant="danger" disabled={busy} onClick={discard}>Descartar e sair</Button></div>
      </div>
    </Modal>
  </Context.Provider>;
}

/** Existing local link/unit guards remain usable without a data router in isolated views. */
export function useNavigationGuard({ dirty, busy }: GuardState) {
  const protection = useContext(Context);
  const id = useRef(Symbol('navigation-guard'));
  const register = protection?.register;
  const contextKey = protection?.contextKey;
  useLayoutEffect(() => {
    if (!register || contextKey === undefined || !dirty && !busy) return;
    return register(id.current, { dirty, busy, contextKey });
  }, [register, contextKey, dirty, busy]);
}

/** Only an explicit logout request is protected; expiry and remote revocation remain immediate. */
export function useProtectedLogout() {
  const protection = useContext(Context);
  return protection?.requestLogout ?? ((action: () => void) => action());
}

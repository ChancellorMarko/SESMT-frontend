import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { MeDto, MfaChallengeDto, SessionDto } from '../contracts';
import { api, ApiError, cancelAllRequests, clearCredentials, obtainCsrf, renewSession, setAccessToken, setExpiredHandler } from '../api/client';

interface SessionContextValue {
  me: MeDto | null; unitId: string | undefined; sessionKey: string;
  status: 'restoring' | 'anonymous' | 'authenticated'; sessionError: string | null;
  can: (permission: string) => boolean; setUnitId: (id: string) => void;
  login: (email: string, password: string) => Promise<MfaChallengeDto | null>;
  verifyMfa: (challengeId: string, code: string) => Promise<void>;
  logout: () => Promise<void>; restore: () => Promise<void>;
}
const Context = createContext<SessionContextValue | null>(null);
export function SessionProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [me,setMe] = useState<MeDto | null>(null); const [unitId,changeUnit] = useState<string>();
  const [sessionKey,setKey] = useState('anonymous');
  const [status,setStatus] = useState<SessionContextValue['status']>('restoring');
  const [sessionError,setError] = useState<string | null>(null);
  const generation = useRef(0);
  const broadcast = useRef<BroadcastChannel | null>(null);
  const resetState = useCallback(() => { client.clear(); setMe(null); changeUnit(undefined); setKey(crypto.randomUUID()); setStatus('anonymous'); },[client]);
  const clear = useCallback(() => { generation.current++; clearCredentials(); resetState(); },[resetState]);
  const assertCurrent = (operation: number) => { if (operation !== generation.current) throw new DOMException('Sessão alterada.', 'AbortError'); };
  const establish = useCallback(async (session: SessionDto, operation: number) => {
    assertCurrent(operation);
    setAccessToken(session.accessToken);
    const identity = await api.get<MeDto>('/me');
    assertCurrent(operation);
    if (identity.scope.expiresAt && (!Number.isFinite(Date.parse(identity.scope.expiresAt)) || Date.parse(identity.scope.expiresAt) <= Date.now())) throw new Error('A concessão de acesso expirou ou está inválida. Solicite uma nova autorização.');
    client.clear(); setMe(identity); changeUnit(identity.scope.unitIds[0]); setKey(crypto.randomUUID()); setStatus('authenticated'); setError(null);
    sessionStorage.removeItem('sesmt.logoutPending');
  },[client]);
  const restore = useCallback(async () => {
    if (sessionStorage.getItem('sesmt.logoutPending')) { clear(); return; }
    const operation = ++generation.current;
    cancelAllRequests(); setStatus('restoring'); setError(null);
    try { await obtainCsrf(); assertCurrent(operation); await establish(await renewSession(), operation); }
    catch (error) {
      if (operation !== generation.current) return;
      clear();
      if (!(error instanceof ApiError && error.status === 401) && !(error instanceof DOMException && error.name === 'AbortError')) setError(error instanceof Error ? error.message : 'Não foi possível restaurar a sessão.');
    }
  },[establish,clear]);
  useEffect(() => {
    setExpiredHandler(() => { clear(); setError('Sua sessão expirou. Entre novamente.'); }); void restore();
    return () => { generation.current++; cancelAllRequests(); setExpiredHandler(() => {}); };
  },[restore,clear]);
  useEffect(() => {
    if (!me?.scope.expiresAt) return;
    const expiresAt = Date.parse(me.scope.expiresAt);
    const operation = generation.current;
    let timeout: ReturnType<typeof setTimeout>;
    const checkExpiration = () => {
      if (operation !== generation.current) return;
      const remaining = expiresAt - Date.now();
      if (remaining <= 0 || !Number.isFinite(remaining)) { clear(); setError('Sua concessão de acesso expirou.'); return; }
      // Browsers cap setTimeout at a signed 32-bit integer (about 24.8 days).
      timeout = setTimeout(checkExpiration, Math.min(remaining, 2_147_483_647));
    };
    checkExpiration();
    return () => clearTimeout(timeout);
  },[me,sessionKey,clear]);
  useEffect(() => {
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('sesmt-session') : null;
    broadcast.current = channel;
    if (channel) channel.onmessage = e => { if (e.data === 'logout') { sessionStorage.setItem('sesmt.logoutPending','1'); clear(); } };
    return () => { if (broadcast.current === channel) broadcast.current = null; channel?.close(); };
  },[clear]);
  const login = async (email: string,password: string) => {
    clear(); setError(null);
    const operation = generation.current;
    try {
      await obtainCsrf(); assertCurrent(operation);
      const result = await api.post<SessionDto | MfaChallengeDto>('/auth/login',{email,password});
      assertCurrent(operation);
      if ('status' in result) return result;
      await establish(result, operation); return null;
    } catch (error) { if (operation === generation.current) clear(); throw error; }
  };
  const verifyMfa = async (challengeId: string,code: string) => {
    const operation = ++generation.current;
    cancelAllRequests();
    try { await obtainCsrf(); assertCurrent(operation); await establish(await api.post<SessionDto>('/auth/mfa/verify',{challengeId,code}), operation); }
    catch (error) { if (operation === generation.current) clear(); throw error; }
  };
  const logout = async () => {
    const operation = ++generation.current;
    sessionStorage.setItem('sesmt.logoutPending','1');
    cancelAllRequests();
    // The request captures its headers before credentials are removed locally.
    const pending = api.post('/auth/logout');
    setAccessToken(null); resetState();
    broadcast.current?.postMessage('logout');
    try { await pending; if (operation === generation.current) { sessionStorage.removeItem('sesmt.logoutPending'); setError(null); } }
    catch { if (operation === generation.current) setError('A sessão local foi encerrada. A revogação na API não foi confirmada; entre novamente apenas quando desejar.'); }
    finally { if (operation === generation.current) clear(); }
  };
  const setUnitId = (id: string) => { if (id === unitId || !me?.scope.unitIds.includes(id)) return; cancelAllRequests(); void client.cancelQueries(); client.clear(); changeUnit(id); };
  return <Context.Provider value={{me,unitId,sessionKey,status,sessionError,can:p => !!me?.permissions.includes(p),setUnitId,login,verifyMfa,logout,restore}}>{children}</Context.Provider>;
}
export function useSession() { const value=useContext(Context); if(!value) throw new Error('SessionProvider não encontrado.'); return value; }

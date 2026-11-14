import { useCallback } from 'react';
import { api } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import { useVerifiedRead } from '../../shared/lib/verified-read';
import { checkedNativeServices } from './contracts';

/** Service catalog shared by agenda, PTs and creation forms (same cache key). Unknown codes stay as they are. */
export function useServiceNames(enabled = true) {
  const { sessionKey } = useSession();
  const services = useVerifiedRead({ queryKey: ['native-services', sessionKey], enabled,
    request: signal => api.get<unknown>('/work-permits/services', { signal }), validate: checkedNativeServices });
  const serviceName = useCallback((code: string) => services.data?.find(service => service.code === code)?.name ?? code, [services.data]);
  return { services: services.data, serviceName };
}

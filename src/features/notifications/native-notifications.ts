import { z } from 'zod';
import { api } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import { isIsoInstant } from '../../shared/auth/session-response';
import { InvalidReadResponse, useVerifiedRead } from '../../shared/lib/verified-read';

// NotificationDto + NotificationsController, official API (not the demo envelope).
const notification = z.object({
  id: z.string().uuid(), type: z.string().trim().min(1).max(200), resourceId: z.string().uuid(),
  text: z.string().min(1).max(16000), createdAt: z.string().refine(isIsoInstant),
  readAt: z.string().refine(isIsoInstant).nullable(),
}).refine(item => item.readAt === null || Date.parse(item.readAt) >= Date.parse(item.createdAt));
const response = z.object({ items: z.array(notification) });
export type NativeNotification = z.infer<typeof notification>;
export function checkedNativeNotifications(value: unknown) {
  const parsed = response.safeParse(value);
  if (!parsed.success || new Set(parsed.data.items.map(item => item.id)).size !== parsed.data.items.length) throw new InvalidReadResponse();
  return parsed.data;
}
export function useNativeNotifications() {
  const { sessionKey, can } = useSession();
  return useVerifiedRead({ queryKey: ['native-notifications', sessionKey], enabled: can('notifications.read'),
    request: signal => api.get<unknown>('/notifications', { signal }), validate: checkedNativeNotifications });
}
export function nativeNotificationType(type: string) {
  const labels: Record<string, string> = { PT_AGUARDANDO_REVISAO: 'PT aguardando revisão', PT_DEVOLVIDA: 'PT devolvida', DOCUMENTO_DEVOLVIDO: 'Documento devolvido' };
  return Object.hasOwn(labels, type) ? labels[type] : type;
}

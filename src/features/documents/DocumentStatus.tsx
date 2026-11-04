import { Badge } from '../../shared/ui';
import { statusLabels } from './validation';

export function DocumentStatus({ status }: { status: string }) {
  const tone = status === 'ACTIVE' || status === 'CLEAN' || status === 'VERIFIED' ? 'success'
    : status === 'EXPIRED' || status === 'REJECTED' || status === 'ERROR' ? 'danger'
      : status === 'IN_REVIEW' || status === 'PENDING' ? 'warning'
        : status === 'APPROVED' ? 'info' : 'neutral';
  return <Badge tone={tone}>{statusLabels[status] ?? status}</Badge>;
}

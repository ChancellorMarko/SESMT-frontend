import type { FinalReviewStatus, OperationStatus } from '../../shared/contracts/work-permits';
import { Badge, type Tone } from '../../shared/ui';

export const operationLabels: Record<OperationStatus, string> = { VERIFICATION: 'Em verificação', RELEASED: 'Execução liberada', EXECUTING: 'Em execução', SUSPENDED: 'Operação suspensa', COMPLETED: 'Atividade concluída', CANCELED: 'Cancelada' };
export const reviewLabels: Record<FinalReviewStatus, string> = { NOT_SUBMITTED: 'Revisão não enviada', PENDING_REVIEW: 'Aguardando revisão', RETURNED: 'Revisão devolvida', VALIDATED: 'Encerramento validado' };
const operationTones: Record<OperationStatus, Tone> = { VERIFICATION: 'neutral', RELEASED: 'success', EXECUTING: 'info', SUSPENDED: 'warning', COMPLETED: 'neutral', CANCELED: 'danger' };
const reviewTones: Record<FinalReviewStatus, Tone> = { NOT_SUBMITTED: 'neutral', PENDING_REVIEW: 'warning', RETURNED: 'danger', VALIDATED: 'success' };
export function PermitStatus({ operationStatus, reviewStatus }: { operationStatus: OperationStatus; reviewStatus: FinalReviewStatus }) {
  return <div className="actions"><Badge tone={operationTones[operationStatus]}>{operationLabels[operationStatus]}</Badge><Badge tone={reviewTones[reviewStatus]}>{reviewLabels[reviewStatus]}</Badge></div>;
}

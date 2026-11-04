import type { EligibilityItemDto } from '../contracts/work-permits';

/** Accept the former integration identifier while the proposed API gains an explicit source. */
export const isWorkerIntegrationItem = (item: EligibilityItemDto) => item.source === 'WORKER_INTEGRATION' || item.requirementId.startsWith('integration:');
export const isMatrixEligibilityItem = (item: EligibilityItemDto) => !isWorkerIntegrationItem(item) && (item.source === undefined || item.source === 'REQUIREMENT_MATRIX');

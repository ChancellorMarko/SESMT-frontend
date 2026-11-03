import { describe, expect, it } from 'vitest';
import { safetyFilter, safetyReturn } from './worker-safety-navigation';
import { restoredWorkerDocumentPage } from './worker-document-navigation';

const unit = '75000000-0000-4000-8000-000000000002';
const worker = '75000000-0000-4000-8000-000000000003';
const other = '75000000-0000-4000-8000-000000000004';
const state = { workerDocumentReturnTo: { unitId: unit, workerId: worker, sessionKey: 'a', documentPage: 2, to: 'https://invalid.example' } };

describe('worker safety navigation', () => {
  it('accepts a single worker filter and rejects another subject for an own-only session', () => {
    expect(safetyFilter(new URLSearchParams({ workerId: worker }), true, worker)).toEqual({ validWorker: true, subjectWorkerId: worker });
    expect(safetyFilter(new URLSearchParams({ workerId: other }), true, worker).validWorker).toBe(false);
    expect(safetyFilter(new URLSearchParams(`workerId=${worker}&workerId=${other}`), false).validWorker).toBe(false);
    expect(safetyFilter(new URLSearchParams('workerId='), false).validWorker).toBe(false);
  });

  it('rebuilds the route and keeps document pagination only for the matching authorized origin', () => {
    const back = safetyReturn(state, 'a', unit, worker, true, false);
    expect(back?.to).toBe(`/app/trabalhadores/${worker}#seguranca`);
    expect(restoredWorkerDocumentPage(back?.state, 'a', unit, worker)).toBe(2);
    expect(safetyReturn(state, 'b', unit, worker, true, false)).toBeUndefined();
    expect(safetyReturn(state, 'a', other, worker, true, false)).toBeUndefined();
    expect(safetyReturn(state, 'a', unit, other, true, false)).toBeUndefined();
    expect(safetyReturn(state, 'a', unit, worker, false, false)).toBeUndefined();
  });
});

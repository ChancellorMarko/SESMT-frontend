// Synthetic GET /deadlines response (backend docs/deadlines.md).
export const deadlinesFixture = () => ({
  referenceDate: '2026-11-14', days: 30, kinds: ['TRAINING', 'EPI'], summary: { overdue: 1, dueSoon: 1 }, total: 2, truncated: false,
  items: [
    { kind: 'TRAINING', id: 'A1B2C3D4-0000-4000-8000-000000000001', companyId: '10000000-0000-0000-0000-000000000001', unitId: '20000000-0000-0000-0000-000000000001',
      unitName: 'Unidade Centro', workerId: '30000000-0000-0000-0000-000000000001', workerName: 'Ana Lima', label: 'NR-35', dueOn: '2026-11-01', status: 'OVERDUE' },
    { kind: 'EPI', id: 'a1b2c3d4-0000-4000-8000-000000000002', companyId: '10000000-0000-0000-0000-000000000001', unitId: '20000000-0000-0000-0000-000000000001',
      unitName: 'Unidade Centro', workerId: '30000000-0000-0000-0000-000000000002', workerName: 'Bruno Reis', label: 'Luva', dueOn: '2026-11-14', status: 'DUE_SOON' },
  ],
});

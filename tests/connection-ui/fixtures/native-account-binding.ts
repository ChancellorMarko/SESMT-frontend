import { workerIds, workerDraft } from './native-workers';
export const bindingIds = { ...workerIds, account: '73000000-0000-4000-8000-000000000001', secondAccount: '73000000-0000-4000-8000-000000000002' };
export const bindingAccounts = [{ id: bindingIds.account, name: workerDraft.name, email: 'titular@example.invalid' }, { id: bindingIds.secondAccount, name: 'Outra Pessoa', email: 'outra@example.invalid' }];
export function bindingContext() { return { workerId: workerIds.worker, companyId: workerIds.company, unitId: workerIds.unit, name: workerDraft.name, enrollment: workerDraft.enrollment, revision: 1, active: true, userId: null as string | null }; }
export function bindingPage(page = 1) { return { ...bindingContext(), items: bindingAccounts, page, pageSize: 20, total: 2 }; }

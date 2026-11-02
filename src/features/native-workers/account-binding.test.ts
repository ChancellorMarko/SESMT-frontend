import { expect, it } from 'vitest';
import { checkedAccountCandidate, checkedAccountCandidates, checkedWorkerAccountContext } from './account-binding';
import { bindingAccounts, bindingContext, bindingIds as ids, bindingPage } from '../../../tests/connection-ui/fixtures/native-account-binding';
const expected = { workerId: ids.worker, unitId: ids.unit, companyIds: [ids.company] };
it('lê somente o contexto mínimo de vínculo e descarta atributos pessoais adicionais', () => {
  expect(checkedWorkerAccountContext({ ...bindingContext(), cpf: 'nao-cachear', dateOfBirth: '1990-01-01' }, expected)).toEqual(bindingContext());
});
it.each([{ workerId: ids.user }, { companyId: ids.foreign }, { unitId: ids.foreign }, { revision: 0 }, { revision: 1.5 }, { revision: undefined }, { active: undefined }, { userId: 'invalido' }])('recusa contexto incompatível %j', changes => {
  expect(() => checkedWorkerAccountContext({ ...bindingContext(), ...changes }, expected)).toThrow();
});
it('contas são IDs de usuário e devem coincidir com a seleção', () => {
  expect(checkedAccountCandidate(bindingAccounts[0], ids.account)).toEqual(bindingAccounts[0]);
  expect(() => checkedAccountCandidate(bindingAccounts[0], ids.worker)).toThrow();
  expect(() => checkedAccountCandidate({ ...bindingAccounts[0], email: 'invalido' }, ids.account)).toThrow();
});
it.each([{ revision: 2 }, { unitId: ids.foreign }, { workerId: ids.user }, { companyId: ids.foreign }, { page: 2 }, { pageSize: 10 }, { items: [bindingAccounts[0], bindingAccounts[0]] }])('catálogo precisa coincidir com trabalhador, revisão e paginação %j', changes => {
  expect(() => checkedAccountCandidates({ ...bindingPage(), ...changes }, bindingContext(), 1)).toThrow();
});
it('aceita a página válida sem carregar CPF ou nascimento', () => {
  expect(checkedAccountCandidates(bindingPage(), bindingContext(), 1).items).toEqual(bindingAccounts);
});

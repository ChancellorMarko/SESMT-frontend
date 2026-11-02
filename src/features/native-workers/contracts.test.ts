import { expect, it } from 'vitest';
import { checkedWorkerCreated, checkedWorkerDirectory, normalizedCpf, workerCreateBody } from './contracts';
import { workerDirectory, workerDraft, workerIds as ids, workerReceipt } from '../../../tests/connection-ui/fixtures/native-workers';

it.each(['00000000191', '000.000.001-91'])('normaliza e confere os dígitos do CPF do teste: %s', value => expect(normalizedCpf(value)).toBe('00000000191'));
it.each(['00000000190', '00000000000', '11111111111', '123', 'abc00000000191', '000000001919'])('recusa CPF inválido: %s', value => expect(normalizedCpf(value)).toBeUndefined());
it('cria o DTO nativo sem campos da demonstração nem conta implícita', () => {
  expect(workerCreateBody(workerDraft, ids.company, ids.unit, '2026-11-01')).toEqual({ ...workerDraft, companyId: ids.company, unitId: ids.unit, dismissalDate: null, userId: null });
});
it.each([{ name: 'Pessoa 3' }, { cpf: '11111111111' }, { dateOfBirth: '2026-02-30' }, { dateOfBirth: '2027-01-01' }, { admissionDate: '1980-01-01' }, { positionId: 'inválido' }])('valida os campos antes do POST: %j', changes => {
  expect(() => workerCreateBody({ ...workerDraft, ...changes }, ids.company, ids.unit, '2026-11-01')).toThrow();
});
it('não aceita cargos com empresa fora do catálogo autorizado', () => {
  expect(() => checkedWorkerDirectory({ ...workerDirectory, jobs: [{ ...workerDirectory.jobs[0], companyId: ids.foreign }] })).toThrow();
});
it('retém somente o ID depois de conferir os campos do recibo', () => {
  const body = workerCreateBody(workerDraft, ids.company, ids.unit, '2026-11-01'); expect(checkedWorkerCreated(workerReceipt(), body)).toBe(ids.worker);
  for (const change of [{ companyId: ids.foreign }, { userId: ids.user }, { cpfMasked: 'CPF sem máscara' }, { dateOfBirth: '1991-01-01' }, { active: false }]) expect(() => checkedWorkerCreated({ ...workerReceipt(), ...change }, body)).toThrow();
});

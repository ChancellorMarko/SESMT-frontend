import { expect, it } from 'vitest';
import { checkedEditableTeam, checkedTeamContext, checkedTeamEditor, sameRoster, teamFields, teamReturnPage } from './contracts';
import { editableTeamFixture, teamContext, teamIds as ids, teamPeople } from '../../../tests/connection-ui/fixtures/native-teams';
const scope = { unitId: ids.unit, companyIds: [ids.company] };

it('usa a raiz organizacional informada pelo servidor, inclusive para empresa independente', () => {
  expect(checkedTeamContext(teamContext, scope)).toEqual(teamContext);
  expect(checkedTeamContext({ ...teamContext, organizationId: ids.company }, scope).organizationId).toBe(ids.company);
});
it.each([{ companyId: ids.otherCompany }, { localId: ids.otherUnit }, { organizationId: '' }, { companyName: '' }])('recusa contexto incompatível %j', change => {
  expect(() => checkedTeamContext({ ...teamContext, ...change }, scope)).toThrow();
});
it.each([undefined, 0, -1, 1.5])('edição exige revisão inteira positiva %s', version => {
  expect(() => checkedEditableTeam({ ...editableTeamFixture(), version }, ids.team, scope)).toThrow();
});
it('vincula o formulário à empresa e às pessoas exatas da equipe', () => {
  const valid = { context: teamContext, team: editableTeamFixture(), people: [teamPeople[0]] };
  expect(checkedTeamEditor(valid, scope, ids.team).team?.version).toBe(1);
  expect(() => checkedTeamEditor({ ...valid, people: teamPeople }, scope, ids.team)).toThrow();
  expect(() => checkedTeamEditor({ ...valid, people: [] }, scope, ids.team)).toThrow();
  expect(() => checkedTeamEditor({ ...valid, team: { ...valid.team, companyId: ids.otherCompany } }, scope, ids.team)).toThrow();
});
it('cadastro exige um contexto vazio sem equipe pré-carregada ou pessoas de outra seleção', () => {
  expect(checkedTeamEditor({ context: teamContext, team: undefined, people: [] }, scope).team).toBeUndefined();
  expect(() => checkedTeamEditor({ context: teamContext, team: editableTeamFixture(), people: [] }, scope)).toThrow();
  expect(() => checkedTeamEditor({ context: teamContext, team: undefined, people: teamPeople }, scope)).toThrow();
});
it('normaliza textos e exige chefe separado dos participantes', () => {
  expect(teamFields('  Manutenção  ', ' ', ids.worker, [ids.secondWorker])).toEqual({ name: 'Manutenção', description: null, chiefId: ids.worker, participantIds: [ids.secondWorker] });
  expect(() => teamFields('Equipe', '', ids.worker, [ids.worker])).toThrow();
  expect(() => teamFields('Equipe', '', ids.worker, [ids.secondWorker, ids.secondWorker])).toThrow();
});
it.each([['', '', ids.worker], ['x'.repeat(151), '', ids.worker], ['Equipe', 'x'.repeat(1001), ids.worker], ['Equipe\nInjetada', '', ids.worker], ['Equipe', '', '']])('recusa campos inválidos %s', (name, description, chief) => {
  expect(() => teamFields(name, description, chief, [])).toThrow();
});
it('compara os integrantes como conjunto e rejeita duplicação', () => {
  expect(sameRoster([ids.worker, ids.secondWorker], [ids.secondWorker, ids.worker])).toBe(true);
  expect(sameRoster([ids.worker, ids.worker], [ids.worker, ids.secondWorker])).toBe(false);
});
it('restaura a página apenas na mesma unidade e sessão', () => {
  const state = { nativeTeamReturnTo: { unitId: ids.unit, sessionKey: 'current', page: 3 } };
  expect(teamReturnPage(state, ids.unit, 'current')).toBe(3);
  expect(teamReturnPage(state, ids.otherUnit, 'current')).toBe(1);
  expect(teamReturnPage(state, ids.unit, 'other')).toBe(1);
  expect(teamReturnPage({ nativeTeamReturnTo: { ...state.nativeTeamReturnTo, page: Infinity } }, ids.unit, 'current')).toBe(1);
});

import { expect, it } from 'vitest';
import { checkedScience } from './science';
import { checkedScienceParticipant } from './contracts';
import { permitFixture, permitIds as ids, declarationFixture } from '../../../tests/connection-ui/fixtures/native-permits';
import { scienceFixture, scienceParticipantFixture } from '../../../tests/connection-ui/fixtures/native-science';
const permit = permitFixture();
it('confere o conteúdo integral do contexto e das versões sem transformar ciência em assinatura', () => {
  const item = scienceFixture(); expect(checkedScience(item, permit)).toEqual(item);
});
it('permite a leitura antiga mas impede uma confirmação sem conteúdo integral', () => {
  expect(() => checkedScience(declarationFixture(), permit)).toThrow();
});
it.each([{ permitId: ids.team }, { expectedVersion: 8 }, { contentVersion: 7 }, { contentHash: 'x' }, { canonicalContent: '{}' },
  { declarations: scienceFixture().declarations.map(d => ({ ...d, templateId: ids.team })) }])('recusa ciência incompatível: %j', change => {
  expect(() => checkedScience({ ...scienceFixture(), ...change }, permit)).toThrow();
});
it.each(['TeamId', 'ResponsibleId', 'LocationId', 'Version', 'Participants', 'Services', 'Until'])('confere o campo canônico %s', field => {
  const item = scienceFixture(), [prefix, ...rest] = item.canonicalContent.split('\n\n'), data = JSON.parse(prefix);
  data[field] = field === 'Version' ? 100 : field === 'Participants' || field === 'Services' ? [] : field === 'Until' ? '2027-01-01T00:00:00Z' : ids.team === data[field] ? ids.unit : ids.team;
  expect(() => checkedScience({ ...item, canonicalContent: JSON.stringify(data) + '\n\n' + rest.join('\n\n') }, permit)).toThrow();
});
it('o recibo comprova participante, coletor, nome e o texto realmente apresentado', () => {
  const statement = scienceFixture(), receipt = scienceParticipantFixture();
  expect(checkedScienceParticipant(receipt, permit, ids.user, 'Pessoa da operação', statement.canonicalContent).userId).toBe(ids.user);
  expect(() => checkedScienceParticipant(receipt, permit, ids.user, 'Outro nome', statement.canonicalContent)).toThrow();
  expect(() => checkedScienceParticipant(receipt, permit, ids.user, 'Pessoa da operação', 'Texto aproximado')).toThrow();
});

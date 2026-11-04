import { describe, expect, it } from 'vitest';
import { checkedDeclarations, checkedEligibility, checkedPermit, checkedPermitHistory, checkedPermits, permitCriteria, permitQuery, permitReturn } from './contracts';
import { permitActionAllowed } from './NativePermitAction';
import { declarationFixture, historyFixture, permitFixture, permitIds as ids } from '../../../tests/connection-ui/fixtures/native-permits';

const criteria = permitCriteria(new URLSearchParams())!;
describe('contratos nativos das PTs', () => {
  it('preserva estados portugueses, versão de conteúdo e usuário participante sem converter Worker.Id', () => {
    const item = checkedPermit(permitFixture(), ids.permit);
    expect(item.status).toBe('EM_VERIFICACAO'); expect(item.version).toBe(4); expect(item.contentVersion).toBe(3);
    expect(item.participants[0].userId).toBe(ids.user); expect(item.participants[0].userId).not.toBe(ids.worker);
    expect(() => checkedPermit({ ...item, status: 'VERIFICATION' })).toThrow();
    expect(() => checkedPermit(item, ids.team)).toThrow();
  });
  it.each([
    { version: 0 }, { contentVersion: 0 }, { authorizedFrom: '2026-10-31T12:00:00Z', authorizedUntil: null },
    { createdAt: 'ontem' }, { participants: [...permitFixture().participants, ...permitFixture().participants] },
    { checklistAnswers: [{ perguntaId: ids.event, valor: true, justificativa: null }] },
  ])('recusa uma PT inconsistente: %j', patch => expect(() => checkedPermit({ ...permitFixture(), ...patch })).toThrow());
  it('respeita paginação real e filtros de atividade/serviço/participante', () => {
    const page = { items: [permitFixture()], total: 1, page: 1, pageSize: 20 };
    expect(checkedPermits(page, { ...criteria, q: 'altura', status: 'EM_VERIFICACAO', serviceCode: 'ALTURA', participantUserId: ids.user }).total).toBe(1);
    for (const patch of [{ page: 2 }, { q: 'outra atividade' }, { serviceCode: 'ALT' }, { status: 'LIBERADA' }, { companyId: ids.otherCompany }, { participantUserId: ids.worker }]) expect(() => checkedPermits(page, { ...criteria, ...patch })).toThrow();
    expect(() => checkedPermits({ ...page, items: [...page.items, ...page.items] }, criteria)).toThrow();
  });
  it('envia locationId e período de sobreposição do agendamento, incluindo o dia final', () => {
    const selected = permitCriteria(new URLSearchParams(`locationId=${ids.unit}&from=2026-10-30&to=2026-10-31&serviceCode=altura`))!;
    expect(permitQuery(selected)).toMatchObject({ locationId: ids.unit, serviceCode: 'ALTURA', from: '2026-10-30T00:00:00Z', to: '2026-11-01T00:00:00.000Z', pageSize: 20 });
    // The response has no appointment dates/local; do not make up a CreatedAt comparison.
    expect(checkedPermits({ items: [permitFixture()], total: 1, page: 1, pageSize: 20 }, selected).items).toHaveLength(1);
  });
  it.each(['page=0', 'page=107374183', 'q=x&q=y', 'unitId=unidade', 'status=RELEASED', 'from=2026-02-30', 'to=9999-12-31', 'from=2026-11-02&to=2026-11-01', 'serviceCode=A,B', 'companyId=../../'])('recusa filtro inválido antes do HTTP: %s', query => expect(permitCriteria(new URLSearchParams(query))).toBeUndefined());
  it('recusa retorno externo e preserva consulta válida', () => {
    expect(permitReturn('/app/pts?status=LIBERADA&page=2')).toBe('/app/pts?status=LIBERADA&page=2');
    for (const value of ['https://evil.invalid/app/pts', '//evil.invalid/app/pts', '/app/pts?q=x&q=y', '/app/pts#externo', '/app/agenda']) expect(permitReturn(value)).toBe('/app/pts');
  });
  it('confere declarações por PT, versões, modelos fixados e agendamento', () => {
    const item = permitFixture(), declaration = declarationFixture(item);
    expect(checkedDeclarations(declaration, item).context?.participantIds).toEqual([ids.worker]);
    for (const patch of [{ permitId: ids.team }, { expectedVersion: 5 }, { contentVersion: 4 }, { declarations: [] }, { declarations: [...declaration.declarations, ...declaration.declarations] }, { context: { ...declaration.context, appointmentId: ids.team } }]) expect(() => checkedDeclarations({ ...declaration, ...patch }, item)).toThrow();
  });
  it('não aceita conformidade contraditória nem histórico de uma versão futura', () => {
    expect(checkedEligibility({ ready: false, issues: [{ code: 'CIENCIA_PENDENTE', participantUserId: ids.user, documentTypeId: null, serviceCode: null }] }).ready).toBe(false);
    expect(() => checkedEligibility({ ready: true, issues: [{ code: 'CIENCIA_PENDENTE', participantUserId: ids.user, documentTypeId: null, serviceCode: null }] })).toThrow();
    expect(() => checkedEligibility({ ready: false, issues: [] })).toThrow();
    expect(() => checkedPermitHistory([{ ...historyFixture()[0], version: 5 }], permitFixture())).toThrow();
    expect(checkedPermitHistory(historyFixture(), permitFixture())).toHaveLength(1);
  });
  it('um nome de perfil não concede comandos; cada ação requer permissão e estado próprios', () => {
    const item = permitFixture();
    expect(permitActionAllowed(item, 'release', () => false)).toBe(false);
    expect(permitActionAllowed(item, 'release', permission => permission === 'pt:liberar')).toBe(true);
    expect(permitActionAllowed(item, 'start', () => true)).toBe(false);
    expect(permitActionAllowed({ ...item, status: 'EM_EXECUCAO' }, 'cancel', () => true)).toBe(false);
    expect(permitActionAllowed({ ...item, status: 'SUSPENSA' }, 'resume', permission => permission === 'pt:iniciar')).toBe(true);
  });
});

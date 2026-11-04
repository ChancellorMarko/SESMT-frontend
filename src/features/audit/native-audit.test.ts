import { describe, expect, it } from 'vitest';
import { checkedNativeAudit, nativeAuditCriteria, nativeAuditQuery } from './native-audit';

const criteria = { page: 1, action: '', resourceType: '', from: '', to: '' };
const event = { id: '10000000-0000-4000-8000-000000000001', atorId: null, declaranteId: null, empresaId: null, acao: 'UPDATE', recursoTipo: 'documento', recursoId: null, versao: null, momento: '2026-10-31T23:30:00-03:00', resultado: null, traceId: null };
const response = { items: [event], total: 1, page: 1, pageSize: 20 };
describe('contrato nativo de auditoria', () => {
  it('preserva os campos nulos e usa a paginação real sem filtro fictício de unidade', () => {
    expect(checkedNativeAudit(response, criteria)).toEqual(response);
    expect(nativeAuditQuery(criteria)).toEqual({ pageNumber: 1, pageSize: 20, action: undefined, resourceType: undefined, from: undefined, to: undefined });
  });
  it('confere o dia UTC e os filtros também na resposta', () => {
    expect(checkedNativeAudit(response, { ...criteria, from: '2026-11-01', action: 'UPDATE' }).items).toHaveLength(1);
    for (const mismatch of [{ action: 'CREATE' }, { resourceType: 'usuario' }, { to: '2026-10-31' }, { page: 2 }]) expect(() => checkedNativeAudit(response, { ...criteria, ...mismatch })).toThrow();
    expect(() => checkedNativeAudit({ ...response, items: [event, event], total: 2 }, criteria)).toThrow();
  });
  it.each(['page=0', 'page=1&page=2', 'page=2147483648', 'from=2026-02-30', 'from=0000-01-01', 'from=2026-11-01&to=2026-10-31', 'action=update', 'resourceType=Documento'])('recusa filtro inválido antes da requisição: %s', query => {
    expect(nativeAuditCriteria(new URLSearchParams(query))).toBeUndefined();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { checkedNativeDashboard, defaultNativeDashboardPeriod, nativeDashboardCriteria, nativeDashboardQuery, requestNativeDashboard } from './native-dashboard';
import { api, ApiError } from '../../shared/api/client';
import { dashboardOtherUnit, dashboardUnit, nativeDashboardFixture } from '../../../tests/connection-ui/fixtures/native-dashboard';

vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn() } }));
const period = { from: '2026-01-01', to: '2026-12-31' }, criteria = { ...period, scope: 'account' as const };
function fixture() { const query = nativeDashboardQuery(criteria); return nativeDashboardFixture(query.from, query.to); }

describe('dashboard nativo publicado', () => {
  it('define doze meses civis em UTC, inclusive na virada do ano e em fevereiro bissexto', () => {
    expect(defaultNativeDashboardPeriod(new Date('2026-10-31T23:59:59Z'))).toEqual({ from: '2025-11-01', to: '2026-10-31' });
    expect(defaultNativeDashboardPeriod(new Date('2024-02-01T00:00:00Z'))).toEqual({ from: '2023-03-01', to: '2024-02-29' });
  });
  it('separa abrangência da conta do local que corresponde à unidade selecionada', () => {
    expect(nativeDashboardCriteria(new URLSearchParams(), period, dashboardUnit)).toEqual({ ...criteria, localId: undefined });
    const selected = nativeDashboardCriteria(new URLSearchParams({ scope: 'unit' }), period, dashboardUnit)!;
    expect(nativeDashboardQuery(selected)).toEqual({ from: '2026-01-01T03:00:00.000Z', to: '2027-01-01T02:59:59.999Z', localId: dashboardUnit });
  });
  it.each(['from=2026-01-01', 'from=2026-01-01&to=2026-12-31&from=2026-02-01', 'from=2026-02-30&to=2026-12-31', 'from=0000-01-01&to=0000-12-31', 'from=2026-02-02&to=2026-02-01', 'from=2023-01-01&to=2026-01-01', 'scope=other', 'scope=unit', 'area=saude', 'unitId=unidade', 'teamId=equipe'])('não consulta com critérios inválidos ou sem unidade: %s', query => {
    expect(nativeDashboardCriteria(new URLSearchParams(query), period)).toBeUndefined();
  });
  it('aceita o limite de 36 meses, mas recusa o 37º mês', () => {
    expect(nativeDashboardCriteria(new URLSearchParams({ from: '2024-01-31', to: '2026-12-01' }), period)).toBeDefined();
    expect(nativeDashboardCriteria(new URLSearchParams({ from: '2024-01-31', to: '2027-01-01' }), period)).toBeUndefined();
  });
  it('consome DTOs nativos e não exige igualdade entre leituras de momentos distintos', () => {
    const data = fixture(); data.summary.liberadas = 30;
    expect(checkedNativeDashboard(data, criteria).summary.liberadas).toBe(30);
    expect(checkedNativeDashboard({ ...data, secret: 'private' }, criteria)).not.toHaveProperty('secret');
  });
  it.each([
    (data: ReturnType<typeof fixture>) => { data.summary.emExecucao = -1; },
    data => { data.summary.periodo.to = '2026-12-30T23:59:59Z'; },
    data => { data.appointments[0].startsAt = '2025-12-31T23:59:59Z'; },
    data => { data.appointments[0].endsAt = '2025-01-01T00:00:00Z'; },
    data => { data.appointments.push(data.appointments[0]); },
    data => { data.documents[0].pendingRequirements = 0; },
    data => { data.documents[0].occurredAt = '2026-02-30T10:00:00Z'; },
    data => { data.reviews[0].completedAt = null; },
    data => { data.reviews[0].version = 0; },
    data => { data.evolution.series.pop(); },
    data => { data.evolution.series[1].mes = data.evolution.series[0].mes; },
    data => { data.evolution.series[0].concluidas = Number.NaN; },
    data => { data.evolution.periodo.from = '2025-01'; },
  ])('recusa dados incorretos sem convertê-los em zeros ou registros utilizáveis (%#)', mutate => {
    const data = fixture(); mutate(data); expect(() => checkedNativeDashboard(data, criteria)).toThrow();
  });
  it('recusa uma linha de outra unidade mesmo que o restante do painel seja válido', () => {
    const data = fixture(); data.documents[0].localId = dashboardOtherUnit;
    expect(() => checkedNativeDashboard(data, { ...criteria, scope: 'unit', localId: dashboardUnit })).toThrow();
  });
  it('usa somente os cinco caminhos publicados e os mesmos critérios, cancelando os demais se um falhar', async () => {
    vi.mocked(api.get).mockReset();
    const failure = new ApiError(403, { code: 'FORBIDDEN', message: 'privado', requestId: 'test' });
    vi.mocked(api.get).mockRejectedValueOnce(failure).mockResolvedValue(undefined);
    await expect(requestNativeDashboard(criteria, new AbortController().signal)).rejects.toBe(failure);
    expect(vi.mocked(api.get).mock.calls.map(([path]) => path)).toEqual(['/dashboard/summary', '/dashboard/appointments', '/dashboard/document-pendencies', '/dashboard/review-pendencies', '/dashboard/activity-evolution']);
    for (const [, options] of vi.mocked(api.get).mock.calls) {
      expect(options?.query).toEqual(nativeDashboardQuery(criteria)); expect(options?.signal?.aborted).toBe(true);
    }
  });
});

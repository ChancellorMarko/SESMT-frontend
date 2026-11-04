import type { NativeDashboard } from '../../../src/features/dashboard/native-dashboard';

// Fictitious HTTP fixtures following the published native dashboard contract.
export const dashboardUnit = '20000000-0000-4000-8000-000000000001';
export const dashboardOtherUnit = '20000000-0000-4000-8000-000000000002';
export const dashboardCompany = '20000000-0000-4000-8000-000000000003';
export const dashboardPermit = '20000000-0000-4000-8000-000000000004';

export function emptyNativeDashboard(from: string, to: string): NativeDashboard {
  const first = from.slice(0, 7), last = to.slice(0, 7), start = new Date(`${first}-01T00:00:00Z`);
  const length = (Number(last.slice(0, 4)) - start.getUTCFullYear()) * 12 + Number(last.slice(5)) - start.getUTCMonth();
  return {
    summary: { emVerificacao: 0, liberadas: 0, emExecucao: 0, concluidasAguardandoRevisao: 0, pendenciasDocumentais: 0, periodo: { from, to } },
    appointments: [], documents: [], reviews: [],
    evolution: { periodo: { from: first, to: last }, series: Array.from({ length }, (_, index) => ({ mes: new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index, 1)).toISOString().slice(0, 7), concluidas: 0, emAndamento: 0, pendentes: 0 })) },
  };
}
export function nativeDashboardFixture(from: string, to: string): NativeDashboard {
  const data = emptyNativeDashboard(from, to), startsAt = `${from.slice(0, 10)}T10:00:00Z`, endsAt = `${from.slice(0, 10)}T11:00:00Z`;
  data.summary = { ...data.summary, emVerificacao: 2, liberadas: 2, emExecucao: 1, concluidasAguardandoRevisao: 1, pendenciasDocumentais: 3 };
  data.appointments = Array.from({ length: 6 }, (_, index) => ({ id: `30000000-0000-4000-8000-00000000000${index + 1}`, workPermitId: index === 5 ? null : index === 0 ? dashboardPermit : `40000000-0000-4000-8000-00000000000${index + 1}`, title: index === 0 ? 'Inspeção da caldeira' : `Atividade ${index + 1}`, companyId: dashboardCompany, localId: dashboardUnit, startsAt, endsAt,
    operationalStatus: (['LIBERADA', 'EM_EXECUCAO', 'EM_VERIFICACAO', 'LIBERADA', 'EM_VERIFICACAO', null] as const)[index], reviewStatus: null, serviceIds: [], teamIds: [] }));
  data.documents = [{ workPermitId: dashboardPermit, companyId: dashboardCompany, localId: dashboardUnit, operationalStatus: 'LIBERADA', pendingRequirements: 3, occurredAt: startsAt, serviceIds: [], teamIds: [] }];
  data.reviews = [{ workPermitId: dashboardPermit, companyId: dashboardCompany, localId: dashboardUnit, serviceCodes: ['TRABALHO_ALTURA'], version: 2, completedAt: endsAt, teamIds: [] }];
  data.evolution.series[0] = { ...data.evolution.series[0], concluidas: 1, emAndamento: 2, pendentes: 3 };
  return data;
}

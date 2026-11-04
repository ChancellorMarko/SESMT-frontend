import { useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { AlertTriangle, ShieldCheck, UserCheck } from 'lucide-react';
import { api } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { DesignationCoverageDto } from '../../shared/contracts/designations';
import { formatDate } from '../../shared/lib/format';
import { Badge, Feedback, Spinner } from '../../shared/ui';
import styles from './Designations.module.css';

export interface DesignationCoveragePanelProps {
  unitId: string;
  serviceTypeIds: string[];
  location?: string;
  atDate?: string;
  responsibleId?: string;
  title?: string;
  sectionId?: string;
}

export function DesignationCoveragePanel({
  unitId,
  serviceTypeIds,
  location = '',
  atDate,
  responsibleId,
  title = 'Cobertura por designações operacionais',
  sectionId,
}: DesignationCoveragePanelProps) {
  const { sessionKey, can } = useSession();
  const titleId = useId();
  const canRead = can('permits.read') || can('appointments.read');

  const query = useQuery({
    queryKey: ['designation-coverage', sessionKey, unitId, [...serviceTypeIds].sort().join(','), location, atDate, responsibleId],
    queryFn: ({ signal }) => api.get<DesignationCoverageDto>('/designation-coverage', {
      signal,
      query: {
        unitId,
        serviceTypeIds: serviceTypeIds.join(','),
        location,
        ...(atDate ? { atDate } : {}),
        ...(responsibleId ? { responsibleId } : {}),
      },
    }),
    enabled: Boolean(unitId) && serviceTypeIds.length > 0 && canRead,
  });

  if (!serviceTypeIds.length || !unitId || !canRead) return sectionId ? <section id={sectionId} className="panel stack" aria-labelledby={titleId}><h2 id={titleId}>{title}</h2><p className="muted">A cobertura não está disponível para consulta neste contexto.</p></section> : null;
  if (query.isPending) return <section id={sectionId} className="panel stack" aria-label="Carregando cobertura"><h2 id={titleId}>{title}</h2><Spinner /></section>;
  if (query.isError) {
    return (
      <section id={sectionId} className="panel stack" aria-label="Erro de cobertura">
        <h2 id={titleId}>{title}</h2>
        <Feedback tone="warning">
          Não foi possível verificar a cobertura de designações operacionais para este atendimento.
        </Feedback>
      </section>
    );
  }

  const coverage = query.data;
  if (!coverage || !Array.isArray(coverage.items)) return sectionId ? <section id={sectionId} className="panel stack" aria-labelledby={titleId}><h2 id={titleId}>{title}</h2><Feedback tone="warning">Não foi possível conferir a resposta de cobertura. Atualize a consulta antes de continuar.</Feedback></section> : null;
  if (coverage.unitId !== unitId) return <section id={sectionId} className="panel stack" aria-labelledby={titleId}><h2 id={titleId}>{title}</h2><Feedback tone="warning">A cobertura retornada pertence a outra unidade. Atualize a consulta antes de continuar.</Feedback></section>;

  return (
    <section id={sectionId} className="panel stack" aria-labelledby={titleId}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {coverage.fullyCovered ? (
            <ShieldCheck size={20} style={{ color: 'var(--color-success, #16a34a)' }} aria-hidden="true" />
          ) : (
            <AlertTriangle size={20} style={{ color: 'var(--color-danger, #dc2626)' }} aria-hidden="true" />
          )}
          <h2 id={titleId} style={{ margin: 0, fontSize: 16 }}>{title}</h2>
        </div>
        <Badge tone={coverage.fullyCovered ? 'success' : 'danger'}>
          {coverage.fullyCovered ? 'Cobertura completa' : 'Bloqueio de designação'}
        </Badge>
      </div>

      {!coverage.fullyCovered ? (
        <Feedback tone="danger">
          <strong>Operação bloqueada:</strong> Um ou mais serviços não possuem responsável operacional designado com vigência ativa para este local e período. Abertura, liberação, início e retomada exigem cobertura integral.
        </Feedback>
      ) : coverage.operationalWindowEnd ? (
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          Janela operacional vigente até <strong>{formatDate(coverage.operationalWindowEnd)}</strong>. Após esta data, novas ações operacionais serão bloqueadas automaticamente.
        </p>
      ) : null}

      <div className={styles.coverageGrid}>
        {coverage.items.map(item => (
          <div key={item.serviceTypeId} className={styles.coverageItem} data-covered={String(item.covered)}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <strong>{item.serviceName}</strong>
              {item.responsibleName ? (
                <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                  <UserCheck size={13} style={{ verticalAlign: 'text-bottom', marginRight: 4 }} aria-hidden="true" />
                  {item.responsibleName}
                  {item.validFrom && item.validUntil && (
                    <span> · Vigência: {formatDate(item.validFrom)} a {formatDate(item.validUntil)}</span>
                  )}
                </p>
              ) : (
                <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                  Nenhum responsável com designação ativa encontrada para esta unidade e local.
                </p>
              )}
            </div>
            <div className={styles.coverageMeta}>
              <Badge tone={item.covered ? 'success' : item.expired ? 'warning' : 'danger'}>
                {item.covered ? 'Coberto' : item.expired ? 'Expirada' : item.revoked ? 'Revogada' : 'Sem designação'}
              </Badge>
            </div>
          </div>
        ))}
      </div>

      {can('appointments.read') && <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
        <Link to="/app/designacoes" className="button button--ghost">
          Consultar todas as designações →
        </Link>
      </div>}
    </section>
  );
}

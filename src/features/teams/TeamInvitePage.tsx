import { useParams, Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Users, ShieldCheck, Clock, MapPin, Building, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import { api } from '../../shared/api/client';
import type { PublicTeamInviteDto } from '../../shared/contracts/teams';
import { Badge, Button, EmptyState, Feedback, PageHeader, Spinner } from '../../shared/ui';
import { formatDate } from '../../shared/lib/format';
import { BrandLogo } from '../../shared/brand/BrandLogo';

export function TeamInvitePage() {
  const { token } = useParams<{ token: string }>();

  const inviteQuery = useQuery({
    queryKey: ['public-team-invite', token],
    queryFn: ({ signal }) =>
      api.get<PublicTeamInviteDto>(`/team-invites/public/${token}`, { signal }),
    enabled: Boolean(token),
    retry: false,
  });

  if (inviteQuery.isPending) {
    return (
      <div style={{ maxWidth: 640, margin: '3rem auto', padding: '1.5rem', textAlign: 'center' }}>
        <Spinner />
        <p className="muted" style={{ marginTop: '1rem' }}>Carregando dados do convite de equipe…</p>
      </div>
    );
  }

  if (inviteQuery.isError || !inviteQuery.data) {
    return (
      <main style={{ maxWidth: 640, margin: '3rem auto', padding: '1.5rem' }} className="stack">
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.5rem' }}>
          <BrandLogo />
        </div>
        <div className="panel stack">
          <EmptyState
            title="Convite inválido ou não encontrado"
            description="O link informado não corresponde a nenhum convite ativo ou expirou. Verifique se o endereço foi copiado por completo ou solicite um novo convite ao gestor da sua equipe."
          />
          <div style={{ textAlign: 'center', marginTop: '1rem' }}>
            <Link to="/login" className="button button--secondary">
              Acessar plataforma Ampara
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const data = inviteQuery.data;
  const isExpired = data.status === 'EXPIRED';
  const isRevoked = data.status === 'REVOKED';
  const isActive = data.status === 'ACTIVE';

  return (
    <main style={{ maxWidth: 680, margin: '2rem auto', padding: '1.5rem' }} className="stack">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <BrandLogo />
        <Link to="/login" className="button button--ghost" style={{ fontSize: '0.85rem' }}>
          Entrar com conta
        </Link>
      </div>

      <PageHeader
        eyebrow="ACESSO LIMITADO · CONVITE DE EQUIPE"
        title={data.teamName}
        description={`Visualização autorizada da composição e orientações para a equipe operacional.`}
      />

      {isRevoked && (
        <Feedback tone="danger">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <XCircle size={18} aria-hidden="true" />
            <strong>Este convite foi revogado pela administração e não é mais válido para acesso em campo.</strong>
          </div>
        </Feedback>
      )}

      {isExpired && (
        <Feedback tone="warning">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <AlertTriangle size={18} aria-hidden="true" />
            <strong>A validade deste convite expirou em {formatDate(data.expiresAt)}.</strong> Solicite ao líder da equipe a geração de um novo link atualizado.
          </div>
        </Feedback>
      )}

      {isActive && (
        <Feedback tone="info">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <CheckCircle size={18} aria-hidden="true" />
            <span>Convite ativo. Apresente este comprovante ou consulte a escala antes do início da jornada.</span>
          </div>
        </Feedback>
      )}

      {/* Card da equipe */}
      <section className="panel stack" aria-labelledby="team-info-heading">
        <div className="toolbar" style={{ borderBottom: '1px solid var(--color-border, #e5e7eb)', paddingBottom: '0.75rem' }}>
          <h2 id="team-info-heading" style={{ margin: 0, fontSize: '1.15rem' }}>
            <Users size={18} style={{ verticalAlign: 'middle', marginRight: '0.5rem' }} aria-hidden="true" />
            Identificação e local
          </h2>
          <Badge tone={isActive ? 'success' : isExpired ? 'warning' : 'danger'}>
            {isActive ? 'Convite válido' : isExpired ? 'Expirado' : 'Revogado'}
          </Badge>
        </div>

        <dl className="form-grid">
          <div>
            <dt className="muted">Empresa</dt>
            <dd><strong>{data.companyName}</strong></dd>
          </div>
          <div>
            <dt className="muted">Unidade de trabalho</dt>
            <dd>{data.unitName}</dd>
          </div>
          <div>
            <dt className="muted">Chefe da equipe</dt>
            <dd>{data.chiefName}</dd>
          </div>
          <div>
            <dt className="muted">Validade do convite</dt>
            <dd>
              <Clock size={14} style={{ verticalAlign: 'middle', marginRight: '0.25rem' }} aria-hidden="true" />
              {formatDate(data.expiresAt)}
            </dd>
          </div>
        </dl>
      </section>

      {/* Participantes */}
      <section className="panel stack" aria-labelledby="team-members-heading">
        <h2 id="team-members-heading" style={{ margin: 0, fontSize: '1.15rem' }}>
          Participantes vinculados ({data.members.length})
        </h2>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Função operacional</th>
                <th>Papel</th>
              </tr>
            </thead>
            <tbody>
              {data.members.map((member, idx) => (
                <tr key={idx}>
                  <td><strong>{member.name}</strong></td>
                  <td>{member.serviceFunction}</td>
                  <td>
                    {member.isChief ? (
                      <Badge tone="info">Chefe da equipe</Badge>
                    ) : (
                      <span className="muted">Participante</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Orientações operacionais de SST */}
      <section className="panel stack" aria-labelledby="instructions-heading">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <ShieldCheck size={20} color="var(--color-primary, #0284c7)" aria-hidden="true" />
          <h2 id="instructions-heading" style={{ margin: 0, fontSize: '1.15rem' }}>
            Instruções operacionais de segurança
          </h2>
        </div>
        <p style={{ lineHeight: 1.6 }}>{data.operationalInstructions}</p>
        <div className="muted" style={{ fontSize: '0.85rem' }}>
          Nota: O acesso a esta visualização é exclusivo para conferência de equipe e orientações de campo. A liberação de execução e emissão de PTs exige login de responsável autorizado.
        </div>
      </section>
    </main>
  );
}

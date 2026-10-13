import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useParams } from 'react-router';
import { api, revisionEtag } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { DesignationDto } from '../../shared/contracts/designations';
import { formatDate } from '../../shared/lib/format';
import { Badge, Button, EmptyState, Feedback, Field, Modal, PageHeader, Spinner, type Tone } from '../../shared/ui';
import styles from './Designations.module.css';

const statusLabels: Record<string, string> = { ACTIVE: 'Vigente', REVOKED: 'Revogada', EXPIRED: 'Expirada' };
const statusTones: Record<string, Tone> = { ACTIVE: 'success', REVOKED: 'danger', EXPIRED: 'warning' };

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Erro inesperado. Tente novamente.';
}

export function DesignationDetailPage() {
  const { id } = useParams();
  const { sessionKey, unitId, can } = useSession();
  const location = useLocation();
  const client = useQueryClient();
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [revokeReason, setRevokeReason] = useState('');
  const [revokeError, setRevokeError] = useState('');
  const success = (location.state as { success?: string } | null)?.success;

  const query = useQuery({
    queryKey: ['designation', sessionKey, unitId, id],
    queryFn: ({ signal }) => api.get<DesignationDto>(`/designations/${id}`, { signal }),
    enabled: Boolean(id) && can('appointments.read'),
  });

  const revokeMutation = useMutation({
    mutationFn: async () => {
      if (!query.data) throw new Error('Recarregue a designação.');
      return api.post<DesignationDto>(`/designations/${id}/revoke`, { reason: revokeReason.trim() }, { etag: revisionEtag(query.data.revision) });
    },
    onSuccess: async (updated) => {
      client.setQueryData(['designation', sessionKey, unitId, id], updated);
      await client.invalidateQueries({ queryKey: ['designations'] });
      setRevokeOpen(false); setRevokeReason(''); setRevokeError('');
    },
    onError: (error) => setRevokeError(errorMessage(error)),
  });

  if (!can('appointments.read')) return <EmptyState title="Acesso restrito" />;
  if (query.isPending) return <Spinner />;
  if (query.isError) return <div className="panel stack"><Feedback tone="danger">Designação não encontrada ou indisponível.</Feedback><Link className="button button--secondary" to="/app/designacoes">Voltar</Link></div>;

  const d = query.data!;
  const canRevoke = can('appointments.write') && d.status === 'ACTIVE';

  return <div className="stack">
    <PageHeader
      eyebrow="OPERAÇÃO"
      title={d.responsibleName}
      description={`Designação operacional · ${d.locationPattern || 'Qualquer local'}`}
      actions={<div className="actions">
        {canRevoke && <Button variant="danger" onClick={() => { setRevokeOpen(true); setRevokeError(''); setRevokeReason(''); }}>Revogar designação</Button>}
        <Link className="button button--secondary" to="/app/designacoes">Voltar</Link>
      </div>}
    />

    {success && <Feedback tone="success">{success}</Feedback>}

    <div className={styles.detailColumns}>
      <div className="stack">
        <div className="panel stack">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <h2 style={{ margin: 0 }}>Informações da designação</h2>
            <Badge tone={statusTones[d.status] || 'neutral'}>{statusLabels[d.status] || d.status}</Badge>
          </div>
          <dl className={styles.metadata}>
            <div><dt>Responsável</dt><dd>{d.responsibleName}</dd></div>
            <div><dt>Unidade</dt><dd>{d.unitId}</dd></div>
            <div><dt>Local / alcance</dt><dd>{d.locationPattern || 'Qualquer local (sem restrição)'}</dd></div>
            <div><dt>Vigência</dt><dd>{formatDate(d.validFrom)} a {formatDate(d.validUntil)}</dd></div>
            <div><dt>Criada por</dt><dd>{d.createdByName} em {formatDate(d.createdAt)}</dd></div>
            {d.revokedAt && <div><dt>Revogada por</dt><dd>{d.revokedByName} em {formatDate(d.revokedAt)}</dd></div>}
            {d.revocationReason && <div><dt>Motivo da revogação</dt><dd>{d.revocationReason}</dd></div>}
          </dl>
          {d.notes && <><h3>Observações</h3><p style={{ fontSize: 13 }}>{d.notes}</p></>}
        </div>

        <div className="panel stack">
          <h2 style={{ margin: 0 }}>Serviços cobertos</h2>
          <div className={styles.serviceList}>
            {d.serviceNames.map((name, i) => <Badge key={i} tone="neutral">{name}</Badge>)}
          </div>
          <p className={`${styles.legend}`}>A PT exige cobertura vigente de todos os serviços do agendamento. Serviços sem designação ativa bloqueiam a liberação.</p>
        </div>
      </div>

      <div className="panel stack">
        <h2 style={{ margin: 0 }}>Histórico</h2>
        {d.history.length === 0 && <p className="muted" style={{ fontSize: 13 }}>Nenhum evento registrado.</p>}
        <ul className={styles.history}>
          {d.history.map(event => (
            <li key={event.id}>
              <strong>{eventLabel(event.action)}</strong>
              <p className="muted">{event.actorName}</p>
              {event.reason && <p>{event.reason}</p>}
              <small>{formatDate(event.occurredAt)}</small>
            </li>
          ))}
        </ul>
      </div>
    </div>

    <Modal open={revokeOpen} title="Revogar designação" onClose={() => setRevokeOpen(false)}>
      <form className="stack" onSubmit={e => { e.preventDefault(); if (revokeReason.trim().length >= 5) revokeMutation.mutate(); else setRevokeError('Informe um motivo com ao menos 5 caracteres.'); }}>
        {revokeError && <Feedback tone="danger">{revokeError}</Feedback>}
        <p>A revogação bloqueia imediatamente operações que exigem a cobertura deste responsável para os serviços designados.</p>
        <Field label="Motivo da revogação *" error={revokeError && revokeReason.trim().length < 5 ? 'Mínimo de 5 caracteres.' : ''}>
          <textarea rows={3} value={revokeReason} onChange={e => setRevokeReason(e.target.value)} placeholder="Explique o motivo da revogação." />
        </Field>
        <div className="actions">
          <Button variant="danger" type="submit" disabled={revokeMutation.isPending}>
            {revokeMutation.isPending ? 'Revogando…' : 'Confirmar revogação'}
          </Button>
          <Button variant="secondary" onClick={() => setRevokeOpen(false)} disabled={revokeMutation.isPending}>Cancelar</Button>
        </div>
      </form>
    </Modal>
  </div>;
}

function eventLabel(action: string): string {
  const labels: Record<string, string> = {
    DESIGNATION_CREATED: 'Designação criada',
    DESIGNATION_UPDATED: 'Designação alterada',
    DESIGNATION_REVOKED: 'Designação revogada',
  };
  return labels[action] || action;
}

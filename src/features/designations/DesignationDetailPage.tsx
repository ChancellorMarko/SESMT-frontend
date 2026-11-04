import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useParams } from 'react-router';
import { api, revisionEtag } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { DesignationDto } from '../../shared/contracts/designations';
import { formatDate } from '../../shared/lib/format';
import { Badge, Button, EmptyState, Feedback, Field, Modal, PageHeader, Spinner, type Tone } from '../../shared/ui';
import styles from './Designations.module.css';
import { UnsavedChanges } from '../workers/UnsavedChanges';

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
  const [intentRevision, setIntentRevision] = useState<number>();
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    setRevokeOpen(false); setRevokeReason(''); setRevokeError(''); setIntentRevision(undefined);
    return () => { request.current?.abort(); request.current = null; };
  }, [id, sessionKey, unitId]);
  const success = (location.state as { success?: string } | null)?.success;

  const query = useQuery({
    queryKey: ['designation', sessionKey, unitId, id],
    queryFn: ({ signal }) => api.get<DesignationDto>(`/designations/${id}`, { signal }),
    enabled: Boolean(id && unitId) && can('appointments.read'),
  });

  const revokeMutation = useMutation({
    mutationFn: async () => {
      if (!query.data || query.data.unitId !== unitId || !can('appointments.write')) throw new Error('Recarregue a designação na unidade autorizada.');
      if (intentRevision !== query.data.revision || query.data.status !== 'ACTIVE') throw new Error('A designação foi atualizada. Feche a janela e confira a versão atual.');
      const controller = new AbortController(); request.current = controller;
      try {
        const updated = await api.post<DesignationDto>(`/designations/${id}/revoke`, { reason: revokeReason.trim() }, { etag: revisionEtag(intentRevision), signal: controller.signal });
        if (controller.signal.aborted) throw new DOMException('Contexto alterado.', 'AbortError');
        if (updated.id !== id || updated.unitId !== unitId) throw new Error('A resposta não corresponde à designação desta unidade. Confira o registro antes de tentar novamente.');
        return updated;
      } finally { if (request.current === controller) request.current = null; }
    },
    onSuccess: async (updated) => {
      client.setQueryData(['designation', sessionKey, unitId, id], updated);
      void Promise.all(['designations', 'designation-coverage', 'work-permit', 'appointments'].map(key => client.invalidateQueries({ queryKey: [key] })));
      setRevokeOpen(false); setRevokeReason(''); setRevokeError('');
    },
    onError: (error) => { if (!(error instanceof DOMException && error.name === 'AbortError')) setRevokeError(errorMessage(error)); },
  });

  if (!can('appointments.read')) return <EmptyState title="Acesso restrito" />;
  if (!unitId) return <EmptyState title="Selecione uma unidade" />;
  if (query.isPending) return <Spinner />;
  if (query.isError) return <div className="panel stack"><Feedback tone="danger">Designação não encontrada ou indisponível.</Feedback><Link className="button button--secondary" to="/app/designacoes">Voltar</Link></div>;

  const d = query.data!;
  if (!d || d.unitId !== unitId) return <EmptyState title="Designação de outra unidade" description="Selecione a unidade correspondente para consultar este registro." />;
  const canRevoke = can('appointments.write') && d.status === 'ACTIVE';
  const staleIntent = revokeOpen && (intentRevision !== d.revision || d.status !== 'ACTIVE');
  const close = () => { if (!revokeMutation.isPending) { setRevokeOpen(false); setIntentRevision(undefined); } };

  return <div className="stack">
    <UnsavedChanges dirty={revokeOpen} busy={revokeMutation.isPending} protectContext />
    <PageHeader
      eyebrow="OPERAÇÃO"
      title={d.responsibleName}
      description={`Designação operacional · ${d.locationPattern || 'Qualquer local'}`}
      actions={<div className="actions">
        {canRevoke && <Button variant="danger" disabled={revokeMutation.isPending} onClick={() => { setRevokeOpen(true); setIntentRevision(d.revision); setRevokeError(''); setRevokeReason(''); revokeMutation.reset(); }}>Revogar designação</Button>}
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

    <Modal open={revokeOpen} title="Revogar designação" onClose={close}>
      <form className="stack" onSubmit={e => { e.preventDefault(); if (revokeMutation.isPending || request.current || staleIntent) return; if (revokeReason.trim().length >= 5 && revokeReason.trim().length <= 2000) revokeMutation.mutate(); else setRevokeError('Informe um motivo entre 5 e 2.000 caracteres.'); }}>
        {revokeError && <Feedback tone="danger">{revokeError}</Feedback>}
        {staleIntent && <Feedback tone="warning">A designação foi atualizada enquanto esta janela estava aberta. Feche a janela, confira o registro atual e abra a revogação novamente.</Feedback>}
        <p>A revogação bloqueia imediatamente operações que exigem a cobertura deste responsável para os serviços designados.</p>
        <Field label="Motivo da revogação *" error={revokeError && revokeReason.trim().length < 5 ? 'Mínimo de 5 caracteres.' : ''}>
          <textarea rows={3} maxLength={2000} disabled={revokeMutation.isPending || staleIntent} value={revokeReason} onChange={e => setRevokeReason(e.target.value)} placeholder="Explique o motivo da revogação." />
        </Field>
        <div className="actions">
          <Button variant="danger" type="submit" disabled={revokeMutation.isPending || staleIntent || !canRevoke}>
            {revokeMutation.isPending ? 'Revogando…' : 'Confirmar revogação'}
          </Button>
          <Button variant="secondary" onClick={close} disabled={revokeMutation.isPending}>Cancelar</Button>
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

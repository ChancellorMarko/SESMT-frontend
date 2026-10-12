import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LockKeyhole, ShieldCheck } from 'lucide-react';
import { api, revisionEtag } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { AppointmentDto, EligibilityDto, EligibilityItemDto, EvidenceDto, ParticipantEligibilityDto } from '../../shared/contracts/work-permits';
import { formatDate } from '../../shared/lib/format';
import { Badge, Button, EmptyState, Feedback, Field, Modal, Spinner } from '../../shared/ui';
import { evidenceDatesError, evidenceDownloadAllowed, evidenceFileError, evidenceLabels, errorMessage } from './support';
import styles from './Agenda.module.css';

type Selection = { person: ParticipantEligibilityDto; item: EligibilityItemDto; action: 'UPLOAD' | 'REVIEW'; appointmentRevision?: number };

export function EligibilityPanel({ appointmentId, readOnly = false }: { appointmentId: string; readOnly?: boolean }) {
  const { sessionKey, unitId, can } = useSession();
  const client = useQueryClient();
  const [selected, setSelected] = useState<Selection>();
  const [file, setFile] = useState<File>();
  const [validFrom, setValidFrom] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [reason, setReason] = useState('');
  const [decision, setDecision] = useState<'APPROVE' | 'REJECT'>('APPROVE');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [success, setSuccess] = useState('');
  const [download, setDownload] = useState<{ url: string; fileName: string; expiresAt: string }>();
  const [loadingDownload, setLoadingDownload] = useState(false);
  const appointment = useQuery({ queryKey: ['appointment', sessionKey, unitId, appointmentId], queryFn: ({ signal }) => api.get<AppointmentDto>(`/appointments/${appointmentId}`, { signal }), enabled: can('eligibility.write') && !readOnly && Boolean(unitId && appointmentId) });
  const eligibility = useQuery({
    queryKey: ['eligibility', sessionKey, unitId, appointmentId],
    queryFn: ({ signal }) => api.get<EligibilityDto>(`/appointments/${appointmentId}/eligibility`, { signal }),
    enabled: can('eligibility.read') && Boolean(unitId && appointmentId),
  });
  const outsideContext = Boolean(eligibility.data && (eligibility.data.appointmentId !== appointmentId || eligibility.data.unitId && eligibility.data.unitId !== unitId));
  const pending = busy || loadingDownload;
  useEffect(() => {
    setSelected(undefined); setFile(undefined); setDownload(undefined); setFailure(''); setSuccess('');
  }, [appointmentId, sessionKey, unitId]);
  useEffect(() => {
    if (!selected && !pending) return;
    const allowLeave = () => {
      if (pending) { setFailure('Aguarde a conclusão da ação antes de sair ou mudar de unidade.'); return false; }
      return window.confirm('Há uma conferência documental ainda não enviada. Deseja sair e descartar o preenchimento?');
    };
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const contextChange = (event: Event) => { if (!event.defaultPrevented && !allowLeave()) event.preventDefault(); };
    const navigate = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      const destination = new URL(anchor.href, window.location.href);
      if (destination.pathname === window.location.pathname && destination.search === window.location.search) return;
      if (!allowLeave()) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener('beforeunload', beforeUnload); window.addEventListener('sesmt:before-context-change', contextChange); document.addEventListener('click', navigate, true);
    return () => { window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('sesmt:before-context-change', contextChange); document.removeEventListener('click', navigate, true); };
  }, [selected, pending]);
  function select(value: Selection) {
    if (readOnly || pending || outsideContext || !can(value.action === 'UPLOAD' ? 'eligibility.write' : 'eligibility.review')) return;
    if (value.action === 'UPLOAD' && (!appointment.data || appointment.data.unitId !== unitId || appointment.isError)) return;
    setSelected({ ...value, appointmentRevision: value.action === 'UPLOAD' ? appointment.data!.revision : undefined });
    setFile(undefined); setValidFrom(''); setValidUntil(''); setReason(''); setDecision('APPROVE'); setConfirmed(false); setFailure(''); setDownload(undefined);
  }
  function close() { if (!busy && !loadingDownload) setSelected(undefined); }
  async function prepareDownload() {
    if (!selected?.item.evidenceId || selected.item.restricted || loadingDownload) return;
    setLoadingDownload(true); setFailure('');
    try {
      const result = await api.get<{ url: string; fileName: string; expiresAt: string }>(`/evidence/${selected.item.evidenceId}/download`);
      if (!evidenceDownloadAllowed(result.url) || !Number.isFinite(Date.parse(result.expiresAt)) || Date.parse(result.expiresAt) <= Date.now()) throw new Error('A API retornou um link inválido ou vencido para esta evidência.');
      setDownload(result);
    } catch (error) { setFailure(errorMessage(error)); }
    finally { setLoadingDownload(false); }
  }
  async function refresh() {
    await Promise.all(['eligibility', 'appointment', 'appointments', 'work-permit', 'work-permits', 'permit-dashboard', 'documentary-readiness', 'work-authorizations', 'work-authorization', 'authorization-options'].map(key => client.invalidateQueries({ queryKey: [key] })));
  }
  async function submit() {
    if (!selected || pending || readOnly || outsideContext || !can(selected.action === 'UPLOAD' ? 'eligibility.write' : 'eligibility.review')) return;
    setFailure(''); setSuccess('');
    if (selected.item.restricted) { setFailure('Esta evidência exige conferência restrita por profissional autorizado.'); return; }
    if (selected.action === 'UPLOAD') {
      const invalid = evidenceFileError(file);
      if (invalid) { setFailure(invalid); return; }
      const invalidDates = evidenceDatesError(selected.item, validFrom, validUntil);
      if (invalidDates) { setFailure(invalidDates); return; }
      if (selected.appointmentRevision === undefined || !appointment.data || appointment.data.unitId !== unitId) { setFailure('Recarregue o atendimento e abra o envio novamente antes de enviar a evidência.'); return; }
    } else {
      if (decision === 'APPROVE' && !confirmed) { setFailure('Confirme a conferência do vínculo, da aplicabilidade e da evidência.'); return; }
      if (decision === 'REJECT' && !reason.trim()) { setFailure('Informe o motivo da rejeição.'); return; }
      if (!selected.item.evidenceId || selected.item.evidenceRevision === undefined) { setFailure('A revisão da evidência não está disponível. Recarregue os dados antes de conferir.'); return; }
    }
    setBusy(true);
    try {
      if (selected.action === 'UPLOAD') {
        const data = new FormData(); data.set('workerId', selected.person.workerId); data.set('requirementId', selected.item.requirementId); data.set('file', file!);
        if (validFrom) data.set('validFrom', validFrom);
        if (validUntil) data.set('validUntil', validUntil);
        await api.post<EvidenceDto>(`/appointments/${appointmentId}/evidence`, data, { etag: revisionEtag(selected.appointmentRevision!) });
        setSuccess('Evidência enviada para conferência. O envio sozinho não libera a pessoa para executar.');
      } else {
        await api.post<EvidenceDto>(`/evidence/${selected.item.evidenceId}/review`, { decision, ...(reason.trim() ? { reason: reason.trim() } : {}) }, { etag: revisionEtag(selected.item.evidenceRevision!) });
        setSuccess(decision === 'APPROVE' ? 'Conferência registrada. A elegibilidade foi atualizada para este atendimento.' : 'Evidência rejeitada. O participante continua bloqueado até a regularização.');
      }
      setSelected(undefined);
      await refresh();
    } catch (error) {
      const status = (error as { status?: number })?.status;
      setFailure(status === 412 ? 'Os dados mudaram enquanto você preenchia. Feche esta janela, atualize a conferência e abra a ação novamente para revisar.' : errorMessage(error));
    }
    finally { setBusy(false); }
  }
  if (!can('eligibility.read')) return <EmptyState title="Conferência documental restrita" description="Seu perfil não possui acesso aos requisitos deste atendimento." />;
  if (!unitId) return <EmptyState title="Selecione uma unidade" description="Escolha a unidade para consultar os requisitos do atendimento." />;
  if (outsideContext) return <EmptyState title="Conferência de outro contexto" description="A resposta não corresponde ao atendimento e à unidade selecionados. Atualize o atendimento antes de continuar." />;
  return <section className="panel stack" aria-label="Elegibilidade documental dos participantes">
    <div className={styles.sectionHead}><div><p className="eyebrow">Documentos por pessoa e atividade</p><h2>Conferência dos participantes</h2><p className="muted">Requisitos definidos pela matriz do serviço e pela função de cada pessoa.</p></div><Button variant="secondary" onClick={() => void eligibility.refetch()} disabled={eligibility.isFetching || busy}>{eligibility.isFetching ? 'Atualizando…' : 'Atualizar conferência'}</Button></div>
    {success && <Feedback tone="success">{success}</Feedback>}
    {eligibility.isPending ? <Spinner /> : eligibility.isError ? <Feedback tone="danger">{errorMessage(eligibility.error)} <Button variant="ghost" onClick={() => void eligibility.refetch()}>Tentar novamente</Button></Feedback> : eligibility.data && <>
      <Feedback tone={eligibility.data.eligible ? 'success' : 'warning'}>{eligibility.data.eligible ? <><ShieldCheck size={16} aria-hidden="true" /> Todos os requisitos aplicáveis estão conferidos neste momento.</> : 'Há requisitos pendentes. A abertura do atendimento pode continuar; liberar e iniciar a execução ficam bloqueados.'}</Feedback>
      <p className={styles.legend}>Matriz {eligibility.data.requirementVersion} · Consulta em {formatDate(eligibility.data.checkedAt)}. A conferência é reavaliada ao liberar e ao iniciar a PT. A validade depende do requisito configurado.</p>
      <div className={styles.participants}>{eligibility.data.participants.map(person => <article className={styles.participant} key={person.workerId}>
        <div className={styles.participantHeader}><div><h3>{person.name}</h3><p className="muted">Função neste serviço: {person.serviceFunction}</p></div><Badge tone={person.eligible ? 'success' : 'warning'}>{person.eligible ? 'Documentação conferida' : 'Pendência documental'}</Badge></div>
        {person.items.length ? person.items.map(item => <div className={styles.requirement} key={item.requirementId}>
          <div className={styles.requirementText}><h4>{item.label}</h4>
            {item.restricted ? <p className={`muted ${styles.restricted}`}><LockKeyhole size={14} aria-hidden="true" />Conferência restrita por profissional autorizado. Apenas a situação operacional é exibida.</p> : <><p className="muted">{item.description}</p>{item.fileName && <p>Arquivo: {item.fileName}</p>}{(item.validFrom || item.validUntil) && <p className="muted">Período da evidência: {item.validFrom ? formatDate(item.validFrom) : 'Início não informado'} → {item.validUntil ? formatDate(item.validUntil) : 'Sem término informado'}</p>}{item.reason && <p className="muted">Conferência: {item.reason}</p>}</>}
          </div>
          <div className={styles.requirementActions}><Badge tone={item.status === 'APPROVED' ? 'success' : item.status === 'REJECTED' || item.status === 'EXPIRED' ? 'danger' : 'warning'}>{evidenceLabels[item.status]}</Badge>
            {!readOnly && !item.restricted && can('eligibility.write') && <Button variant="secondary" disabled={appointment.isPending || appointment.isError || !appointment.data || appointment.data.unitId !== unitId || busy} onClick={() => select({ person, item, action: 'UPLOAD' })}>{item.evidenceId ? 'Substituir evidência' : 'Enviar evidência'}</Button>}
            {!readOnly && !item.restricted && can('eligibility.review') && item.status === 'PENDING' && <Button variant="secondary" onClick={() => select({ person, item, action: 'REVIEW' })}>Conferir evidência</Button>}
          </div>
        </div>) : <p className="muted">Nenhum requisito documental aplicável nesta matriz.</p>}
      </article>)}</div>
    </>}
    <Modal open={Boolean(selected)} title={selected?.action === 'UPLOAD' ? 'Enviar evidência do participante' : 'Conferir evidência do participante'} onClose={close}>
      {selected && <form className="stack" onSubmit={event => { event.preventDefault(); void submit(); }} noValidate>
        <div><h3>{selected.person.name}</h3><p className="muted">{selected.item.label} · {selected.person.serviceFunction}</p></div>
        {selected.action === 'UPLOAD' ? <>
          <Feedback tone="warning">O arquivo ficará aguardando conferência. Substituir uma evidência já conferida volta a bloquear a execução até a nova análise.</Feedback>
          <Field label="Arquivo da evidência *"><input type="file" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" disabled={busy} onChange={event => setFile(event.target.files?.[0])} /></Field><p className={styles.legend}>PDF, JPG ou PNG · Até 5 MB. Vinculado somente a esta pessoa e requisito.</p>
          <div className="form-grid"><Field label={`Data inicial da evidência${selected.item.validFromRequired ? ' *' : ''}`}><input type="date" required={selected.item.validFromRequired} value={validFrom} disabled={busy} onChange={event => setValidFrom(event.target.value)} /></Field><Field label={`Data final da evidência${selected.item.validUntilRequired ? ' *' : ''}`}><input type="date" required={selected.item.validUntilRequired} value={validUntil} disabled={busy} onChange={event => setValidUntil(event.target.value)} /></Field></div>
          {(selected.item.validFromRequired || selected.item.validUntilRequired) && <Feedback>Esta matriz exige {selected.item.validFromRequired && selected.item.validUntilRequired ? 'início e fim da vigência' : selected.item.validFromRequired ? 'início da vigência' : 'fim da vigência'} para este requisito.</Feedback>}
          <p className={styles.legend}>Quando a matriz exigir vigência, informe início e fim cobrindo o período do serviço. Não há um prazo único para todos os documentos ou capacitações.</p>
        </> : <>
          <p>Arquivo: <strong>{selected.item.fileName || 'Evidência enviada'}</strong></p>
          <div className="actions"><Button variant="secondary" disabled={busy || loadingDownload} onClick={() => void prepareDownload()}>{loadingDownload ? 'Preparando arquivo…' : 'Preparar arquivo para consulta'}</Button>{download && Date.parse(download.expiresAt) > Date.now() && <a className="button button--secondary" href={download.url} target="_blank" rel="noopener noreferrer">Abrir {download.fileName}</a>}</div>
          <Field label="Decisão da conferência"><select value={decision} disabled={busy} onChange={event => { setDecision(event.target.value as 'APPROVE' | 'REJECT'); setFailure(''); }}><option value="APPROVE">Conferir e aprovar a evidência</option><option value="REJECT">Rejeitar e pedir regularização</option></select></Field>
          {decision === 'APPROVE' && <label className={styles.reviewConsent}><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />Conferi a evidência, a pessoa vinculada, a aplicabilidade ao serviço e as datas exigidas pela matriz.</label>}
          <Field label={decision === 'REJECT' ? 'Motivo da rejeição *' : 'Observação da conferência'}><textarea maxLength={1000} value={reason} disabled={busy} onChange={event => setReason(event.target.value)} /></Field>
        </>}
        {failure && <Feedback tone="danger">{failure}</Feedback>}
        <div className="actions"><Button type="submit" disabled={pending}>{busy ? 'Registrando…' : selected.action === 'UPLOAD' ? 'Enviar para conferência' : 'Registrar conferência'}</Button><Button variant="secondary" disabled={pending} onClick={close}>Cancelar</Button></div>
      </form>}
    </Modal>
  </section>;
}

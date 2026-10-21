import { useNavigationGuard } from '../../app/navigation/NavigationProtection';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, ShieldCheck, UsersRound } from 'lucide-react';
import { api, revisionEtag } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { AppointmentDto, EligibilityDto, EligibilityItemDto, EvidenceDto, ParticipantEligibilityDto } from '../../shared/contracts/work-permits';
import { formatDate } from '../../shared/lib/format';
import { Button, EmptyState, Feedback, Field, Modal, Spinner } from '../../shared/ui';
import { evidenceDatesError, evidenceDownloadAllowed, evidenceFileError, errorMessage } from './support';
import styles from './Agenda.module.css';
import { isMatrixEligibilityItem, isWorkerIntegrationItem } from '../../shared/lib/eligibility-source';
import { WorkerIntegrationLink } from '../workers/WorkerIntegrationLink';
import { ParticipantRequirements } from './ParticipantRequirements';

type Selection = { person: ParticipantEligibilityDto; item: EligibilityItemDto; action: 'UPLOAD' | 'REVIEW'; appointmentRevision?: number };

export function EligibilityPanel({ appointmentId, readOnly = false }: { appointmentId: string; readOnly?: boolean }) {
  const { sessionKey, unitId, can } = useSession();
  const context = [sessionKey, unitId, appointmentId, readOnly, ...['eligibility.read', 'eligibility.write', 'eligibility.review', 'workers.read'].map(permission => can(permission))];
  return <EligibilityPanelContent key={JSON.stringify(context)} appointmentId={appointmentId} readOnly={readOnly} />;
}

function EligibilityPanelContent({ appointmentId, readOnly }: { appointmentId: string; readOnly: boolean }) {
  const { sessionKey, unitId, can } = useSession();
  const client = useQueryClient();
  const active = useRef(true);
  const operation = useRef<AbortController | undefined>(undefined);
  const participantSearch = useRef<HTMLInputElement>(null);
  const [participantQuery, setParticipantQuery] = useState('');
  const [pendingOnly, setPendingOnly] = useState(false);
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
  useNavigationGuard({ dirty: Boolean(selected), busy: pending });
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; operation.current?.abort(); operation.current = undefined; };
  }, []);
  const currentOperation = (controller: AbortController) => active.current && operation.current === controller && !controller.signal.aborted;
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
    if (!isMatrixEligibilityItem(value.item)) return;
    if (readOnly || pending || operation.current || outsideContext || !can(value.action === 'UPLOAD' ? 'eligibility.write' : 'eligibility.review')) return;
    if (value.action === 'UPLOAD' && (!appointment.data || appointment.data.unitId !== unitId || appointment.isError)) return;
    setSelected({ ...value, appointmentRevision: value.action === 'UPLOAD' ? appointment.data!.revision : undefined });
    setFile(undefined); setValidFrom(''); setValidUntil(''); setReason(''); setDecision('APPROVE'); setConfirmed(false); setFailure(''); setDownload(undefined);
  }
  function close() {
    if (pending || operation.current) return;
    const changed = Boolean(file || validFrom || validUntil || reason || decision !== 'APPROVE' || confirmed);
    if (changed && !window.confirm('Há alterações nesta conferência ainda não enviadas. Deseja descartar o preenchimento e fechar?')) return;
    setSelected(undefined); setFile(undefined); setValidFrom(''); setValidUntil(''); setReason(''); setDecision('APPROVE'); setConfirmed(false); setDownload(undefined); setFailure('');
  }
  async function prepareDownload() {
    if (!selected?.item.evidenceId || !isMatrixEligibilityItem(selected.item) || selected.item.restricted || pending || operation.current) return;
    const controller = new AbortController(); operation.current = controller;
    setLoadingDownload(true); setFailure('');
    try {
      const result = await api.get<{ url: string; fileName: string; expiresAt: string }>(`/evidence/${encodeURIComponent(selected.item.evidenceId)}/download`, { signal: controller.signal });
      if (!currentOperation(controller)) return;
      if (!evidenceDownloadAllowed(result.url) || !Number.isFinite(Date.parse(result.expiresAt)) || Date.parse(result.expiresAt) <= Date.now()) throw new Error('A API retornou um link inválido ou vencido para esta evidência.');
      setDownload(result);
    } catch (error) { if (currentOperation(controller)) setFailure(errorMessage(error)); }
    finally { if (currentOperation(controller)) { operation.current = undefined; setLoadingDownload(false); } }
  }
  async function refresh() {
    await Promise.all(['eligibility', 'appointment', 'appointments', 'work-permit', 'work-permits', 'permit-dashboard', 'documentary-readiness', 'work-authorizations', 'work-authorization', 'authorization-options'].map(key => client.invalidateQueries({ queryKey: [key] })));
  }
  async function submit() {
    if (!selected || pending || operation.current || readOnly || outsideContext || !can(selected.action === 'UPLOAD' ? 'eligibility.write' : 'eligibility.review')) return;
    if (!isMatrixEligibilityItem(selected.item)) return;
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
    const controller = new AbortController(); operation.current = controller;
    setBusy(true);
    try {
      if (selected.action === 'UPLOAD') {
        const data = new FormData(); data.set('workerId', selected.person.workerId); data.set('requirementId', selected.item.requirementId); data.set('file', file!);
        if (validFrom) data.set('validFrom', validFrom);
        if (validUntil) data.set('validUntil', validUntil);
        await api.post<EvidenceDto>(`/appointments/${encodeURIComponent(appointmentId)}/evidence`, data, { etag: revisionEtag(selected.appointmentRevision!), signal: controller.signal });
        if (!currentOperation(controller)) return;
        setSuccess('Evidência enviada para conferência. O envio sozinho não libera a pessoa para executar.');
      } else {
        await api.post<EvidenceDto>(`/evidence/${encodeURIComponent(selected.item.evidenceId!)}/review`, { decision, ...(reason.trim() ? { reason: reason.trim() } : {}) }, { etag: revisionEtag(selected.item.evidenceRevision!), signal: controller.signal });
        if (!currentOperation(controller)) return;
        setSuccess(decision === 'APPROVE' ? 'Conferência registrada. A elegibilidade foi atualizada para este atendimento.' : 'Evidência rejeitada. O participante continua bloqueado até a regularização.');
      }
      setSelected(undefined);
      await refresh();
    } catch (error) {
      if (!currentOperation(controller)) return;
      const status = (error as { status?: number })?.status;
      setFailure(status === 412 ? 'Os dados mudaram enquanto você preenchia. Feche esta janela, atualize a conferência e abra a ação novamente para revisar.' : errorMessage(error));
    }
    finally { if (currentOperation(controller)) { operation.current = undefined; setBusy(false); } }
  }
  const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim();
  const people = eligibility.data?.participants ?? [];
  const term = normalize(participantQuery);
  const visiblePeople = people.filter(person => (!pendingOnly || !person.eligible) && (!term || normalize(`${person.name} ${person.serviceFunction}`).includes(term)));
  const pendingCount = people.filter(person => !person.eligible).length;
  function clearParticipantFilters() { setParticipantQuery(''); setPendingOnly(false); participantSearch.current?.focus(); }

  if (!can('eligibility.read')) return <EmptyState title="Conferência documental restrita" description="Seu perfil não possui acesso aos requisitos deste atendimento." />;
  if (!unitId) return <EmptyState title="Selecione uma unidade" description="Escolha a unidade para consultar os requisitos do atendimento." />;
  if (outsideContext) return <EmptyState title="Conferência de outro contexto" description="A resposta não corresponde ao atendimento e à unidade selecionados. Atualize o atendimento antes de continuar." />;
  return <section className="panel stack" aria-label="Elegibilidade documental dos participantes">
    <div className="flex min-w-0 flex-wrap items-start justify-between gap-4"><div className="min-w-0"><p className="eyebrow">Documentos por pessoa e atividade</p><h2 className="!mb-2 !text-base text-[#315884]">Conferência dos participantes</h2><p className="!m-0 text-[12px] leading-6 text-slate-500">Requisitos definidos pela matriz do serviço e pela função de cada pessoa.</p></div><Button variant="secondary" onClick={() => void eligibility.refetch()} disabled={eligibility.isFetching || pending}>{eligibility.isFetching ? 'Atualizando…' : 'Atualizar conferência'}</Button></div>
    {success && <Feedback tone="success">{success}</Feedback>}
    {eligibility.isPending ? <Spinner /> : eligibility.isError ? <Feedback tone="danger">{errorMessage(eligibility.error)} <Button variant="ghost" onClick={() => void eligibility.refetch()}>Tentar novamente</Button></Feedback> : eligibility.data && <>
      <Feedback tone={eligibility.data.eligible ? 'success' : 'warning'}>{eligibility.data.eligible ? <><ShieldCheck size={16} aria-hidden="true" /> Todos os requisitos aplicáveis estão conferidos neste momento.</> : 'Há requisitos pendentes. A abertura do atendimento pode continuar; liberar e iniciar a execução ficam bloqueados.'}</Feedback>
      <p className={`${styles.legend} [overflow-wrap:anywhere]`}>Matriz {eligibility.data.requirementVersion} · Consulta em {formatDate(eligibility.data.checkedAt)}. A conferência é reavaliada ao liberar e ao iniciar a PT. A validade depende do requisito configurado.</p>
      <div className="flex flex-col gap-4 rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
        <Field label="Buscar participante"><div className="relative"><Search size={16} className="pointer-events-none absolute left-3.5 top-3.5 text-slate-400" aria-hidden="true" /><input ref={participantSearch} type="search" className="!pl-10" placeholder="Nome ou função no serviço" maxLength={200} value={participantQuery} onChange={event => setParticipantQuery(event.target.value)} /></div></Field>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtrar participantes">
          <Button variant={!pendingOnly ? 'primary' : 'secondary'} aria-label="Todos os participantes" aria-pressed={!pendingOnly} onClick={() => setPendingOnly(false)}><UsersRound size={13} aria-hidden="true" />Todos os participantes <span className="opacity-70">{people.length}</span></Button>
          <Button variant={pendingOnly ? 'primary' : 'secondary'} aria-label="Com pendências" aria-pressed={pendingOnly} onClick={() => setPendingOnly(true)}>Com pendências <span className="opacity-70">{pendingCount}</span></Button>
          {(participantQuery || pendingOnly) && <Button variant="ghost" onClick={clearParticipantFilters}>Limpar busca</Button>}
        </div>
        <p role="status" className="!m-0 text-[11px] leading-5 text-slate-500">Exibindo {visiblePeople.length} de {people.length} participantes</p>
      </div>
      <div className="flex min-w-0 flex-col gap-4">{visiblePeople.map(person => <ParticipantRequirements key={person.workerId} person={person} canReadWorkers={can('workers.read')} renderActions={(person, item) => <>
            {!item.restricted && isWorkerIntegrationItem(item) && <WorkerIntegrationLink workerId={person.workerId} workerName={person.name} />}
            {!item.restricted && isWorkerIntegrationItem(item) && !can('workers.read') && <p className="muted">Solicite a regularização da integração ao responsável pelo cadastro.</p>}
            {!readOnly && !item.restricted && isMatrixEligibilityItem(item) && can('eligibility.write') && <Button variant="secondary" disabled={appointment.isPending || appointment.isError || !appointment.data || appointment.data.unitId !== unitId || pending} onClick={() => select({ person, item, action: 'UPLOAD' })}>{item.evidenceId ? 'Substituir evidência' : 'Enviar evidência'}</Button>}
            {!readOnly && !item.restricted && isMatrixEligibilityItem(item) && can('eligibility.review') && item.status === 'PENDING' && <Button variant="secondary" disabled={pending} onClick={() => select({ person, item, action: 'REVIEW' })}>Conferir evidência</Button>}
          </>} />)}
        {!visiblePeople.length && <EmptyState title={people.length ? 'Nenhum participante neste filtro' : 'Nenhum participante retornado'} description={people.length ? 'Ajuste o nome ou a função, ou limpe a busca para consultar os demais participantes.' : 'O serviço não retornou participantes para este atendimento.'} />}
      </div>
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

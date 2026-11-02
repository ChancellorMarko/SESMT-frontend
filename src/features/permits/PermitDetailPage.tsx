import { useNavigationGuard } from '../../app/navigation/NavigationProtection';
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useLocation } from 'react-router';
import { Check, ClipboardCheck, Clock, Download, FileCheck2, LockKeyhole, ShieldCheck, UserPlus, Users } from 'lucide-react';
import { api, API_MODE, ApiError, revisionEtag } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { ChecklistItemDto, FinalPdfDto, ParticipantDto, PermitPreparationDto, PermitSnapshotDto, PermitSourceCheckDto, ScienceDto, TeamDto, WorkPermitDto } from '../../shared/contracts/work-permits';
import type { ServiceTemplateVersionDto } from '../../shared/contracts/service-templates';
import type { SignatureRepresentationDto } from '../../shared/contracts/signature-representation';
import { formatDate } from '../../shared/lib/format';
import { triggerDownload } from '../../shared/lib/downloads';
import { invalidateConsultation } from '../../shared/lib/consultation-cache';
import { permitNavigation, permitReturnDestination } from './permit-navigation';
import { SIGNATURE_IMAGE_MAX_FILE_BYTES } from '../../shared/lib/signature-image';
import { Badge, Button, EmptyState, Feedback, Field, Modal, PageHeader, Spinner, type Tone } from '../../shared/ui';
import { PermitStatus } from './PermitStatus';
import { SignaturePad } from './SignaturePad';
import { PermitChecklist } from './PermitChecklist';
import { PermitOrientation, type PermitSection } from './PermitOrientation';
import { permitGuidance } from './permit-guidance';
import orientationStyles from './PermitOrientation.module.css';
import { PermitPreparation, SourceChecks } from './PermitPreparation';
import { PermitAttachments } from './PermitAttachments';
import { PermitLifecycleActions } from './PermitLifecycleActions';
import { validatePreparation, validateSourceChecks } from './templates/ri-s-36001';
import { errorMessage, isDrawingRepresentation, isImageRepresentation, releaseBlockers, validateChecklist, validateScience, validateText } from './validation';
import { DesignationCoveragePanel } from '../designations';
import { appointmentServiceIds } from '../../shared/lib/appointment-services';
import type { DesignationCoverageDto } from '../../shared/contracts/designations';
import { permitEventLabels as eventLabels } from './event-labels';
import { validateFinalPdf } from './final-pdf';
import styles from './permits.module.css';

type Command = 'science' | 'release' | 'start' | 'complete' | 'review' | 'new-version' | 'submit-correction';
type Write = { command: Command | 'checklist' | 'preparation'; body: unknown };
const commandLabels: Record<Command, string> = { science: 'Registrar ciência do participante', release: 'Liberar execução', start: 'Registrar início da execução', complete: 'Concluir atividade e enviar para revisão', review: 'Revisar encerramento', 'new-version': 'Criar versão de correção', 'submit-correction': 'Reapresentar correção para revisão' };
const evidenceLabels: Record<string, string> = { MISSING: 'Ausente', PENDING: 'Em conferência', APPROVED: 'Conferido', REJECTED: 'Devolvido', EXPIRED: 'Vencido' };
const evidenceTones: Record<string, Tone> = { MISSING: 'danger', PENDING: 'warning', APPROVED: 'success', REJECTED: 'danger', EXPIRED: 'danger' };
const staleFormMessage = 'Os dados da PT mudaram. Suas alterações foram preservadas. Carregue e confira a versão atual antes de salvar.';
// Operational events can change the revision while leaving every editable document field untouched.
const savedFormContent = (permit: WorkPermitDto) => JSON.stringify({ checklist: permit.checklist, preparation: permit.preparation, serviceTemplates: permit.serviceTemplates, summary: permit.summary || '' });
const baseFor = (permit: WorkPermitDto) => ({ id: permit.id, revision: permit.revision, content: savedFormContent(permit) });

function ScienceEvidence({ science }: { science: ScienceDto }) {
  return <div className={styles.scienceEvidence}>
    <div><strong>{science.declarantName}</strong><p className="muted">{science.method === 'DRAWN' ? 'Desenho com confirmação explícita' : 'Nome digitado com confirmação explícita'} · versão {science.version}</p></div>
    {science.method === 'DRAWN' && isDrawingRepresentation(science.representation) ? <img src={science.representation} alt={`Representação visual de ${science.declarantName}`} className={styles.signatureImage} /> : <p className={styles.typedRepresentation}>{science.representation}</p>}
    <p className="muted">Coletado por {science.collectedByName} em {formatDate(science.collectedAt)}. O coletor autenticado e o declarante são pessoas identificadas separadamente.</p>
  </div>;
}

function ServiceTemplates({ templates }: { templates?: ServiceTemplateVersionDto[] }) {
  if (!templates?.length) return null;
  return <div className="stack" aria-label="Serviços e templates preservados"><h3>Serviços e templates desta PT</h3><p className="muted">Versões fixadas na abertura do atendimento. Alterações posteriores do catálogo não substituem estes registros.</p><div className={styles.serviceTemplates}>{templates.map(template => <article key={template.serviceTypeId} className={styles.serviceTemplate}><strong>{template.serviceName}</strong><Badge tone="neutral">Template v{template.version}</Badge><small className="muted">{template.questions.length} perguntas · publicado em {formatDate(template.publishedAt)}</small></article>)}</div></div>;
}

function Snapshot({ snapshot, current }: { snapshot: PermitSnapshotDto; current: boolean }) {
  return <details className={styles.snapshot}>
    <summary><span>Versão {snapshot.version}{current ? ' · versão atual' : ''}</span><Badge tone={snapshot.decision === 'APPROVE' ? 'success' : snapshot.decision === 'RETURN' ? 'danger' : 'warning'}>{snapshot.decision === 'APPROVE' ? 'Aprovada' : snapshot.decision === 'RETURN' ? 'Devolvida' : 'Enviada para revisão'}</Badge></summary>
    <div className="stack"><p className="muted">Registro preservado · enviado em {formatDate(snapshot.submittedAt)}</p><h3>Resumo do encerramento</h3><p className={styles.preserveText}>{snapshot.summary}</p>
      <ServiceTemplates templates={snapshot.serviceTemplates} />
      <div><h3>Checklist desta versão</h3><ul className={styles.snapshotChecklist}>{snapshot.checklist.map(item => <li key={item.id}>{item.serviceName && <p className="muted">{item.serviceName} · template v{item.templateVersion || 'não registrada'}</p>}<strong>{item.label}</strong> — {item.answer === 'YES' ? 'Sim' : item.answer === 'NO' ? 'Não' : 'Não respondido'}{item.note && <p className="muted">{item.note}</p>}</li>)}</ul></div>
      {snapshot.preparation && <><PermitPreparation value={snapshot.preparation} editable={false} pending={false} dirty={false} onChange={() => {}} onSubmit={event => event.preventDefault()} /><h3>Checklist de encerramento preservado</h3><SourceChecks checks={snapshot.preparation.closingChecks} disabled prefix={`snapshot-${snapshot.version}`} onChange={() => {}} /></>}
      <div><h3>Ciências desta versão</h3>{snapshot.sciences.map(science => <ScienceEvidence key={science.id} science={science} />)}</div>
      {snapshot.decision && <div className={styles.reviewRecord}>
        <h3>{snapshot.decision === 'APPROVE' ? 'Aprovação do encerramento' : 'Devolução do encerramento'}</h3>
        <p>{snapshot.reviewedBy} · {formatDate(snapshot.reviewedAt)}</p>
        {snapshot.comment && <p className={styles.preserveText}>{snapshot.comment}</p>}
        {snapshot.signatureImage && (isDrawingRepresentation(snapshot.signatureImage) || isImageRepresentation(snapshot.signatureImage)) ? (
          <div>
            <img src={snapshot.signatureImage} alt="Assinatura do responsável" className={styles.signatureImage} />
            <p className="muted">{snapshot.signatureMethod === 'DRAWN' ? 'Rubrica desenhada' : 'Imagem anexada'} · {snapshot.signatureRepresentation || 'Responsável técnico'}</p>
          </div>
        ) : snapshot.signatureRepresentation ? (
          <>
            <p className={styles.typedRepresentation}>{snapshot.signatureRepresentation}</p>
            <p className="muted">Representação digitada associada à decisão explícita nesta versão. Não representa assinatura criptográfica.</p>
          </>
        ) : null}
      </div>}
    </div>
  </details>;
}


export function PermitDetailPage() {
  const { id } = useParams();
  const { me, sessionKey, unitId, can } = useSession();
  const client = useQueryClient();
  const location = useLocation();
  const permitQuery = useQuery({ queryKey: ['work-permit', sessionKey, unitId, id], queryFn: ({ signal }) => api.get<WorkPermitDto>(`/work-permits/${id}`, { signal }) });
  const returnOrigin = permitNavigation(location.state, sessionKey, unitId, id, can('appointments.read'), can('eligibility.read'), permitQuery.data?.appointment.id);
  const returnDestination = permitReturnDestination(returnOrigin);
  const backTarget = returnDestination.to;
  const backLabel = returnDestination.label;
  const backState = returnDestination.state;
  const agendaOrigin = returnOrigin && 'permitAgendaReturnTo' in returnOrigin ? returnOrigin.permitAgendaReturnTo : undefined;
  const appointmentState = agendaOrigin ? { fromSearch: agendaOrigin.search, ...(agendaOrigin.readinessReturnTo ? { readinessReturnTo: agendaOrigin.readinessReturnTo } : {}) } : undefined;
  const [checklist, setChecklist] = useState<ChecklistItemDto[]>([]);
  const [preparation, setPreparation] = useState<PermitPreparationDto>();
  const [closingChecks, setClosingChecks] = useState<PermitSourceCheckDto[]>([]);
  const [summary, setSummary] = useState('');
  const [formBase, setFormBase] = useState<ReturnType<typeof baseFor> | null>(null);
  const [command, setCommand] = useState<Command>();
  const [intent, setIntent] = useState<{ revision: number; version: number }>();
  const [workerId, setWorkerId] = useState('');
  const [declarantName, setDeclarantName] = useState('');
  const [method, setMethod] = useState<'TYPED' | 'DRAWN'>('TYPED');
  const [drawing, setDrawing] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [decision, setDecision] = useState<'APPROVE' | 'RETURN'>('APPROVE');
  const [comment, setComment] = useState('');
  const [localError, setLocalError] = useState('');
  const [notice, setNotice] = useState('');
  const [attachmentsBusy, setAttachmentsBusy] = useState(false);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);

  // Review representation states (priority #112/#115)
  const [reviewMethod, setReviewMethod] = useState<'TYPED' | 'DRAWN' | 'IMAGE'>('TYPED');
  const [reviewDrawing, setReviewDrawing] = useState('');
  const [reviewImage, setReviewImage] = useState('');
  const [reviewImageName, setReviewImageName] = useState('');
  const [readingReviewImage, setReadingReviewImage] = useState(false);
  const reviewImageReader = useRef<FileReader | null>(null);
  const [reviewProfile, setReviewProfile] = useState<SignatureRepresentationDto>();
  const profileQuery = useQuery({
    queryKey: ['signature-representation', sessionKey, unitId],
    queryFn: ({ signal }) => api.get<SignatureRepresentationDto | null>('/me/signature-representation', { signal }),
    enabled: command === 'review' && can('permits.review'),
    refetchOnWindowFocus: true,
  });
  const ownProfile = profileQuery.data?.userId === me?.user.id ? profileQuery.data : null;

  // Final PDF download states (priority #115)
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [pdfDisclaimer, setPdfDisclaimer] = useState<string | null>(null);
  const pdfRequest = useRef<AbortController | null>(null);

  // Controlled participant modification states (priority #94/#116)
  const [isEditingParticipants, setIsEditingParticipants] = useState(false);
  const [selectedParticipants, setSelectedParticipants] = useState<ParticipantDto[]>([]);
  const [participantsReason, setParticipantsReason] = useState('');
  const [confirmedParticipantsChange, setConfirmedParticipantsChange] = useState(false);

  const permit = permitQuery.data;
  const pdfContext = useRef('');
  pdfContext.current = JSON.stringify([id, sessionKey, unitId, permit?.id, permit?.appointment.unitId, permit?.version, !permitQuery.isError && permit?.snapshots.some(snapshot => snapshot.version === permit.version && snapshot.decision === 'APPROVE')]);
  const serviceTypeIds = permit ? appointmentServiceIds(permit.appointment) : [];
  const coverageQuery = useQuery({
    queryKey: ['designation-coverage', sessionKey, unitId, serviceTypeIds.slice().sort().join(','), permit?.appointment.location, permit?.appointment.responsibleId],
    queryFn: ({ signal }) => api.get<DesignationCoverageDto>('/designation-coverage', {
      signal,
      query: {
        unitId: unitId!,
        serviceTypeIds: serviceTypeIds.join(','),
        location: permit!.appointment.location,
        responsibleId: permit!.appointment.responsibleId,
      },
    }),
    enabled: Boolean(permit && unitId && serviceTypeIds.length > 0 && can('permits.read')),
  });
  const operatorAuthorized = Boolean(permit && can('permits.operate') && permit.appointment.responsibleId === me?.user.id);
  const correctionDraft = Boolean(permit && permit.operationStatus === 'COMPLETED' && permit.reviewStatus === 'NOT_SUBMITTED' && permit.snapshots.length > 0 && permit.version > Math.max(...permit.snapshots.map(snapshot => snapshot.version)));
  const checklistDirty = Boolean(permit && JSON.stringify(checklist) !== JSON.stringify(permit.checklist));
  const preparationDirty = Boolean(permit && JSON.stringify(preparation) !== JSON.stringify(permit.preparation));
  const closingDirty = Boolean(permit?.preparation && JSON.stringify(closingChecks) !== JSON.stringify(permit.preparation.closingChecks));
  const formDirty = checklistDirty || preparationDirty || closingDirty;
  const summaryDirty = Boolean(permit && operatorAuthorized && summary !== (permit.summary || '') && (['EXECUTING', 'SUSPENDED', 'CANCELED'].includes(permit.operationStatus) || correctionDraft));
  useEffect(() => { setCommand(undefined); setIntent(undefined); setFormBase(null); setLocalError(''); setNotice(''); }, [id, sessionKey, unitId]);
  useEffect(() => {
    setReviewDrawing(''); setReviewImage(''); setReviewImageName(''); setReadingReviewImage(false); setReviewProfile(undefined);
    setPdfDisclaimer(null); setIsDownloadingPdf(false);
    return () => { cancelReviewImageRead(); pdfRequest.current?.abort(); pdfRequest.current = null; };
  }, [id, sessionKey, unitId]);

  const teamQuery = useQuery({
    queryKey: ['team', sessionKey, permit?.appointment.teamId],
    queryFn: ({ signal }) => api.get<TeamDto>(`/teams/${permit!.appointment.teamId}`, { signal }),
    enabled: Boolean(permit?.appointment.teamId && (can('teams.read') || can('appointments.read'))),
  });
  const availableTeamMembers = teamQuery.data?.members || permit?.appointment.participants || [];

  const participantsMutation = useMutation({
    mutationFn: async (payload: { participants: ParticipantDto[]; reason: string }) => {
      return api.patch<WorkPermitDto>(`/work-permits/${id}/participants`, payload, {
        etag: revisionEtag(permit!.revision),
      });
    },
    onSuccess: (updated) => {
      client.setQueryData(['work-permit', sessionKey, unitId, id], updated);
      setIsEditingParticipants(false);
      setNotice('Composição de participantes da equipe atualizada com sucesso.');
      void Promise.all(['work-permit', 'work-permits', 'appointments', 'appointment', 'eligibility', 'documentary-readiness'].map(key => client.invalidateQueries({ queryKey: [key] })));
      void invalidateConsultation(client, 'permits', { sessionKey, unitId });
    },
    onError: (err) => {
      setLocalError(errorMessage(err));
    },
  });

  async function downloadFinalPdf() {
    const snapshot = permit?.snapshots.find(item => item.version === permit.version && item.decision === 'APPROVE');
    if (!permit || !snapshot || permit.id !== id || permit.appointment.unitId !== unitId || permitQuery.isError || pdfRequest.current) return;
    const controller = new AbortController(); pdfRequest.current = controller;
    const requestContext = pdfContext.current;
    setIsDownloadingPdf(true);
    setLocalError(''); setPdfDisclaimer(null);
    try {
      const res = await api.get<FinalPdfDto>(`/work-permits/${permit.id}/final-pdf`, { query: { version: snapshot.version }, signal: controller.signal });
      if (controller.signal.aborted || pdfRequest.current !== controller || requestContext !== pdfContext.current) return;
      validateFinalPdf(res, permit.id, snapshot.version);
      triggerDownload(res.url, res.fileName);
      setPdfDisclaimer(res.backendPersisted ? res.disclaimer : res.disclaimer || 'PDF demonstrativo, sem persistência ou validade operacional.');
    } catch (err) {
      if (!controller.signal.aborted && requestContext === pdfContext.current) setLocalError(errorMessage(err));
    } finally {
      if (pdfRequest.current === controller) { pdfRequest.current = null; setIsDownloadingPdf(false); }
    }
  }

  function cancelReviewImageRead() {
    const reader = reviewImageReader.current;
    reviewImageReader.current = null;
    if (reader?.readyState === FileReader.LOADING) reader.abort();
  }
  function changeReviewMethod(next: typeof reviewMethod) {
    cancelReviewImageRead(); setReadingReviewImage(false);
    setReviewMethod(next); setReviewDrawing(''); setReviewImage(''); setReviewImageName(''); setReviewProfile(undefined); setConfirmed(false); setLocalError('');
  }
  function selectPersonalProfile() {
    if (!ownProfile || profileQuery.isFetching || profileQuery.isError || writePending) return;
    cancelReviewImageRead(); setReadingReviewImage(false);
    setReviewProfile(structuredClone(ownProfile)); setReviewMethod(ownProfile.method);
    setReviewDrawing(''); setReviewImage(''); setReviewImageName(''); setConfirmed(false); setLocalError('');
  }
  function selectReviewImage(event: ChangeEvent<HTMLInputElement>) {
    cancelReviewImageRead(); setReadingReviewImage(false);
    setReviewImage(''); setReviewImageName(''); setConfirmed(false); setLocalError('');
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) { setLocalError('Selecione uma imagem PNG ou JPEG.'); event.target.value = ''; return; }
    if (!file.size || file.size > SIGNATURE_IMAGE_MAX_FILE_BYTES) { setLocalError('A imagem deve conter dados e ter até 2 MB.'); event.target.value = ''; return; }
    const reader = new FileReader(); reviewImageReader.current = reader; setReadingReviewImage(true);
    reader.onload = () => {
      if (reviewImageReader.current !== reader) return;
      reviewImageReader.current = null; setReadingReviewImage(false);
      const image = typeof reader.result === 'string' ? reader.result : '';
      if (!isImageRepresentation(image)) { setLocalError('Não foi possível ler uma representação PNG ou JPEG válida.'); return; }
      setReviewImage(image); setReviewImageName(file.name); setConfirmed(false);
    };
    reader.onerror = () => {
      if (reviewImageReader.current !== reader) return;
      reviewImageReader.current = null; setReadingReviewImage(false); setLocalError('Não foi possível ler a imagem. Selecione o arquivo novamente.');
    };
    reader.readAsDataURL(file);
  }

  function openParticipantsModal() {
    if (writePending || !permit) return;
    setSelectedParticipants(permit.appointment.participants.map(p => ({ ...p })));
    setParticipantsReason('');
    setConfirmedParticipantsChange(false);
    setIsEditingParticipants(true);
  }

  async function saveParticipantsChange(event: FormEvent) {
    event.preventDefault();
    if (!permit || writePending || !confirmedParticipantsChange || !participantsReason.trim() || !selectedParticipants.length) return;
    await participantsMutation.mutateAsync({
      participants: selectedParticipants,
      reason: participantsReason.trim(),
    });
  }

  const mutation = useMutation({ mutationFn: async ({ command: action, body }: Write) => {
    if (!permit) throw new Error('A PT precisa ser carregada antes de confirmar.');
    if (attachmentsBusy || lifecycleBusy) throw new Error('Aguarde a confirmação da ação em andamento antes de registrar outra ação.');
    const edit = action === 'checklist' || action === 'preparation';
    const expectedRevision = edit ? formBase?.revision : intent?.revision;
    if (expectedRevision !== permit.revision || (!edit && intent?.version !== permit.version)) throw new Error('Esta PT foi atualizada. Carregue e confira a versão atual antes de confirmar novamente.');
    const options = { etag: revisionEtag(expectedRevision) };
    if (action === 'checklist') return api.patch<WorkPermitDto>(`/work-permits/${id}/checklist`, body, options);
    if (action === 'preparation') return api.patch<WorkPermitDto>(`/work-permits/${id}/preparation`, body, options);
    return api.post<WorkPermitDto>(`/work-permits/${id}/${action === 'science' ? 'sciences' : action}`, body, options);
  }, onSuccess: (updated, variables) => {
    client.setQueryData(['work-permit', sessionKey, unitId, id], updated);
    if (variables.command === 'checklist' || !checklistDirty) setChecklist(structuredClone(updated.checklist));
    if (variables.command === 'preparation' || !preparationDirty) setPreparation(updated.preparation ? structuredClone(updated.preparation) : undefined);
    if (!closingDirty || ['complete', 'submit-correction', 'new-version'].includes(variables.command)) setClosingChecks(structuredClone(updated.preparation?.closingChecks || []));
    if (!summaryDirty || !['science', 'checklist', 'preparation'].includes(variables.command)) setSummary(updated.summary || '');
    setFormBase(baseFor(updated));
    setCommand(undefined); setLocalError(''); setNotice(variables.command === 'checklist' ? 'Checklist salvo nesta versão.' : variables.command === 'preparation' ? 'Preparação da PT salva nesta versão.' : `${commandLabels[variables.command]}: ação registrada.`);
    // The confirmed response is authoritative for this PT. Refresh other views in the background.
    void Promise.all(['work-permit', 'work-permits', 'appointments', 'appointment', 'permit-dashboard', 'pt-dashboard', 'eligibility', 'documentary-readiness', 'designation-coverage'].map(key => client.invalidateQueries({ queryKey: [key] })));
    void invalidateConsultation(client, 'permits', { sessionKey, unitId });
  }, onError: error => {
    if (error instanceof ApiError && ['DOCUMENTARY_BLOCK', 'CHECKLIST_PENDING', 'SCIENCES_PENDING'].includes(error.code)) void client.invalidateQueries({ queryKey: ['work-permit', sessionKey, unitId, id] });
  } });
  const writePending = mutation.isPending || attachmentsBusy || lifecycleBusy || participantsMutation.isPending;
  useNavigationGuard({ dirty: formDirty || summaryDirty || Boolean(command) || isEditingParticipants, busy: writePending });
  useEffect(() => {
    if (!permit) return;
    if (!formBase || formBase.id !== permit.id || (formBase.revision !== permit.revision && !formDirty && !summaryDirty)) {
      setChecklist(structuredClone(permit.checklist)); setPreparation(permit.preparation ? structuredClone(permit.preparation) : undefined); setClosingChecks(structuredClone(permit.preparation?.closingChecks || [])); setSummary(permit.summary || ''); setFormBase(baseFor(permit));
    } else if (formBase.revision !== permit.revision && (formDirty || summaryDirty)) {
      if (formBase.content === savedFormContent(permit)) {
        // Preserve local drafts and accept only the newer revision of identical saved content.
        setFormBase(baseFor(permit)); setLocalError(value => value === staleFormMessage ? '' : value);
      } else setLocalError(staleFormMessage);
    }
  }, [permit?.id, permit?.revision, formBase?.id, formBase?.revision]);
  useEffect(() => {
    if (!formDirty && !summaryDirty && !command && !writePending) return;
    const handler = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    const allowLeave = () => {
      if (writePending) { setLocalError('Aguarde a confirmação da ação em andamento antes de mudar de tela ou unidade.'); return false; }
      return window.confirm('Há alterações da PT ainda não salvas. Deseja sair desta tela e descartá-las?');
    };
    const contextChange = (event: Event) => { if (!event.defaultPrevented && !allowLeave()) event.preventDefault(); };
    const navigate = (event: MouseEvent) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!link || event.defaultPrevented) return;
      if (link.target === '_blank' || link.hasAttribute('download')) return;
      const destination = new URL(link.getAttribute('href')!, window.location.href);
      if (destination.pathname === window.location.pathname && destination.search === window.location.search) return;
      if (!allowLeave()) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener('beforeunload', handler); window.addEventListener('sesmt:before-context-change', contextChange);
    document.addEventListener('click', navigate, true);
    return () => { window.removeEventListener('beforeunload', handler); window.removeEventListener('sesmt:before-context-change', contextChange); document.removeEventListener('click', navigate, true); };
  }, [formDirty, summaryDirty, command, writePending]);
  function reloadCurrent() {
    if (writePending) { setLocalError('Aguarde a confirmação da ação em andamento antes de carregar a PT novamente.'); return; }
    if ((formDirty || summaryDirty) && !window.confirm('Carregar a versão atual descarta suas alterações locais. Continuar?')) return;
    setFormBase(null); setCommand(undefined); setIntent(undefined); mutation.reset(); setLocalError(''); void permitQuery.refetch();
  }
  function open(next: Command, participantId?: string) {
    if (writePending) { setLocalError('Aguarde a confirmação da ação em andamento antes de abrir outra confirmação.'); return; }
    if (permit) setIntent({ revision: permit.revision, version: permit.version });
    setCommand(next); setConfirmed(false); setComment(''); setDecision('APPROVE'); setLocalError(''); setDrawing(''); setMethod('TYPED');
    cancelReviewImageRead(); setReadingReviewImage(false); setReviewMethod('TYPED'); setReviewDrawing(''); setReviewImage(''); setReviewImageName(''); setReviewProfile(undefined); mutation.reset();
    const participant = permit?.appointment.participants.find(item => item.workerId === participantId);
    setWorkerId(participant?.workerId || ''); setDeclarantName(participant?.name || '');
  }
  function close() { if (!writePending) { cancelReviewImageRead(); setReadingReviewImage(false); setCommand(undefined); setIntent(undefined); setLocalError(''); mutation.reset(); } }
  async function saveChecklist(event: FormEvent) {
    event.preventDefault(); if (writePending) return; setLocalError(''); mutation.reset();
    const error = validateChecklist(checklist);
    if (error) return;
    try { await mutation.mutateAsync({ command: 'checklist', body: { items: checklist } }); } catch { /* Keep the answers for correction. */ }
  }
  async function savePreparation(event: FormEvent) {
    event.preventDefault(); if (writePending) return; setLocalError(''); mutation.reset();
    if (!preparation) return;
    const error = validatePreparation(preparation);
    if (error) return;
    try { await mutation.mutateAsync({ command: 'preparation', body: preparation }); } catch { /* Keep the local preparation. */ }
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (writePending) return; setLocalError('');
    if (!command || !permit) return;
    let body: unknown = {};
    if (command === 'science') {
      const participant = permit.appointment.participants.find(item => item.workerId === workerId);
      if (!participant) { setLocalError('Selecione um participante desta PT.'); return; }
      const representation = method === 'DRAWN' ? drawing : declarantName.trim();
      const error = validateScience(participant.name, declarantName, confirmed, method, representation);
      if (error) { setLocalError(error); return; }
      if (checklistDirty || preparationDirty) { setLocalError('Salve o checklist e a preparação antes de coletar a ciência desta versão.'); return; }
      body = { workerId, declarantName: declarantName.trim(), method, representation, confirmed: true };
    } else if (command === 'complete' || command === 'submit-correction') {
      const error = validateText(summary, 'Resumo do atendimento', 10);
      if (error) { setLocalError(error); return; }
      if (checklistDirty) { setLocalError('Salve o checklist antes de enviar a versão.'); return; }
      if (preparationDirty) { setLocalError('Salve a preparação antes de enviar a versão.'); return; }
      if (permit.preparation) { const error = validateSourceChecks(closingChecks, true); if (error) { setLocalError(error); return; } }
      if (!confirmed) { setLocalError('Confirme o envio desta versão para revisão.'); return; }
      body = { summary: summary.trim(), ...(permit.preparation ? { closingChecks } : {}) };
    } else if (command === 'new-version') {
      const error = validateText(comment, 'Motivo da correção');
      if (error) { setLocalError(error); return; }
      if (!confirmed) { setLocalError('Confirme a criação da nova versão documental.'); return; }
      body = { reason: comment.trim() };
    } else if (command === 'review') {
      if (readingReviewImage) { setLocalError('Aguarde a leitura da imagem antes de confirmar.'); return; }
      const error = decision === 'RETURN' ? validateText(comment, 'Motivo da devolução') : comment.length > 4000 ? 'A observação deve ter até 4.000 caracteres.' : undefined;
      if (error) { setLocalError(error); return; }
      if (!confirmed) { setLocalError('Confirme sua decisão sobre esta versão.'); return; }
      if (decision === 'APPROVE') {
        if (!me?.user.displayName) { setLocalError('Não foi possível identificar o responsável autenticado.'); return; }
        if (reviewProfile && (profileQuery.isFetching || profileQuery.isError || !ownProfile || ownProfile.id !== reviewProfile.id || ownProfile.version !== reviewProfile.version || reviewProfile.userId !== me.user.id)) { setLocalError('Sua representação pessoal foi alterada ou não pôde ser conferida. Carregue e selecione o perfil atual antes de aprovar.'); return; }
        if (reviewMethod === 'DRAWN' && !isDrawingRepresentation(reviewProfile?.image || reviewDrawing)) { setLocalError('Desenhe sua assinatura no quadro antes de confirmar a aprovação.'); return; }
        if (reviewMethod === 'IMAGE' && !isImageRepresentation(reviewProfile?.image || reviewImage)) { setLocalError('Selecione uma imagem de sua assinatura antes de confirmar a aprovação.'); return; }
      }
      body = {
        decision,
        comment: comment.trim(),
        ...(decision === 'APPROVE' ? {
          signatureRepresentation: reviewProfile?.representation || me!.user.displayName,
          signatureMethod: reviewMethod,
          signatureImage: reviewMethod === 'DRAWN' ? reviewProfile?.image || reviewDrawing : reviewMethod === 'IMAGE' ? reviewProfile?.image || reviewImage : undefined,
          ...(reviewProfile ? { signatureProfileId: reviewProfile.id, signatureProfileVersion: reviewProfile.version } : {}),
        } : {}),
      };
    } else {
      if (!confirmed) { setLocalError('Confirme as condições desta ação antes de continuar.'); return; }
      if (checklistDirty || preparationDirty) { setLocalError('Salve o checklist e a preparação antes de continuar.'); return; }
    }
    try { await mutation.mutateAsync({ command, body }); } catch { /* Preserve the form and display the API error. */ }
  }

  if (permitQuery.isPending) return <Spinner />;
  if (permitQuery.isError || !permit) return <div className="panel stack"><Feedback tone="danger">{errorMessage(permitQuery.error)}</Feedback><Button variant="secondary" onClick={() => permitQuery.refetch()}>Tentar novamente</Button><Link to={backTarget} state={backState}>{backLabel}</Link></div>;
  if (permit.appointment.unitId !== unitId) return <div className="panel stack"><EmptyState title="PT de outra unidade" description="Selecione a unidade deste atendimento para consultar seu conteúdo, ou volte à lista da unidade atual." /><Link to={backTarget} state={backState}>{backLabel}</Link></div>;
  const actions = permit.availableActions;
  const has = (action: string) => actions.includes(action) && (action === 'REVIEW' ? can('permits.review') : operatorAuthorized);
  const canEdit = has('EDIT_CHECKLIST');
  const correction = correctionDraft;
  const currentSciences = permit.sciences.filter(science => science.version === permit.version);
  const currentScienceCount = permit.appointment.participants.filter(participant => currentSciences.some(science => science.workerId === participant.workerId)).length;
  const blockers = releaseBlockers(permit);
  if (Array.isArray(coverageQuery.data?.items) && !coverageQuery.data.fullyCovered) {
    blockers.push('Há serviços sem designação operacional vigente cobrindo este responsável e local.');
  }
  if (Array.isArray(coverageQuery.data?.items) && coverageQuery.data?.operationalWindowEnd) {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    if (today > coverageQuery.data.operationalWindowEnd) {
      blockers.push(`A janela operacional da designação expirou em ${formatDate(coverageQuery.data.operationalWindowEnd)}.`);
    }
  }
  const selectedParticipant = permit.appointment.participants.find(participant => participant.workerId === workerId);
  const writeError = mutation.isError ? errorMessage(mutation.error) : '';
  const conflict = mutation.error instanceof ApiError && mutation.error.status === 412;
  const staleForm = formBase?.revision !== permit.revision;
  const canWriteSummary = has('COMPLETE') || correction && operatorAuthorized;
  const preservedSummaryDraft = summaryDirty && ['SUSPENDED', 'CANCELED'].includes(permit.operationStatus);
  const staleIntent = Boolean(command && intent && (intent.revision !== permit.revision || intent.version !== permit.version));
  const showLifecycle = can('permits.read') && Boolean(permit.lifecycle || operatorAuthorized && permit.reviewStatus === 'NOT_SUBMITTED' && (
    actions.includes('SUSPEND') && ['RELEASED', 'EXECUTING'].includes(permit.operationStatus)
    || actions.includes('RESUME') && permit.operationStatus === 'SUSPENDED'
    || actions.includes('CANCEL') && ['VERIFICATION', 'RELEASED', 'SUSPENDED'].includes(permit.operationStatus)
  ));
  const sections: PermitSection[] = [
    { id: 'preparacao', label: 'Preparação' }, { id: 'conferencia', label: 'Checklist' },
    { id: 'requisitos', label: 'Requisitos' }, { id: 'ciencias', label: 'Ciências' },
    { id: 'designacao', label: 'Designação' }, { id: 'operacao', label: 'Liberação e execução' },
    ...(showLifecycle ? [{ id: 'interrupcao' as const, label: 'Interrupção e retomada' }] : []),
    ...(can('permits.read') ? [{ id: 'anexos' as const, label: 'Anexos' }] : []),
    { id: 'encerramento', label: 'Encerramento' }, { id: 'revisao', label: 'Revisão final' },
    { id: 'historico', label: 'Histórico' },
  ];
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const coverage = coverageQuery.isPending ? 'pending' : coverageQuery.isError || coverageQuery.data?.unitId !== unitId || !Array.isArray(coverageQuery.data?.items) || typeof coverageQuery.data.fullyCovered !== 'boolean'
    ? 'unavailable' : !coverageQuery.data.fullyCovered || Boolean(coverageQuery.data.operationalWindowEnd && today > coverageQuery.data.operationalWindowEnd) ? 'blocked' : 'covered';
  const guidance = permitGuidance(permit, { authorizedActions: actions.filter(has), operator: operatorAuthorized, reviewer: can('permits.review'), preparationDirty, checklistDirty, closingDirty, summaryDirty, busy: writePending, stale: staleForm, coverage });
  const editItem = (itemId: string, changes: Partial<ChecklistItemDto>) => { setChecklist(items => items.map(item => item.id === itemId ? { ...item, ...changes } : item)); setNotice(''); };
  const canDownloadFinalPdf = permit.snapshots.some(snapshot => snapshot.version === permit.version && snapshot.decision === 'APPROVE');

  return <div className={`stack ${orientationStyles.workspace}`} role="region" aria-label="Permissão de trabalho" aria-busy={writePending}>
    {agendaOrigin && <nav aria-label="Caminho da PT" className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-6 text-slate-500 [overflow-wrap:anywhere]">
      <Link to={`/app/agenda${agendaOrigin.search}`} className="inline-flex min-h-11 items-center">Agenda</Link><span aria-hidden="true">/</span>
      <Link to={`/app/agenda/${encodeURIComponent(permit.appointment.id)}`} state={appointmentState} className="inline-flex min-h-11 items-center">Atendimento {permit.appointment.code}</Link><span aria-hidden="true">/</span>
      <span aria-current="page">{permit.code}</span>
    </nav>}
    <PageHeader eyebrow={`${permit.code} · VERSÃO ${permit.version}`} title={permit.appointment.serviceLabel} description="Atendimento digital, da conferência em campo à revisão do encerramento." actions={<div className="actions">{canDownloadFinalPdf && <Button variant="secondary" onClick={downloadFinalPdf} disabled={isDownloadingPdf}><Download size={14} aria-hidden="true" /> {isDownloadingPdf ? 'Baixando…' : 'Baixar PDF final'}</Button>}<Link className="button button--secondary !min-h-11" to={`/app/pts/${id}/imprimir`} state={returnOrigin}>Visualizar / imprimir PT</Link><Link className="button button--ghost !min-h-11" to={backTarget} state={backState}>{backLabel}</Link></div>} />
    {writePending && <p className="muted" role="status">Registrando a ação. Aguarde a confirmação antes de mudar de tela ou unidade.</p>}
    {notice && <Feedback tone="success">{notice}</Feedback>}
    {!command && (localError || writeError) && <Feedback tone="danger">{localError || writeError}{(conflict || staleForm) && <div className="actions"><Button variant="secondary" onClick={reloadCurrent}>Carregar versão atual para conferir</Button></div>}</Feedback>}
    <section className={`panel ${styles.context}`} aria-label="Contexto da permissão de trabalho">
      <div className={styles.contextHeader}><PermitStatus operationStatus={permit.operationStatus} reviewStatus={permit.reviewStatus} /><Badge tone={currentScienceCount === permit.appointment.participants.length ? 'success' : 'warning'}>Ciências {currentScienceCount}/{permit.appointment.participants.length}</Badge></div>
      <dl className={styles.contextGrid}><div><dt>Local</dt><dd>{permit.appointment.location}</dd></div><div><dt>Equipe</dt><dd>{permit.appointment.teamName}</dd></div><div><dt>Responsável operacional</dt><dd>{permit.appointment.responsibleName}</dd></div><div><dt>Período agendado</dt><dd>{formatDate(permit.appointment.startsAt)} até {formatDate(permit.appointment.endsAt)}</dd></div><div><dt>Modelo utilizado</dt><dd>{permit.templateVersion}</dd></div><div><dt>Agendamento de origem</dt><dd>{can('appointments.read') ? <Link to={`/app/agenda/${encodeURIComponent(permit.appointment.id)}`} state={appointmentState}>{permit.appointment.code}</Link> : permit.appointment.code}</dd></div></dl>
      <ServiceTemplates templates={permit.serviceTemplates} />
    </section>
    <PermitOrientation key={`${permit.id}:${permit.version}`} guidance={guidance} sections={sections} initialHash={formBase?.id === permit.id ? location.hash : ''} />
    {permit.reviewStatus === 'RETURNED' && <Feedback tone="warning">A revisão foi devolvida: {permit.reviewComment || 'Consulte o motivo no histórico.'} A atividade continua concluída. Uma correção cria uma nova versão documental, sem iniciar novamente a execução.</Feedback>}
    {correction && <Feedback tone="info">Versão {permit.version} em correção documental. Confira o conteúdo e registre novas ciências antes de reapresentar. A operação permanece concluída.</Feedback>}

    <div id="preparacao">{preparation ? <PermitPreparation key={`${permit.id}:${permit.version}`} value={preparation} editable={has('EDIT_PREPARATION')} pending={writePending || staleForm} dirty={preparationDirty} onChange={value => { setPreparation(value); setNotice(''); }} onSubmit={savePreparation} /> : <section className="panel stack" aria-label="Preparação do modelo PT"><h2>Preparação da PT</h2><Feedback tone="info">Exemplo anterior à digitalização do modelo: esta PT não contém preparação estruturada da planilha recebida.</Feedback></section>}</div>

    <section id="conferencia" className="panel stack" aria-labelledby="checklist-title">
      <div className={styles.sectionHeader}><div><span className={styles.sectionIcon}><ClipboardCheck size={20} aria-hidden="true" /></span><h2 id="checklist-title">Conferência do atendimento</h2><p className="muted">Checklist · {permit.templateVersion}</p></div>{!canEdit && <Badge><LockKeyhole size={12} aria-hidden="true" /> Conteúdo preservado</Badge>}</div>
      <PermitChecklist key={`${permit.id}:${permit.version}`} items={checklist} editable={canEdit} pending={writePending} dirty={checklistDirty} stale={staleForm} onChange={editItem} onSubmit={saveChecklist} />
    </section>

    <section id="requisitos" className="panel stack" aria-labelledby="eligibility-title">
      <div className={styles.sectionHeader}><div><span className={styles.sectionIcon}><ShieldCheck size={20} aria-hidden="true" /></span><h2 id="eligibility-title">Requisitos por participante</h2><p className="muted">Matriz {permit.eligibility.requirementVersion} · última consulta {formatDate(permit.eligibility.checkedAt)}</p></div><Badge tone={permit.eligibility.eligible ? 'success' : 'danger'}>{permit.eligibility.eligible ? 'Requisitos documentais atendidos' : 'Há pendências impeditivas'}</Badge></div>
      <p className="muted">A função desempenhada no serviço determina os requisitos. Receber um arquivo não significa conferi-lo. A liberação e o início consultam novamente a situação vigente.</p>
      <div className={styles.participantGrid}>{permit.eligibility.participants.map(participant => <article key={participant.workerId} className={styles.participantCard}><div className={styles.cardTop}><div><h3>{participant.name}</h3><p className="muted">Função no serviço: {participant.serviceFunction}</p></div><Badge tone={participant.eligible ? 'success' : 'danger'}>{participant.eligible ? 'Conferido' : 'Pendente'}</Badge></div><ul className={styles.requirements}>{participant.items.map(item => <li key={item.requirementId}><div><strong>{item.label}</strong><Badge tone={evidenceTones[item.status] || 'neutral'}>{evidenceLabels[item.status] || item.status}</Badge></div><p className="muted">{item.reason || item.description}</p>{item.restricted ? <p className="muted"><LockKeyhole size={12} aria-hidden="true" /> Requisito com acesso restrito. Apenas a situação operacional permitida é exibida.</p> : item.validUntil && <p className="muted">Validade da evidência conforme a matriz: {formatDate(item.validUntil)}</p>}</li>)}</ul></article>)}</div>
      <div className="actions">{can('appointments.read') && <Link to={`/app/agenda/${encodeURIComponent(permit.appointment.id)}`} state={appointmentState} className="button button--secondary">Consultar pendências e evidências</Link>}<Button variant="ghost" onClick={() => permitQuery.refetch()} disabled={permitQuery.isFetching || writePending}>Atualizar conferência</Button></div>
    </section>

    <section id="ciencias" className="panel stack" aria-labelledby="sciences-title">
      <div className={styles.sectionHeader}><div><span className={styles.sectionIcon}><Users size={20} aria-hidden="true" /></span><h2 id="sciences-title">Ciência dos participantes</h2><p className="muted">Declarações referentes à PT {permit.code}, versão {permit.version}.</p></div><Badge tone={currentScienceCount === permit.appointment.participants.length ? 'success' : 'warning'}>{currentScienceCount}/{permit.appointment.participants.length} registradas</Badge></div>
      <p className="muted">A manifestação confirma a ciência sobre o registro apresentado. Não substitui capacitação, conferência documental ou liberação da atividade.</p>
      <div className={styles.participantGrid}>{permit.appointment.participants.map(participant => {
        const science = currentSciences.find(item => item.workerId === participant.workerId);
        return <article key={participant.workerId} className={styles.participantCard}><h3>{participant.name}</h3><p className="muted">{participant.serviceFunction}</p>{science ? <ScienceEvidence science={science} /> : <><Badge tone="warning">Ciência pendente</Badge>{has('COLLECT_SCIENCE') && <Button variant="secondary" onClick={() => open('science', participant.workerId)} disabled={writePending || checklistDirty || preparationDirty}>Registrar ciência de {participant.name}</Button>}</>}</article>;
      })}</div>
      {canEdit && (permit.operationStatus === 'VERIFICATION' || correction) && (
        <div className="actions" style={{ marginTop: '0.5rem' }}>
          <Button variant="secondary" onClick={openParticipantsModal} disabled={writePending}>
            <Users size={14} aria-hidden="true" /> Alterar participantes da equipe
          </Button>
        </div>
      )}
      {checklistDirty && <Feedback tone="warning">Salve as respostas do checklist antes de coletar ciência desta versão.</Feedback>}
      {preparationDirty && <Feedback tone="warning">Salve a preparação do modelo antes de coletar ciência desta versão.</Feedback>}
    </section>

    <DesignationCoveragePanel
      sectionId="designacao"
      unitId={permit.appointment.unitId}
      serviceTypeIds={serviceTypeIds}
      location={permit.appointment.location}
      responsibleId={permit.appointment.responsibleId}
    />

    <section id="operacao" className="panel stack" aria-labelledby="operation-title">
      <div className={styles.sectionHeader}><div><span className={styles.sectionIcon}><Clock size={20} aria-hidden="true" /></span><h2 id="operation-title">Liberação e execução</h2><p className="muted">Abrir o atendimento inicia a verificação. Liberar e iniciar são ações distintas.</p></div></div>
      {['VERIFICATION', 'RELEASED', 'SUSPENDED'].includes(permit.operationStatus) && blockers.length > 0 && <Feedback tone="warning"><strong>Antes de continuar:</strong><ul className={styles.blockers}>{blockers.map(blocker => <li key={blocker}>{blocker}</li>)}</ul></Feedback>}
      <dl className={styles.contextGrid}><div><dt>Liberação registrada</dt><dd>{permit.releasedAt ? formatDate(permit.releasedAt) : 'Ainda não registrada'}</dd></div><div><dt>Início da execução</dt><dd>{permit.startedAt ? formatDate(permit.startedAt) : 'Ainda não registrado'}</dd></div><div><dt>Conclusão operacional</dt><dd>{permit.completedAt ? formatDate(permit.completedAt) : 'Ainda não registrada'}</dd></div></dl>
      <div className="actions">{has('RELEASE') && <Button onClick={() => open('release')} disabled={writePending || checklistDirty || preparationDirty || blockers.length > 0}>Liberar execução</Button>}{has('START') && <Button onClick={() => open('start')} disabled={writePending || blockers.length > 0}>Registrar início da execução</Button>}</div>
      {!has('RELEASE') && !has('START') && permit.operationStatus === 'VERIFICATION' && <p className="muted">A liberação fica disponível somente ao responsável operacional designado para este serviço e local.</p>}
      {permit.operationStatus === 'EXECUTING' && <Feedback tone="info">Execução em andamento desde {formatDate(permit.startedAt)}. Registre o resumo para concluir o atendimento e enviar seu encerramento ao responsável pela revisão.</Feedback>}
      {permit.operationStatus === 'COMPLETED' && <Feedback tone="info">A atividade está concluída. A revisão final e eventuais correções tratam do registro documental e não autorizam retrospectivamente a execução.</Feedback>}
    </section>

    <PermitLifecycleActions sectionId="interrupcao" permit={permit} disabled={mutation.isPending || attachmentsBusy || Boolean(command)} onBusyChange={setLifecycleBusy} />
    <PermitAttachments sectionId="anexos" permit={permit} disabled={formDirty || summaryDirty || mutation.isPending || lifecycleBusy || participantsMutation.isPending || Boolean(command)} onBusyChange={setAttachmentsBusy} />

    <section id="encerramento" className="panel stack" aria-labelledby="completion-title">
      <div className={styles.sectionHeader}><div><span className={styles.sectionIcon}><FileCheck2 size={20} aria-hidden="true" /></span><h2 id="completion-title">Encerramento do atendimento</h2><p className="muted">Resumo, versão enviada e pendências da revisão.</p></div></div>
      {permit.preparation && <details open={has('COMPLETE') || correction || closingDirty} className={styles.snapshot} aria-label="Checklist de encerramento do modelo"><summary>Checklist de encerramento do modelo · {closingChecks.filter(item => item.answer !== null).length}/{closingChecks.length}</summary><p className="muted">Registre Sim, Não ou Não aplicável por item e justifique Não / Não aplicável. O encerramento preserva o estado registrado; novas pendências devem constar no resumo e na revisão.</p><SourceChecks checks={closingChecks} disabled={writePending || staleForm || !canWriteSummary} prefix="closing" onChange={setClosingChecks} /></details>}
      {canWriteSummary || preservedSummaryDraft ? <><Field label="Resumo do atendimento"><textarea aria-label="Resumo do atendimento" value={summary} disabled={writePending || !canWriteSummary} onChange={event => { setSummary(event.target.value); setNotice(''); }} maxLength={4000} rows={5} placeholder="Descreva o atendimento realizado, o resultado e as observações para a revisão." /></Field>{preservedSummaryDraft && <Feedback>Rascunho local preservado. Este resumo ainda não foi enviado e pode ser consultado durante a suspensão ou após o cancelamento.</Feedback>}{canWriteSummary && <div className="actions"><Button onClick={() => open(correction ? 'submit-correction' : 'complete')} disabled={writePending || staleForm || checklistDirty || preparationDirty || (correction && !has('SUBMIT_CORRECTION'))}>{correction ? 'Reapresentar correção para revisão' : 'Concluir atividade e enviar para revisão'}</Button><span className="muted">{correction && !has('SUBMIT_CORRECTION') ? 'Confira o checklist e registre todas as ciências para habilitar a reapresentação.' : 'O envio preserva uma cópia desta versão.'}</span></div>}</> : permit.summary ? <p className={styles.preserveText}>{permit.summary}</p> : <EmptyState title="Encerramento ainda não enviado" description="O resumo ficará disponível após a conclusão pelo responsável operacional." />}
      {has('NEW_VERSION') && <Button variant="secondary" disabled={writePending} onClick={() => open('new-version')}>Criar versão de correção</Button>}
    </section>

    <section id="revisao" className="panel stack" aria-labelledby="review-title">
      <div className={styles.sectionHeader}><div><span className={styles.sectionIcon}><Check size={20} aria-hidden="true" /></span><h2 id="review-title">Revisão final e versões</h2><p className="muted">Decisão explícita sobre uma versão identificada do encerramento.</p></div></div>
      <PermitStatus operationStatus={permit.operationStatus} reviewStatus={permit.reviewStatus} />
      {has('REVIEW') && <div className="actions"><Button disabled={writePending} onClick={() => open('review')}>Revisar encerramento da versão {permit.version}</Button><span className="muted">Consulte a versão enviada antes de aprovar ou devolver.</span></div>}

      {canDownloadFinalPdf && (
        <div className="panel stack" style={{ background: 'var(--color-bg-subtle, #f8fafc)', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '1rem' }}>PDF da versão aprovada</h3>
              <p className="muted" style={{ margin: '4px 0 0', fontSize: '0.85rem' }}>
                Consulte ou baixe o arquivo da versão aprovada.
              </p>
            </div>
            <Button variant="secondary" onClick={downloadFinalPdf} disabled={isDownloadingPdf}>
              <Download size={14} aria-hidden="true" /> {isDownloadingPdf ? 'Baixando PDF…' : 'Baixar PDF final'}
            </Button>
          </div>
          {pdfDisclaimer && <Feedback tone="info">{pdfDisclaimer}</Feedback>}
          <small className="muted">
            Aviso de integridade: a imutabilidade e custódia legal do documento final dependem da persistência pelo backend do SESMT.
          </small>
        </div>
      )}

      {permit.snapshots.length ? <div className="stack">{[...permit.snapshots].reverse().map(snapshot => <Snapshot key={snapshot.version} snapshot={snapshot} current={snapshot.version === permit.version} />)}</div> : <p className="muted">Nenhuma versão foi enviada para revisão.</p>}
    </section>

    <section id="historico" className="panel stack" aria-labelledby="history-title"><h2 id="history-title">Histórico do atendimento</h2><ol className={styles.timeline}>{[...permit.history].reverse().map(event => <li key={event.id}><span className={styles.timelineDot} /><div><strong>{eventLabels[event.action] || event.action.replace(/_/g, ' ')}</strong><p className="muted">{event.actorName} · {formatDate(event.occurredAt)}{event.version && ` · versão ${event.version}`}</p>{event.reason && <p className={styles.preserveText}>{event.reason}</p>}</div></li>)}</ol></section>

    <Modal open={Boolean(command)} title={command ? commandLabels[command] : ''} onClose={close}>
      {command && <form onSubmit={submit} className="stack">
        <p className="muted">{permit.code} · versão {intent?.version} · {permit.appointment.location}</p>
        {staleIntent && <Feedback tone="warning">O registro foi atualizado enquanto esta janela estava aberta. Feche a janela, confira a versão atual e abra a ação novamente.</Feedback>}
        {(localError || writeError) && <Feedback tone="danger">{localError || writeError}{conflict && <p>Feche esta janela e carregue a versão atual antes de decidir novamente.</p>}</Feedback>}
        <fieldset className={styles.preparationFieldset} disabled={writePending} aria-label="Dados da confirmação">
        {command === 'science' && <>
          <Feedback tone="info">Declarante: <strong>{selectedParticipant?.name}</strong>. Coletor autenticado: <strong>{me?.user.displayName}</strong>. A conta utilizada no aparelho não autentica automaticamente o participante.</Feedback>
          <p>Declaração de ciência: “Visualizei o contexto, a preparação e o checklist da PT {permit.code}, versão {permit.version}, e confirmo minha ciência sobre este registro.”</p>
          <Field label="Nome de quem declara"><input aria-label="Nome de quem declara" value={declarantName} onChange={event => { setDeclarantName(event.target.value); setConfirmed(false); }} autoComplete="off" maxLength={160} /></Field>
          <fieldset className={styles.methodChoices}><legend>Forma da manifestação</legend><label><input type="radio" name="science-method" checked={method === 'TYPED'} onChange={() => { setMethod('TYPED'); setDrawing(''); setConfirmed(false); }} />Nome digitado</label><label><input type="radio" name="science-method" checked={method === 'DRAWN'} onChange={() => { setMethod('DRAWN'); setDrawing(''); setConfirmed(false); }} />Desenho</label></fieldset>
          {method === 'DRAWN' ? <SignaturePad key={`${workerId}-${method}`} disabled={writePending} onChange={value => { setDrawing(value); setConfirmed(false); }} /> : <div className={styles.typedRepresentation}>{declarantName || 'Nome do participante'}</div>}
          <label className={styles.confirmation}><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span>O participante {selectedParticipant?.name} confirma a declaração apresentada e o registro de sua manifestação nesta versão.</span></label>
          <p className="muted">Representação visual com identificação declarada. Não constitui verificação forte de identidade ou assinatura criptográfica.</p>
        </>}
        {command === 'release' && <><Feedback tone="warning">A liberação registra a autorização operacional anterior ao início. O servidor precisa conferir novamente designação, checklist, ciências e requisitos documentais vigentes.</Feedback><label className={styles.confirmation}><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span>Como responsável designado, confirmo a liberação desta versão nas condições do serviço apresentado.</span></label></>}
        {command === 'start' && <><Feedback tone="info">Existe uma liberação registrada em {formatDate(permit.releasedAt)}. Os requisitos serão revalidados nesta ação; pendências novas impedem o início.</Feedback><label className={styles.confirmation}><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span>Confirmo o início da execução dentro das condições da liberação registrada.</span></label></>}
        {(command === 'complete' || command === 'submit-correction') && <><h3>Resumo que será enviado</h3><p className={styles.preserveText}>{summary || 'Preencha o resumo do atendimento antes de confirmar.'}</p><Feedback tone="info">{command === 'submit-correction' ? 'A nova versão documental será reapresentada. A atividade permanece concluída.' : 'A atividade será marcada como concluída, e esta versão será enviada para a revisão final.'} O envio não aplica a representação de assinatura do engenheiro.</Feedback><label className={styles.confirmation}><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span>Conferi o registro da versão {permit.version} e confirmo seu envio para revisão.</span></label></>}
        {command === 'new-version' && <><Feedback tone="info">A versão anterior permanece preservada. Uma nova versão documental permitirá corrigir o checklist e registrar novas ciências, sem reabrir a execução.</Feedback><Field label="Motivo da correção"><textarea aria-label="Motivo da correção" value={comment} onChange={event => { setComment(event.target.value); setConfirmed(false); }} maxLength={4000} /></Field><label className={styles.confirmation}><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span>Confirmo a criação de uma nova versão documental para atender à devolução.</span></label></>}
        {command === 'review' && <>
          <Feedback tone="info">Você está decidindo sobre o encerramento da versão {permit.version}. A revisão acontece após a conclusão da atividade; não substitui a liberação inicial.</Feedback>
          <Field label="Decisão da revisão">
            <select aria-label="Decisão da revisão" value={decision} onChange={event => { setDecision(event.target.value as 'APPROVE' | 'RETURN'); changeReviewMethod('TYPED'); }}>
              <option value="APPROVE">Aprovar encerramento</option>
              <option value="RETURN">Devolver para correção</option>
            </select>
          </Field>
          <Field label={decision === 'RETURN' ? 'Motivo da devolução' : 'Observação da revisão (opcional)'}>
            <textarea aria-label={decision === 'RETURN' ? 'Motivo da devolução' : 'Observação da revisão (opcional)'} value={comment} onChange={event => { setComment(event.target.value); setConfirmed(false); }} maxLength={4000} />
          </Field>
          {decision === 'APPROVE' && <>
            <div className="panel stack">
              <h3>Representação pessoal reutilizável</h3>
              {profileQuery.isPending ? <p role="status">Carregando sua representação pessoal…</p> : profileQuery.isError ? <><Feedback tone="warning">Não foi possível conferir seu perfil pessoal. Você pode registrar a representação apenas nesta revisão.</Feedback><Button variant="secondary" onClick={() => void profileQuery.refetch()}>Carregar representação pessoal</Button></> : ownProfile ? <><p>{ownProfile.representation} · perfil v{ownProfile.version} · {ownProfile.method === 'TYPED' ? 'Nome digitado' : ownProfile.method === 'DRAWN' ? 'Desenho' : 'Imagem'}</p><Button variant="secondary" disabled={writePending || profileQuery.isFetching} onClick={selectPersonalProfile}>Usar representação pessoal salva</Button></> : <p className="muted">Você ainda não possui um perfil pessoal salvo.</p>}
              <Link to="/app/minha-representacao">Gerenciar minha representação</Link>
              {reviewProfile && <><p role="status">Perfil pessoal v{reviewProfile.version} selecionado. A cópia será preservada nesta decisão.</p>{reviewProfile.image ? <img src={reviewProfile.image} alt="Representação pessoal selecionada" className={styles.signatureImage} /> : <p className={styles.typedRepresentation}>{reviewProfile.representation}</p>}<Button variant="secondary" onClick={() => changeReviewMethod('TYPED')}>Usar representação apenas nesta revisão</Button></>}
            </div>
            {!reviewProfile && <>
            <fieldset className={styles.methodChoices}>
              <legend>Forma da representação do engenheiro</legend>
              <label>
                <input type="radio" name="review-signature-method" checked={reviewMethod === 'TYPED'} onChange={() => changeReviewMethod('TYPED')} />
                Nome digitado
              </label>
              <label>
                <input type="radio" name="review-signature-method" checked={reviewMethod === 'DRAWN'} onChange={() => changeReviewMethod('DRAWN')} />
                Desenho
              </label>
              <label>
                <input type="radio" name="review-signature-method" checked={reviewMethod === 'IMAGE'} onChange={() => changeReviewMethod('IMAGE')} />
                Upload de imagem
              </label>
            </fieldset>

            {reviewMethod === 'DRAWN' && (
              <div>
                <p className="muted" style={{ marginBottom: '6px' }}>Desenhe sua assinatura no quadro:</p>
                <SignaturePad key="review-signature-pad" disabled={writePending} onChange={value => { setReviewDrawing(value); setConfirmed(false); }} />
              </div>
            )}

            {reviewMethod === 'IMAGE' && (
              <div>
                <Field label="Imagem da assinatura (PNG/JPEG até 2 MB)">
                  <input
                    type="file"
                    accept="image/png,image/jpeg"
                    aria-label="Upload de imagem da rubrica"
                    disabled={writePending}
                    onChange={selectReviewImage}
                  />
                </Field>
                {reviewImageName && <small className="muted">Arquivo selecionado: {reviewImageName}</small>}
                {readingReviewImage && <p className="muted" role="status">Lendo a imagem selecionada…</p>}
              </div>
            )}

            <div style={{ marginTop: '0.75rem', marginBottom: '0.75rem', border: '1px solid var(--border)', borderRadius: '8px', padding: '12px' }}>
              <p style={{ margin: '0 0 8px 0', fontSize: '0.85rem', fontWeight: 600 }}>Prévia da representação visual do engenheiro:</p>
              {reviewMethod === 'TYPED' && <div className={styles.typedRepresentation}>{me?.user.displayName}</div>}
              {reviewMethod === 'DRAWN' && (reviewDrawing ? <img src={reviewDrawing} alt="Prévia da assinatura desenhada" className={styles.signatureImage} /> : <p className="muted" style={{ fontStyle: 'italic', margin: 0 }}>Desenho da assinatura pendente</p>)}
              {reviewMethod === 'IMAGE' && (reviewImage ? <img src={reviewImage} alt="Prévia da imagem da assinatura" className={styles.signatureImage} onError={() => { setReviewImage(''); setReviewImageName(''); setConfirmed(false); setLocalError('A imagem selecionada não pode ser exibida. Escolha um PNG ou JPEG válido.'); }} /> : <p className="muted" style={{ fontStyle: 'italic', margin: 0 }}>Nenhuma imagem carregada</p>)}
            </div>
            </>}

            <p className="muted">A representação visual será gravada no snapshot da versão {permit.version}. Não constitui certificado ICP-Brasil ou assinatura digital certificada.</p>
          </>}
          <label className={styles.confirmation}>
            <input type="checkbox" checked={confirmed} disabled={readingReviewImage} onChange={event => setConfirmed(event.target.checked)} />
            <span>{decision === 'APPROVE' ? `Eu, ${me?.user.displayName}, conferi a versão ${permit.version} e confirmo sua aprovação, com minha representação nesta decisão.` : `Confirmo a devolução da versão ${permit.version} pelo motivo informado, mantendo a atividade concluída.`}</span>
          </label>
        </>}
        </fieldset>
        <div className="actions"><Button type="submit" disabled={writePending || readingReviewImage || conflict || staleIntent}>{writePending ? 'Registrando…' : command === 'review' ? decision === 'APPROVE' ? 'Confirmar aprovação' : 'Confirmar devolução' : 'Confirmar ação'}</Button><Button variant="secondary" onClick={close} disabled={writePending}>Cancelar</Button></div>
      </form>}
    </Modal>

    <Modal open={isEditingParticipants} title="Alterar participantes da equipe" onClose={() => { if (!writePending) setIsEditingParticipants(false); }}>
      <form onSubmit={saveParticipantsChange} className="stack">
        <p className="muted">Equipe: {permit.appointment.teamName} · Local: {permit.appointment.location}</p>
        <Feedback tone="warning">
          A alteração de participantes revoga ciências existentes de membros que forem removidos e exige revalidação documental completa antes da liberação.
        </Feedback>
        <div className="stack" style={{ gap: '0.5rem' }}>
          <h4>Participantes disponíveis na equipe</h4>
          {availableTeamMembers.map(member => {
            const isSelected = selectedParticipants.some(p => p.workerId === member.workerId);
            const currentSelected = selectedParticipants.find(p => p.workerId === member.workerId);
            return (
              <div key={member.workerId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', border: '1px solid var(--border)', padding: '10px 14px', borderRadius: '8px', flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={e => {
                      if (e.target.checked) {
                        setSelectedParticipants([...selectedParticipants, { workerId: member.workerId, name: member.name, serviceFunction: member.serviceFunction }]);
                      } else {
                        setSelectedParticipants(selectedParticipants.filter(p => p.workerId !== member.workerId));
                      }
                      setConfirmedParticipantsChange(false);
                    }}
                  />
                  <span><strong>{member.name}</strong> <small className="muted">({member.serviceFunction})</small></span>
                </label>
                {isSelected && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <label style={{ fontSize: '0.85rem' }} htmlFor={`func-${member.workerId}`}>Função:</label>
                    <input
                      id={`func-${member.workerId}`}
                      value={currentSelected?.serviceFunction || ''}
                      aria-label={`Função no serviço de ${member.name}`}
                      onChange={e => {
                        const val = e.target.value;
                        setSelectedParticipants(selectedParticipants.map(p => p.workerId === member.workerId ? { ...p, serviceFunction: val } : p));
                      }}
                      style={{ width: '160px' }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <Field label="Motivo da alteração de participantes">
          <textarea
            aria-label="Motivo da alteração de participantes"
            value={participantsReason}
            onChange={e => setParticipantsReason(e.target.value)}
            rows={3}
            maxLength={1000}
            placeholder="Informe a justificativa operacional para a troca ou ajuste da equipe neste atendimento."
          />
        </Field>
        <label className={styles.confirmation}>
          <input
            type="checkbox"
            checked={confirmedParticipantsChange}
            onChange={e => setConfirmedParticipantsChange(e.target.checked)}
          />
          <span>Confirmo a atualização da composição da equipe, ciente da renovação das ciências e revalidação dos requisitos documentais.</span>
        </label>
        <div className="actions">
          <Button type="submit" disabled={writePending || !confirmedParticipantsChange || !participantsReason.trim() || selectedParticipants.length === 0}>
            {writePending ? 'Salvando…' : 'Confirmar alteração de participantes'}
          </Button>
          <Button variant="secondary" onClick={() => setIsEditingParticipants(false)} disabled={writePending}>
            Cancelar
          </Button>
        </div>
      </form>
    </Modal>
  </div>;
}


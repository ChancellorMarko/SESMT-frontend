import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { Check, ClipboardCheck, Clock, FileCheck2, LockKeyhole, ShieldCheck, Users } from 'lucide-react';
import { api, ApiError, revisionEtag } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { ChecklistItemDto, PermitPreparationDto, PermitSnapshotDto, PermitSourceCheckDto, ScienceDto, WorkPermitDto } from '../../shared/contracts/work-permits';
import type { ServiceTemplateVersionDto } from '../../shared/contracts/service-templates';
import { formatDate } from '../../shared/lib/format';
import { Badge, Button, EmptyState, Feedback, Field, Modal, PageHeader, Spinner, type Tone } from '../../shared/ui';
import { PermitStatus } from './PermitStatus';
import { SignaturePad } from './SignaturePad';
import { PermitPreparation, SourceChecks } from './PermitPreparation';
import { PermitAttachments } from './PermitAttachments';
import { PermitLifecycleActions } from './PermitLifecycleActions';
import { validatePreparation, validateSourceChecks } from './templates/ri-s-36001';
import { errorMessage, isDrawingRepresentation, releaseBlockers, validateChecklist, validateScience, validateText } from './validation';
import { permitEventLabels as eventLabels } from './event-labels';
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
      {snapshot.decision && <div className={styles.reviewRecord}><h3>{snapshot.decision === 'APPROVE' ? 'Aprovação do encerramento' : 'Devolução do encerramento'}</h3><p>{snapshot.reviewedBy} · {formatDate(snapshot.reviewedAt)}</p>{snapshot.comment && <p className={styles.preserveText}>{snapshot.comment}</p>}{snapshot.signatureRepresentation && <><p className={styles.typedRepresentation}>{snapshot.signatureRepresentation}</p><p className="muted">Representação associada à decisão explícita nesta versão. Não representa assinatura criptográfica.</p></>}</div>}
    </div>
  </details>;
}

export function PermitDetailPage() {
  const { id } = useParams();
  const { me, sessionKey, unitId, can } = useSession();
  const client = useQueryClient();
  const permitQuery = useQuery({ queryKey: ['work-permit', sessionKey, unitId, id], queryFn: ({ signal }) => api.get<WorkPermitDto>(`/work-permits/${id}`, { signal }) });
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
  const permit = permitQuery.data;
  const operatorAuthorized = Boolean(permit && can('permits.operate') && permit.appointment.responsibleId === me?.user.id);
  const correctionDraft = Boolean(permit && permit.operationStatus === 'COMPLETED' && permit.reviewStatus === 'NOT_SUBMITTED' && permit.snapshots.length > 0 && permit.version > Math.max(...permit.snapshots.map(snapshot => snapshot.version)));
  const checklistDirty = Boolean(permit && JSON.stringify(checklist) !== JSON.stringify(permit.checklist));
  const preparationDirty = Boolean(permit && JSON.stringify(preparation) !== JSON.stringify(permit.preparation));
  const closingDirty = Boolean(permit?.preparation && JSON.stringify(closingChecks) !== JSON.stringify(permit.preparation.closingChecks));
  const formDirty = checklistDirty || preparationDirty || closingDirty;
  const summaryDirty = Boolean(permit && operatorAuthorized && summary !== (permit.summary || '') && (['EXECUTING', 'SUSPENDED', 'CANCELED'].includes(permit.operationStatus) || correctionDraft));
  useEffect(() => { setCommand(undefined); setIntent(undefined); setFormBase(null); setLocalError(''); setNotice(''); }, [id, sessionKey, unitId]);

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
    void Promise.all(['work-permit', 'work-permits', 'appointments', 'appointment', 'permit-dashboard', 'pt-dashboard', 'eligibility', 'documentary-readiness'].map(key => client.invalidateQueries({ queryKey: [key] })));
  }, onError: error => {
    if (error instanceof ApiError && ['DOCUMENTARY_BLOCK', 'CHECKLIST_PENDING', 'SCIENCES_PENDING'].includes(error.code)) void client.invalidateQueries({ queryKey: ['work-permit', sessionKey, unitId, id] });
  } });
  const writePending = mutation.isPending || attachmentsBusy || lifecycleBusy;
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
    setCommand(next); setConfirmed(false); setComment(''); setDecision('APPROVE'); setLocalError(''); setDrawing(''); setMethod('TYPED'); mutation.reset();
    const participant = permit?.appointment.participants.find(item => item.workerId === participantId);
    setWorkerId(participant?.workerId || ''); setDeclarantName(participant?.name || '');
  }
  function close() { if (!writePending) { setCommand(undefined); setIntent(undefined); setLocalError(''); mutation.reset(); } }
  async function saveChecklist(event: FormEvent) {
    event.preventDefault(); if (writePending) return; setLocalError(''); mutation.reset();
    const error = validateChecklist(checklist);
    if (error) { setLocalError(error); return; }
    try { await mutation.mutateAsync({ command: 'checklist', body: { items: checklist } }); } catch { /* Keep the answers for correction. */ }
  }
  async function savePreparation(event: FormEvent) {
    event.preventDefault(); if (writePending) return; setLocalError(''); mutation.reset();
    if (!preparation) return;
    const error = validatePreparation(preparation);
    if (error) { setLocalError(error); return; }
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
      const error = decision === 'RETURN' ? validateText(comment, 'Motivo da devolução') : comment.length > 4000 ? 'A observação deve ter até 4.000 caracteres.' : undefined;
      if (error) { setLocalError(error); return; }
      if (!confirmed) { setLocalError('Confirme sua decisão sobre esta versão.'); return; }
      if (decision === 'APPROVE' && !me?.user.displayName) { setLocalError('Não foi possível identificar o responsável autenticado.'); return; }
      body = { decision, comment: comment.trim(), ...(decision === 'APPROVE' ? { signatureRepresentation: me!.user.displayName } : {}) };
    } else {
      if (!confirmed) { setLocalError('Confirme as condições desta ação antes de continuar.'); return; }
      if (checklistDirty || preparationDirty) { setLocalError('Salve o checklist e a preparação antes de continuar.'); return; }
    }
    try { await mutation.mutateAsync({ command, body }); } catch { /* Preserve the form and display the API error. */ }
  }

  if (permitQuery.isPending) return <Spinner />;
  if (permitQuery.isError || !permit) return <div className="panel stack"><Feedback tone="danger">{errorMessage(permitQuery.error)}</Feedback><Button variant="secondary" onClick={() => permitQuery.refetch()}>Tentar novamente</Button><Link to="/app/pts">Voltar às PTs</Link></div>;
  if (permit.appointment.unitId !== unitId) return <div className="panel stack"><EmptyState title="PT de outra unidade" description="Selecione a unidade deste atendimento para consultar seu conteúdo, ou volte à lista da unidade atual." /><Link to="/app/pts">Voltar às PTs</Link></div>;
  const actions = permit.availableActions;
  const has = (action: string) => actions.includes(action) && (action === 'REVIEW' ? can('permits.review') : operatorAuthorized);
  const canEdit = has('EDIT_CHECKLIST');
  const correction = correctionDraft;
  const currentSciences = permit.sciences.filter(science => science.version === permit.version);
  const blockers = releaseBlockers(permit);
  const selectedParticipant = permit.appointment.participants.find(participant => participant.workerId === workerId);
  const writeError = mutation.isError ? errorMessage(mutation.error) : '';
  const conflict = mutation.error instanceof ApiError && mutation.error.status === 412;
  const staleForm = formBase?.revision !== permit.revision;
  const canWriteSummary = has('COMPLETE') || correction && operatorAuthorized;
  const preservedSummaryDraft = summaryDirty && ['SUSPENDED', 'CANCELED'].includes(permit.operationStatus);
  const staleIntent = Boolean(command && intent && (intent.revision !== permit.revision || intent.version !== permit.version));
  const step = permit.operationStatus === 'CANCELED' ? -1 : permit.operationStatus === 'VERIFICATION' ? 0 : permit.operationStatus === 'RELEASED' ? 1 : permit.operationStatus === 'EXECUTING' ? 2 : permit.operationStatus === 'SUSPENDED' ? permit.lifecycle?.suspendedFrom === 'RELEASED' ? 1 : 2 : permit.reviewStatus === 'VALIDATED' ? 4 : 3;
  const editItem = (itemId: string, changes: Partial<ChecklistItemDto>) => { setChecklist(items => items.map(item => item.id === itemId ? { ...item, ...changes } : item)); setNotice(''); };

  return <div className="stack" role="region" aria-label="Permissão de trabalho" aria-busy={writePending}>
    <PageHeader eyebrow={`${permit.code} · VERSÃO ${permit.version}`} title={permit.appointment.serviceLabel} description="Atendimento digital, da conferência em campo à revisão do encerramento." actions={<div className="actions"><Link to={`/app/pts/${id}/imprimir`}>Visualizar / imprimir PT</Link><Link to="/app/pts">Voltar às PTs</Link></div>} />
    {writePending && <p className="muted" role="status">Registrando a ação. Aguarde a confirmação antes de mudar de tela ou unidade.</p>}
    {notice && <Feedback tone="success">{notice}</Feedback>}
    {!command && (localError || writeError) && <Feedback tone="danger">{localError || writeError}{(conflict || staleForm) && <div className="actions"><Button variant="secondary" onClick={reloadCurrent}>Carregar versão atual para conferir</Button></div>}</Feedback>}
    <section className={`panel ${styles.context}`} aria-label="Contexto da permissão de trabalho">
      <div className={styles.contextHeader}><PermitStatus operationStatus={permit.operationStatus} reviewStatus={permit.reviewStatus} /><Badge tone={currentSciences.length === permit.appointment.participants.length ? 'success' : 'warning'}>Ciências {currentSciences.length}/{permit.appointment.participants.length}</Badge></div>
      <dl className={styles.contextGrid}><div><dt>Local</dt><dd>{permit.appointment.location}</dd></div><div><dt>Equipe</dt><dd>{permit.appointment.teamName}</dd></div><div><dt>Responsável operacional</dt><dd>{permit.appointment.responsibleName}</dd></div><div><dt>Período agendado</dt><dd>{formatDate(permit.appointment.startsAt)} até {formatDate(permit.appointment.endsAt)}</dd></div><div><dt>Modelo utilizado</dt><dd>{permit.templateVersion}</dd></div><div><dt>Agendamento de origem</dt><dd><Link to={`/app/agenda/${permit.appointment.id}`}>{permit.appointment.code}</Link></dd></div></dl>
      <ServiceTemplates templates={permit.serviceTemplates} />
      <Feedback tone="warning">Modelo escolar ilustrativo. Os requisitos, o checklist e as designações desta demonstração precisam ser substituídos pelos procedimentos aprovados do SESMT antes do uso real.</Feedback>
    </section>
    <nav className={styles.steps} aria-label="Etapas da PT">{[['conferencia', 'Conferência'], ['operacao', 'Liberação'], ['operacao', 'Execução'], ['encerramento', 'Encerramento'], ['revisao', 'Revisão final']].map(([anchor, label], index) => <a key={label} href={`#${anchor}`} className={index === step ? styles.currentStep : index < step ? styles.finishedStep : ''} aria-current={index === step ? 'step' : undefined}><span>{index < step ? <Check size={14} aria-hidden="true" /> : index + 1}</span>{label}</a>)}</nav>
    {permit.reviewStatus === 'RETURNED' && <Feedback tone="warning">A revisão foi devolvida: {permit.reviewComment || 'Consulte o motivo no histórico.'} A atividade continua concluída. Uma correção cria uma nova versão documental, sem iniciar novamente a execução.</Feedback>}
    {correction && <Feedback tone="info">Versão {permit.version} em correção documental. Confira o conteúdo e registre novas ciências antes de reapresentar. A operação permanece concluída.</Feedback>}

    {preparation ? <PermitPreparation value={preparation} editable={has('EDIT_PREPARATION')} pending={writePending || staleForm} dirty={preparationDirty} onChange={value => { setPreparation(value); setNotice(''); }} onSubmit={savePreparation} /> : <Feedback tone="info">Exemplo anterior à digitalização do modelo: esta PT não contém preparação estruturada da planilha recebida.</Feedback>}

    <section id="conferencia" className="panel stack" aria-labelledby="checklist-title">
      <div className={styles.sectionHeader}><div><span className={styles.sectionIcon}><ClipboardCheck size={20} aria-hidden="true" /></span><h2 id="checklist-title">1. Conferência do atendimento</h2><p className="muted">Checklist ilustrativo · {permit.templateVersion}</p></div>{!canEdit && <Badge><LockKeyhole size={12} aria-hidden="true" /> Conteúdo preservado</Badge>}</div>
      <form onSubmit={saveChecklist} className="stack">
        {checklist.map((item, index) => <fieldset key={item.id} className={styles.checklistItem} disabled={!canEdit || writePending}><legend>{index + 1}. {item.label}{item.required && <span> (obrigatório)</span>}</legend>{item.serviceName && <p className="muted">{item.serviceName} · template v{item.templateVersion || 'não registrada'}</p>}<div className={styles.answerOptions}>{(['YES', 'NO'] as const).map(answer => <label key={answer}><input type="radio" name={`checklist-${item.id}`} checked={item.answer === answer} onChange={() => editItem(item.id, { answer })} />{answer === 'YES' ? 'Sim' : 'Não'}</label>)}</div>{item.blockingAnswers && <small className="muted">{item.blockingAnswers.length ? `Respostas impeditivas deste template: ${item.blockingAnswers.map(answer => answer === 'YES' ? 'Sim' : 'Não').join(', ')}.` : 'Este item registra a condição, sem resposta impeditiva configurada.'}</small>}{(canEdit || item.note) && <Field label={`Observação do item ${index + 1}`}><textarea aria-label={`Observação do item ${index + 1}`} value={item.note || ''} rows={2} maxLength={1000} placeholder={item.answer === 'NO' ? 'Explique a situação desta resposta.' : 'Observação, quando necessária.'} onChange={event => editItem(item.id, { note: event.target.value })} /></Field>}</fieldset>)}
        {canEdit && <div className="actions"><Button type="submit" disabled={writePending || !checklistDirty || staleForm}>Salvar checklist</Button><span className="muted" role="status">{checklistDirty ? 'Há respostas ainda não salvas.' : 'Respostas sincronizadas com esta versão.'}</span></div>}
      </form>
    </section>

    <section className="panel stack" aria-labelledby="eligibility-title">
      <div className={styles.sectionHeader}><div><span className={styles.sectionIcon}><ShieldCheck size={20} aria-hidden="true" /></span><h2 id="eligibility-title">2. Requisitos por participante</h2><p className="muted">Matriz {permit.eligibility.requirementVersion} · última consulta {formatDate(permit.eligibility.checkedAt)}</p></div><Badge tone={permit.eligibility.eligible ? 'success' : 'danger'}>{permit.eligibility.eligible ? 'Requisitos documentais atendidos' : 'Há pendências impeditivas'}</Badge></div>
      <p className="muted">A função desempenhada no serviço determina os requisitos. Receber um arquivo não significa conferi-lo. A liberação e o início consultam novamente a situação vigente.</p>
      <div className={styles.participantGrid}>{permit.eligibility.participants.map(participant => <article key={participant.workerId} className={styles.participantCard}><div className={styles.cardTop}><div><h3>{participant.name}</h3><p className="muted">Função no serviço: {participant.serviceFunction}</p></div><Badge tone={participant.eligible ? 'success' : 'danger'}>{participant.eligible ? 'Conferido' : 'Pendente'}</Badge></div><ul className={styles.requirements}>{participant.items.map(item => <li key={item.requirementId}><div><strong>{item.label}</strong><Badge tone={evidenceTones[item.status] || 'neutral'}>{evidenceLabels[item.status] || item.status}</Badge></div><p className="muted">{item.reason || item.description}</p>{item.restricted ? <p className="muted"><LockKeyhole size={12} aria-hidden="true" /> Requisito com acesso restrito. Apenas a situação operacional permitida é exibida.</p> : item.validUntil && <p className="muted">Validade da evidência conforme a matriz: {formatDate(item.validUntil)}</p>}</li>)}</ul></article>)}</div>
      <div className="actions"><Link to={`/app/agenda/${permit.appointment.id}`} className="button button--secondary">Consultar pendências e evidências</Link><Button variant="ghost" onClick={() => permitQuery.refetch()} disabled={permitQuery.isFetching || writePending}>Atualizar conferência</Button></div>
    </section>

    <section className="panel stack" aria-labelledby="sciences-title">
      <div className={styles.sectionHeader}><div><span className={styles.sectionIcon}><Users size={20} aria-hidden="true" /></span><h2 id="sciences-title">3. Ciência dos participantes</h2><p className="muted">Declarações referentes à PT {permit.code}, versão {permit.version}.</p></div><Badge tone={currentSciences.length === permit.appointment.participants.length ? 'success' : 'warning'}>{currentSciences.length}/{permit.appointment.participants.length} registradas</Badge></div>
      <p className="muted">A manifestação confirma a ciência sobre o registro apresentado. Não substitui capacitação, conferência documental ou liberação da atividade.</p>
      <div className={styles.participantGrid}>{permit.appointment.participants.map(participant => {
        const science = currentSciences.find(item => item.workerId === participant.workerId);
        return <article key={participant.workerId} className={styles.participantCard}><h3>{participant.name}</h3><p className="muted">{participant.serviceFunction}</p>{science ? <ScienceEvidence science={science} /> : <><Badge tone="warning">Ciência pendente</Badge>{has('COLLECT_SCIENCE') && <Button variant="secondary" onClick={() => open('science', participant.workerId)} disabled={writePending || checklistDirty || preparationDirty}>Registrar ciência de {participant.name}</Button>}</>}</article>;
      })}</div>
      {checklistDirty && <Feedback tone="warning">Salve as respostas do checklist antes de coletar ciência desta versão.</Feedback>}
      {preparationDirty && <Feedback tone="warning">Salve a preparação do modelo antes de coletar ciência desta versão.</Feedback>}
    </section>

    <section id="operacao" className="panel stack" aria-labelledby="operation-title">
      <div className={styles.sectionHeader}><div><span className={styles.sectionIcon}><Clock size={20} aria-hidden="true" /></span><h2 id="operation-title">4. Liberação e execução</h2><p className="muted">Abrir o atendimento inicia a verificação. Liberar e iniciar são ações distintas.</p></div></div>
      {['VERIFICATION', 'RELEASED', 'SUSPENDED'].includes(permit.operationStatus) && blockers.length > 0 && <Feedback tone="warning"><strong>Antes de continuar:</strong><ul className={styles.blockers}>{blockers.map(blocker => <li key={blocker}>{blocker}</li>)}</ul></Feedback>}
      <dl className={styles.contextGrid}><div><dt>Liberação registrada</dt><dd>{permit.releasedAt ? formatDate(permit.releasedAt) : 'Ainda não registrada'}</dd></div><div><dt>Início da execução</dt><dd>{permit.startedAt ? formatDate(permit.startedAt) : 'Ainda não registrado'}</dd></div><div><dt>Conclusão operacional</dt><dd>{permit.completedAt ? formatDate(permit.completedAt) : 'Ainda não registrada'}</dd></div></dl>
      <div className="actions">{has('RELEASE') && <Button onClick={() => open('release')} disabled={writePending || checklistDirty || preparationDirty || blockers.length > 0}>Liberar execução</Button>}{has('START') && <Button onClick={() => open('start')} disabled={writePending || blockers.length > 0}>Registrar início da execução</Button>}</div>
      {!has('RELEASE') && !has('START') && permit.operationStatus === 'VERIFICATION' && <p className="muted">A liberação fica disponível somente ao responsável operacional designado para este serviço e local.</p>}
      {permit.operationStatus === 'EXECUTING' && <Feedback tone="info">Execução em andamento desde {formatDate(permit.startedAt)}. Registre o resumo para concluir o atendimento e enviar seu encerramento ao responsável pela revisão.</Feedback>}
      {permit.operationStatus === 'COMPLETED' && <Feedback tone="info">A atividade está concluída. A revisão final e eventuais correções tratam do registro documental e não autorizam retrospectivamente a execução.</Feedback>}
    </section>

    <PermitLifecycleActions permit={permit} disabled={mutation.isPending || attachmentsBusy || Boolean(command)} onBusyChange={setLifecycleBusy} />
    <PermitAttachments permit={permit} disabled={formDirty || summaryDirty || writePending || Boolean(command)} onBusyChange={setAttachmentsBusy} />

    <section id="encerramento" className="panel stack" aria-labelledby="completion-title">
      <div className={styles.sectionHeader}><div><span className={styles.sectionIcon}><FileCheck2 size={20} aria-hidden="true" /></span><h2 id="completion-title">5. Encerramento do atendimento</h2><p className="muted">Resumo, versão enviada e pendências da revisão.</p></div></div>
      {permit.preparation && <details open={has('COMPLETE') || correction || closingDirty} className={styles.snapshot} aria-label="Checklist de encerramento do modelo"><summary>Checklist de encerramento do modelo · {closingChecks.filter(item => item.answer !== null).length}/{closingChecks.length}</summary><p className="muted">Registre Sim, Não ou Não aplicável por item e justifique Não / Não aplicável. O encerramento preserva o estado registrado; novas pendências devem constar no resumo e na revisão.</p><SourceChecks checks={closingChecks} disabled={writePending || staleForm || !canWriteSummary} prefix="closing" onChange={setClosingChecks} /></details>}
      {canWriteSummary || preservedSummaryDraft ? <><Field label="Resumo do atendimento"><textarea aria-label="Resumo do atendimento" value={summary} disabled={writePending || !canWriteSummary} onChange={event => { setSummary(event.target.value); setNotice(''); }} maxLength={4000} rows={5} placeholder="Descreva o atendimento realizado, o resultado e as observações para a revisão." /></Field>{preservedSummaryDraft && <Feedback>Rascunho local preservado. Este resumo ainda não foi enviado e pode ser consultado durante a suspensão ou após o cancelamento.</Feedback>}{canWriteSummary && <div className="actions"><Button onClick={() => open(correction ? 'submit-correction' : 'complete')} disabled={writePending || staleForm || checklistDirty || preparationDirty || (correction && !has('SUBMIT_CORRECTION'))}>{correction ? 'Reapresentar correção para revisão' : 'Concluir atividade e enviar para revisão'}</Button><span className="muted">{correction && !has('SUBMIT_CORRECTION') ? 'Confira o checklist e registre todas as ciências para habilitar a reapresentação.' : 'O envio preserva uma cópia desta versão.'}</span></div>}</> : permit.summary ? <p className={styles.preserveText}>{permit.summary}</p> : <EmptyState title="Encerramento ainda não enviado" description="O resumo ficará disponível após a conclusão pelo responsável operacional." />}
      {has('NEW_VERSION') && <Button variant="secondary" disabled={writePending} onClick={() => open('new-version')}>Criar versão de correção</Button>}
    </section>

    <section id="revisao" className="panel stack" aria-labelledby="review-title">
      <div className={styles.sectionHeader}><div><span className={styles.sectionIcon}><Check size={20} aria-hidden="true" /></span><h2 id="review-title">6. Revisão final e versões</h2><p className="muted">Decisão explícita sobre uma versão identificada do encerramento.</p></div></div>
      <PermitStatus operationStatus={permit.operationStatus} reviewStatus={permit.reviewStatus} />
      {has('REVIEW') && <div className="actions"><Button disabled={writePending} onClick={() => open('review')}>Revisar encerramento da versão {permit.version}</Button><span className="muted">Consulte a versão enviada antes de aprovar ou devolver.</span></div>}
      {permit.snapshots.length ? <div className="stack">{[...permit.snapshots].reverse().map(snapshot => <Snapshot key={snapshot.version} snapshot={snapshot} current={snapshot.version === permit.version} />)}</div> : <p className="muted">Nenhuma versão foi enviada para revisão.</p>}
    </section>

    <section className="panel stack" aria-labelledby="history-title"><h2 id="history-title">Histórico do atendimento</h2><ol className={styles.timeline}>{[...permit.history].reverse().map(event => <li key={event.id}><span className={styles.timelineDot} /><div><strong>{eventLabels[event.action] || event.action.replace(/_/g, ' ')}</strong><p className="muted">{event.actorName} · {formatDate(event.occurredAt)}{event.version && ` · versão ${event.version}`}</p>{event.reason && <p className={styles.preserveText}>{event.reason}</p>}</div></li>)}</ol></section>

    <Modal open={Boolean(command)} title={command ? commandLabels[command] : ''} onClose={close}>
      {command && <form onSubmit={submit} className="stack">
        <p className="muted">{permit.code} · versão {intent?.version} · {permit.appointment.location}</p>
        {staleIntent && <Feedback tone="warning">O registro foi atualizado enquanto esta janela estava aberta. Feche a janela, confira a versão atual e abra a ação novamente.</Feedback>}
        {(localError || writeError) && <Feedback tone="danger">{localError || writeError}{conflict && <p>Feche esta janela e carregue a versão atual antes de decidir novamente.</p>}</Feedback>}
        <fieldset className={styles.preparationFieldset} disabled={writePending} aria-label="Dados da confirmação">
        {command === 'science' && <>
          <Feedback tone="info">Declarante: <strong>{selectedParticipant?.name}</strong>. Coletor autenticado: <strong>{me?.user.displayName}</strong>. A conta utilizada no aparelho não autentica automaticamente o participante.</Feedback>
          <p>Declaração ilustrativa: “Visualizei o contexto, a preparação e o checklist da PT {permit.code}, versão {permit.version}, e confirmo minha ciência sobre este registro.”</p>
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
        {command === 'review' && <><Feedback tone="info">Você está decidindo sobre o encerramento da versão {permit.version}. A revisão acontece após a conclusão da atividade; não substitui a liberação inicial.</Feedback><Field label="Decisão da revisão"><select aria-label="Decisão da revisão" value={decision} onChange={event => { setDecision(event.target.value as 'APPROVE' | 'RETURN'); setConfirmed(false); }}><option value="APPROVE">Aprovar encerramento</option><option value="RETURN">Devolver para correção</option></select></Field><Field label={decision === 'RETURN' ? 'Motivo da devolução' : 'Observação da revisão (opcional)'}><textarea aria-label={decision === 'RETURN' ? 'Motivo da devolução' : 'Observação da revisão (opcional)'} value={comment} onChange={event => { setComment(event.target.value); setConfirmed(false); }} maxLength={4000} /></Field>{decision === 'APPROVE' && <><p className="muted">Representação visual desta aprovação, em nome do responsável autenticado:</p><div className={styles.typedRepresentation}>{me?.user.displayName}</div><p className="muted">A representação será associada a esta decisão e versão. Não constitui assinatura criptográfica ou promessa de validade jurídica.</p></>}<label className={styles.confirmation}><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span>{decision === 'APPROVE' ? `Eu, ${me?.user.displayName}, conferi a versão ${permit.version} e confirmo sua aprovação, com minha representação nesta decisão.` : `Confirmo a devolução da versão ${permit.version} pelo motivo informado, mantendo a atividade concluída.`}</span></label></>}
        </fieldset>
        <div className="actions"><Button type="submit" disabled={writePending || conflict || staleIntent}>{writePending ? 'Registrando…' : command === 'review' ? decision === 'APPROVE' ? 'Confirmar aprovação' : 'Confirmar devolução' : 'Confirmar ação'}</Button><Button variant="secondary" onClick={close} disabled={writePending}>Cancelar</Button></div>
      </form>}
    </Modal>
  </div>;
}

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, revisionEtag } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { WorkAuthorizationDto } from '../../shared/contracts/work-authorizations';
import type { PermitSourceCheckDto } from '../../shared/contracts/work-permits';
import { Button, Feedback, Field, Modal } from '../../shared/ui';
import { appointmentInstant, appointmentLocal } from '../agenda/support';
import { UnsavedChanges } from '../workers/UnsavedChanges';
import { SignaturePad } from '../permits/SignaturePad';
import { validateScience, validateText } from '../permits/validation';
import { AuthorizationSourceChecks } from './AuthorizationCommon';
import { createAuthorizationClosingChecks, validateAuthorizationChecks, validateAuthorizationPreparation } from './model';
import { authorizationError, authorizationKey, authorizationWindowError, useAuthorizationContextGuard } from './support';
import { assertAuthorizationResponse, invalidateAuthorizationContext } from './request-safety';
import styles from './authorizations.module.css';

type Command = 'science' | 'authorize' | 'revalidate' | 'suspend' | 'close' | 'cancel';
const labels: Record<Command, string> = { science: 'Registrar ciência na AT', authorize: 'Autorizar AT', revalidate: 'Revalidar AT', suspend: 'Suspender AT', close: 'Encerrar AT', cancel: 'Cancelar AT' };
const actions: Record<Command, string> = { science: 'COLLECT_SCIENCE', authorize: 'AUTHORIZE', revalidate: 'REVALIDATE', suspend: 'SUSPEND', close: 'CLOSE', cancel: 'CANCEL' };

export function authorizationBlockers(record: WorkAuthorizationDto) {
  const blockers: string[] = [];
  const preparation = validateAuthorizationPreparation(record.preparation, true);
  if (preparation) blockers.push(preparation);
  if (!record.eligibility.eligible) blockers.push('Há requisitos documentais pendentes neste atendimento.');
  const missing = record.appointment.participants.filter(person => !record.sciences.some(science => science.workerId === person.workerId && science.version === 1));
  if (missing.length) blockers.push(`Falta ciência de ${missing.map(person => person.name).join(', ')}.`);
  return blockers;
}

export function AuthorizationActions({ record }: { record: WorkAuthorizationDto }) {
  const { can, me, sessionKey, unitId } = useSession(); const client = useQueryClient();
  const [command, setCommand] = useState<Command>(); const [intent, setIntent] = useState<{ revision: number; status: WorkAuthorizationDto['status'] }>();
  const [reason, setReason] = useState(''); const [summary, setSummary] = useState(''); const [issuerName, setIssuerName] = useState('');
  const [validUntil, setValidUntil] = useState(''); const [confirmed, setConfirmed] = useState(false);
  const [sameTeam, setSameTeam] = useState(false); const [sameConditions, setSameConditions] = useState(false);
  const [workerId, setWorkerId] = useState(''); const [declarantName, setDeclarantName] = useState('');
  const [method, setMethod] = useState<'TYPED' | 'DRAWN'>('TYPED'); const [drawing, setDrawing] = useState('');
  const [closingChecks, setClosingChecks] = useState<PermitSourceCheckDto[]>([]);
  const [failure, setFailure] = useState<unknown>(); const [notice, setNotice] = useState('');
  const [reviewRequired, setReviewRequired] = useState(false);
  const [sending, setSending] = useState(false); const [checking, setChecking] = useState(false);
  const errorFocus = useRef<HTMLDivElement>(null);
  const active = useRef(true); const pendingRequest = useRef<AbortController | undefined>(undefined);
  useEffect(() => { active.current = true; return () => { active.current = false; pendingRequest.current?.abort(); }; }, []);
  const busy = sending || checking;
  const readable = can('at.read') && record.unitId === unitId;
  const operator = readable && can('at.operate') && record.appointment.responsibleId === me?.user.id;
  const administrative = readable && can('at.write') && Boolean(me?.roles.some(role => ['ADMIN', 'SESMT_MANAGER'].includes(role)));
  const has = (action: Command) => readable && (action === 'cancel' ? operator || administrative : operator) && record.availableActions.includes(actions[action]);
  const stale = Boolean(intent && (intent.revision !== record.revision || intent.status !== record.status));
  const conflict = reviewRequired || stale || failure instanceof ApiError && [412, 428].includes(failure.status);
  const foreman = record.appointment.participants.find(person => person.workerId === record.preparation.foremanId);
  const blockers = authorizationBlockers(record);
  useAuthorizationContextGuard(Boolean(command), busy, setFailure);
  useEffect(() => { if (failure !== undefined) errorFocus.current?.focus(); }, [failure]);

  function open(action: Command) {
    if (busy || pendingRequest.current || !has(action)) return;
    setCommand(action); setIntent({ revision: record.revision, status: record.status });
    setReason(''); setSummary(''); setIssuerName(''); setValidUntil(appointmentLocal(record.appointment.endsAt));
    setConfirmed(false); setSameTeam(false); setSameConditions(false); setFailure(undefined); setNotice('');
    setWorkerId(''); setDeclarantName(''); setMethod('TYPED'); setDrawing('');
    setClosingChecks(structuredClone(record.closingChecks.length ? record.closingChecks : createAuthorizationClosingChecks()));
  }
  async function refreshCurrent() {
    if (busy || pendingRequest.current) return;
    const controller = new AbortController(); pendingRequest.current = controller;
    setChecking(true); setFailure(undefined); setNotice(''); setConfirmed(false); setSameTeam(false); setSameConditions(false);
    try {
      const current = await api.get<WorkAuthorizationDto>(`/work-authorizations/${record.id}`, { signal: controller.signal, query: { unitId } });
      if (!active.current || controller.signal.aborted) return;
      const cached = client.getQueryData<WorkAuthorizationDto>(authorizationKey(sessionKey, unitId, record.id));
      assertAuthorizationResponse(current, { id: record.id, unitId, companyId: record.companyId, appointmentId: record.appointment.id, minimumRevision: Math.max(record.revision, cached?.revision || 0) });
      client.setQueryData(authorizationKey(sessionKey, unitId, record.id), current);
      setIntent({ revision: current.revision, status: current.status });
      setReviewRequired(false);
      setConfirmed(false); setSameTeam(false); setSameConditions(false);
      setFailure(undefined); setNotice('AT atual carregada. O preenchimento foi preservado; confira o registro e confirme novamente.');
    } catch (error) { if (active.current && !controller.signal.aborted) setFailure(error); }
    finally { if (pendingRequest.current === controller) { pendingRequest.current = undefined; if (active.current) setChecking(false); } }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!command || !intent || conflict || busy || pendingRequest.current || !has(command)) return;
    let body: unknown; let invalid: string | undefined;
    if (command === 'science') {
      const person = record.appointment.participants.find(value => value.workerId === workerId);
      invalid = validateAuthorizationPreparation(record.preparation, true) || (!person ? 'Selecione o participante que declara.' : validateScience(person.name, declarantName, confirmed, method, method === 'TYPED' ? declarantName.trim() : drawing));
      if (!invalid && declarantName.length > 160) invalid = 'Use até 160 caracteres para o nome.';
      body = { workerId, declarantName: declarantName.trim(), method, representation: method === 'TYPED' ? declarantName.trim() : drawing, confirmed: true };
    } else if (command === 'suspend' || command === 'cancel') {
      invalid = validateText(reason, 'Motivo', 10, 2000);
      body = { reason: reason.trim(), confirmed: true };
    } else {
      invalid = validateText(issuerName, 'Nome do emitente', 3, 160);
      if (!invalid && (!foreman || !me?.user.displayName)) invalid = 'Confira o encarregado e o responsável identificados no atendimento.';
      const representations = { responsibleName: me?.user.displayName || '', foremanName: foreman?.name || '', issuerName: issuerName.trim(), confirmed: true as const };
      if (command === 'close') {
        invalid ||= validateText(summary, 'Resumo da conclusão', 10, 2000) || validateAuthorizationChecks(closingChecks, true);
        body = { summary: summary.trim(), checks: closingChecks, representations };
      } else {
        const instant = appointmentInstant(validUntil);
        invalid ||= !instant ? 'Informe data e hora válidas para o fim da autorização.' : authorizationWindowError(instant, record.appointment) || blockers[0];
        if (command === 'revalidate') {
          invalid ||= validateText(reason, 'Motivo da revalidação', 10, 2000);
          if (!invalid && (!sameTeam || !sameConditions)) invalid = 'Confirme a mesma equipe e as condições conferidas antes de revalidar.';
        }
        body = { validUntil: instant, representations, ...(command === 'revalidate' ? { reason: reason.trim(), sameTeam: true, sameConditions: true } : {}) };
      }
    }
    if (!invalid && !confirmed) invalid = 'Confirme explicitamente esta ação antes de continuar.';
    if (invalid) { setFailure(new Error(invalid)); return; }
    const controller = new AbortController(); pendingRequest.current = controller;
    setSending(true); setFailure(undefined); setNotice('');
    let responseReceived = false;
    try {
      const updated = await api.post<WorkAuthorizationDto>(`/work-authorizations/${record.id}/${command === 'science' ? 'sciences' : command}`, body, { signal: controller.signal, etag: revisionEtag(intent.revision), query: { unitId } });
      if (!active.current || controller.signal.aborted) return;
      responseReceived = true;
      const cached = client.getQueryData<WorkAuthorizationDto>(authorizationKey(sessionKey, unitId, record.id));
      assertAuthorizationResponse(updated, { id: record.id, unitId, companyId: record.companyId, appointmentId: record.appointment.id, minimumRevision: Math.max(record.revision, cached?.revision || 0), advancedFrom: intent.revision });
      client.setQueryData(authorizationKey(sessionKey, unitId, record.id), updated);
      setNotice(`${labels[command]}: registro confirmado.`);
      setCommand(undefined); setIntent(undefined);
      void invalidateAuthorizationContext(client, sessionKey, unitId, ['work-authorizations', 'authorization-options', 'appointments', 'appointment', 'eligibility', 'documentary-readiness', 'permit-dashboard']);
    } catch (error) { if (active.current && !controller.signal.aborted) { setFailure(error); if (responseReceived || error instanceof ApiError && [412, 428].includes(error.status)) setReviewRequired(true); } }
    finally { if (pendingRequest.current === controller) { pendingRequest.current = undefined; if (active.current) setSending(false); } }
  }
  if (!readable) return null;
  const release = command === 'authorize' || command === 'revalidate';
  const representations = release || command === 'close';
  return <section className="panel stack" aria-label="Ações da AT"><UnsavedChanges dirty={Boolean(command)} busy={busy} /><h2>Ações e conferência</h2>
    {notice && <Feedback tone="success">{notice}</Feedback>}
    {operator && ['DRAFT', 'AUTHORIZED', 'SUSPENDED'].includes(record.status) && blockers.length > 0 && <Feedback tone="warning"><strong>Antes de autorizar ou revalidar:</strong><ul>{blockers.map(item => <li key={item}>{item}</li>)}</ul></Feedback>}
    {!operator && <p className="muted">Autorizar, revalidar, suspender e encerrar exige o operador designado para este atendimento.</p>}
    <div className="actions">{(Object.keys(labels) as Command[]).filter(has).map(action => <Button key={action} variant={action === 'cancel' ? 'danger' : action === 'authorize' ? 'primary' : 'secondary'} disabled={busy} onClick={() => open(action)}>{labels[action]}</Button>)}</div>
    <Modal open={Boolean(command)} title={command ? labels[command] : 'Ação da AT'} onClose={() => { if (!busy) { setCommand(undefined); setIntent(undefined); } }}>
      {command && <form className="stack" noValidate onSubmit={event => void submit(event)}><p><strong>{record.code} · revisão {intent?.revision}</strong></p><Feedback tone="info">Esta confirmação não libera, inicia ou retoma uma PT e não representa assinatura criptográfica.</Feedback>
        {command === 'cancel' && administrative && !operator && <Feedback tone="warning">Cancelamento administrativo para preservar o registro desta AT. Informe o motivo; o atendimento e a PT vinculada permanecem em seus próprios fluxos.</Feedback>}
        {stale && <Feedback tone="warning">O estado ou a revisão da AT mudou enquanto você preenchia. Confira os dados atuais.</Feedback>}
        {command === 'science' && <><Field label="Participante que declara *"><select value={workerId} disabled={busy} onChange={event => { const person = record.appointment.participants.find(item => item.workerId === event.target.value); setWorkerId(event.target.value); setDeclarantName(person?.name || ''); setConfirmed(false); setDrawing(''); }}><option value="">Selecione o participante</option>{record.appointment.participants.filter(person => !record.sciences.some(science => science.workerId === person.workerId)).map(person => <option key={person.workerId} value={person.workerId}>{person.name}</option>)}</select></Field><Field label="Nome de quem declara *"><input value={declarantName} maxLength={160} disabled={busy} onChange={event => { setDeclarantName(event.target.value); setConfirmed(false); }} /></Field><Field label="Representação da ciência"><select value={method} disabled={busy} onChange={event => { setMethod(event.target.value as 'TYPED' | 'DRAWN'); setDrawing(''); setConfirmed(false); }}><option value="TYPED">Nome digitado</option><option value="DRAWN">Desenho</option></select></Field>{method === 'DRAWN' && <fieldset className={styles.fieldset} disabled={busy}><legend>Manifestação do participante</legend><SignaturePad key={`${workerId}-${method}`} disabled={busy} onChange={value => { setDrawing(value); setConfirmed(false); }} /></fieldset>}</>}
        {release && <><Field label="Autorização válida até *"><input type="datetime-local" value={validUntil} disabled={busy} onChange={event => { setValidUntil(event.target.value); setConfirmed(false); }} /></Field><p className="muted">Horário de Brasília (America/Sao_Paulo). O servidor confere o período do atendimento.</p><Feedback tone="warning">A preparação completa, as 11 respostas, as ciências e a elegibilidade documental serão verificadas novamente.</Feedback></>}
        {(command === 'suspend' || command === 'cancel' || command === 'revalidate') && <Field label={command === 'revalidate' ? 'Motivo da revalidação *' : 'Motivo *'}><textarea value={reason} maxLength={2000} disabled={busy} onChange={event => { setReason(event.target.value); setConfirmed(false); }} /></Field>}
        {command === 'revalidate' && <><label className={styles.check}><input type="checkbox" checked={sameTeam} disabled={busy} onChange={event => { setSameTeam(event.target.checked); setConfirmed(false); }} />A equipe e os participantes continuam os mesmos.</label><label className={styles.check}><input type="checkbox" checked={sameConditions} disabled={busy} onChange={event => { setSameConditions(event.target.checked); setConfirmed(false); }} />Conferi as condições do serviço e os controles antes de revalidar.</label></>}
        {command === 'close' && <><Feedback tone="warning">Registre as condições da conclusão, mesmo se a autorização venceu ou surgiram pendências documentais. Encerrar preserva a AT e seu histórico.</Feedback><Field label="Resumo da conclusão *"><textarea value={summary} maxLength={2000} disabled={busy} onChange={event => { setSummary(event.target.value); setConfirmed(false); }} /></Field><AuthorizationSourceChecks checks={closingChecks} prefix="at-closing" disabled={busy} onChange={value => { setClosingChecks(value); setConfirmed(false); }} /></>}
        {representations && <div className="stack"><Field label="Responsável identificado"><input value={me?.user.displayName || ''} readOnly /></Field><Field label="Encarregado identificado"><input value={foreman?.name || ''} readOnly /></Field><Field label="Nome do emitente *"><input value={issuerName} maxLength={160} disabled={busy} onChange={event => { setIssuerName(event.target.value); setConfirmed(false); }} /></Field></div>}
        <label className={styles.check}><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />{command === 'science' ? 'O participante confirma sua ciência das condições registradas nesta AT.' : `Conferi os dados e confirmo esta ação: ${labels[command].toLocaleLowerCase('pt-BR')}.`}</label>
        {failure !== undefined && <div tabIndex={-1} ref={errorFocus}><Feedback tone="danger">{authorizationError(failure)}</Feedback></div>}{notice && <Feedback>{notice}</Feedback>}
        {conflict && <Button variant="secondary" disabled={busy} onClick={() => void refreshCurrent()}>Atualizar AT e preservar preenchimento</Button>}
        {!has(command) && <Feedback tone="warning">Esta ação já não está disponível no estado atual. O preenchimento foi preservado para conferência.</Feedback>}
        <div className="actions"><Button type="submit" disabled={busy || conflict || !has(command)} variant={command === 'cancel' ? 'danger' : 'primary'}>{busy ? 'Registrando…' : `Confirmar ${labels[command].toLocaleLowerCase('pt-BR')}`}</Button><Button variant="secondary" disabled={busy} onClick={() => { setCommand(undefined); setIntent(undefined); }}>Continuar na AT</Button></div>
      </form>}
    </Modal>
  </section>;
}

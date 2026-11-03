import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import { InvalidReadResponse, useVerifiedRead } from '../../shared/lib/verified-read';
import { formatDate } from '../../shared/lib/format';
import { Badge, Button, EmptyState, Feedback, Field, Modal, PageHeader, Spinner } from '../../shared/ui';
import { NativeCommandDialog, NativeContextConflict, NativeFormError } from '../native-operations/NativeCommandDialog';
import { checkedContext, checkedHistory, checkedPage, checkedTraining, duration, formatDay, kindLabels, localDay, statuses,
  trainingFields, trainingStatus, historyLabels, type Training, type TrainingContext, type TrainingScope } from './contracts';
import { TrainingEvidence, TrainingEvidenceEditor, type EvidenceCommand } from './TrainingEvidence';
import { safetyFilter, safetyReturn } from '../workers/worker-safety-navigation';
import styles from '../../shared/ui/NativeRecords.module.css';

export function NativeTrainingPage() {
  const { sessionKey, unitId } = useSession();
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const linkedUnits = params.getAll('unitId');
  const linkedScope = linkedUnits.length > 1 ? linkedUnits : linkedUnits[0] || unitId;
  const workspaceKey = JSON.stringify([sessionKey, unitId, linkedScope, params.getAll('workerId')]);
  return <TrainingWorkspace key={workspaceKey}/>;
}
function TrainingWorkspace() {
  const { me, sessionKey, unitId, can, setUnitId } = useSession(), client = useQueryClient();
  const [params, updateParams] = useSearchParams(), { state } = useLocation();
  const setParams = (next: URLSearchParams, preserve = true) => updateParams(next, { state: preserve ? state : null });
  const { subjectWorkerId, validWorker } = safetyFilter(params, Boolean(me?.scope.ownOnly), me?.workerId);
  const back = validWorker ? safetyReturn(state, sessionKey, unitId, subjectWorkerId, can('workers.read'), can('eligibility.read')) : undefined;
  const query = params.get('q') ?? '', status = params.get('status') ?? '', page = Number(params.get('page') ?? '1');
  const [input, setInput] = useState(query), [editor, setEditor] = useState<{ item?: Training }>(), [revoking, setRevoking] = useState<Training>(), [success, setSuccess] = useState('');
  const [evidenceCommand, setEvidenceCommand] = useState<EvidenceCommand>();
  useEffect(() => setInput(query), [query]);
  const validCriteria = validWorker && query.length <= 160 && Number.isInteger(page) && page >= 1 && page <= 1000000
    && (!status || Object.hasOwn(statuses, status)) && ['q', 'status', 'page', 'registro'].every(key => params.getAll(key).length <= 1);
  const scope: TrainingScope = { unitId: unitId ?? '', companyIds: me?.scope.companyIds ?? [], ownOnly: Boolean(me?.scope.ownOnly), workerId: me?.workerId };
  const linkedUnit = params.get('unitId');
  const unitMismatch = params.getAll('unitId').length > 1 || Boolean(linkedUnit && linkedUnit !== unitId);
  const enabled = Boolean(unitId && can('treinamento:ler') && !unitMismatch);
  const context = useVerifiedRead({ queryKey: ['native-training', sessionKey, unitId, 'context'], enabled,
    request: signal => api.get<unknown>('/trainings/context', { query: { unitId }, signal }), validate: value => checkedContext(value, scope) });
  const canRegisterTraining = validCriteria && context.data?.canCreate &&
    (!subjectWorkerId || context.data.workers.some(worker => worker.id === subjectWorkerId));
  const selectedScope = { ...scope, subjectWorkerId, companyIds: context.data ? [context.data.companyId] : scope.companyIds };
  const list = useVerifiedRead({ queryKey: ['native-training', sessionKey, unitId, 'list', subjectWorkerId, query, status, page], enabled: enabled && Boolean(context.data) && validCriteria,
    request: signal => api.get<unknown>('/trainings', { query: { unitId, workerId: subjectWorkerId, q: query, status, page, pageSize: 20 }, signal }),
    validate: value => checkedPage(value, selectedScope, page, query, status) });
  const detailId = params.get('registro'), validId = Boolean(detailId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(detailId));
  const detail = useVerifiedRead({ queryKey: ['native-training', sessionKey, unitId, 'detail', subjectWorkerId, detailId], enabled: enabled && Boolean(context.data) && validId && validCriteria,
    request: signal => api.get<unknown>(`/trainings/${detailId}`, { query: { unitId }, signal }), validate: value => checkedTraining(value, selectedScope, detailId!) });
  const history = useVerifiedRead({ queryKey: ['native-training', sessionKey, unitId, 'history', subjectWorkerId, detailId, detail.data?.revision], enabled: Boolean(detail.data),
    request: signal => api.get<unknown>(`/trainings/${detailId}/history`, { query: { unitId }, signal }), validate: value => checkedHistory(value, detail.data!.revision) });
  function criteria(values: { q?: string; status?: string; page?: number; registro?: string }, keepWorker = true) {
    const next = new URLSearchParams(unitId ? { unitId } : {});
    if (keepWorker && subjectWorkerId) next.set('workerId', subjectWorkerId);
    if (values.q) next.set('q', values.q); if (values.status) next.set('status', values.status);
    if (values.page && values.page > 1) next.set('page', String(values.page)); if (values.registro) next.set('registro', values.registro);
    return next;
  }
  function search(event: FormEvent) { event.preventDefault(); setParams(criteria({ q: input.trim(), status })); if (query === input.trim() && page === 1) void list.refetch(); }
  function closeDetails() { setParams(criteria({ q: query, status, page })); }
  async function saved(id: string) {
    setEditor(undefined); setRevoking(undefined); setSuccess('Registro salvo.');
    setEvidenceCommand(undefined);
    await client.invalidateQueries({ queryKey: ['native-training', sessionKey] });
    await client.invalidateQueries({ queryKey: ['worker-safety', sessionKey] });
    setParams(criteria({ q: query, status, page, registro: id }));
  }
  return <div className="stack">
    <PageHeader title="Treinamentos" description="Acompanhe cursos registrados e datas de renovação informadas. O cadastro não emite certificado, comprova habilitação ou libera uma atividade."
      actions={context.data && <><Button variant="secondary" disabled={list.isFetching} onClick={() => void client.invalidateQueries({ queryKey: ['native-training', sessionKey] })}>Atualizar</Button>{canRegisterTraining && <Button onClick={() => { closeDetails(); setEditor({}); }}>Registrar treinamento</Button>}</>}/>
    {unitMismatch ? <Feedback tone="warning"><p>O endereço se refere a outra unidade. Escolha o contexto antes de consultar.</p><div className="actions"><Button variant="secondary" onClick={() => setParams(new URLSearchParams(unitId ? { unitId } : {}))}>Usar unidade atual</Button>{params.getAll('unitId').length === 1 && me?.scope.unitIds?.includes(linkedUnit!) && <Button onClick={() => { if (window.dispatchEvent(new Event('sesmt:before-context-change', { cancelable: true }))) setUnitId(linkedUnit!); }}>Abrir unidade do link</Button>}</div></Feedback>
      : !enabled ? <Feedback tone="warning">Selecione uma unidade com acesso a treinamentos.</Feedback>
      : context.isPending ? <Spinner/> : context.isError ? <Feedback tone="danger">Não foi possível consultar os treinamentos desta unidade.</Feedback> : context.data && <>
        {validCriteria && subjectWorkerId && <div className="actions"><span>Filtro por trabalhador</span>
          {back && <Link className="button button--secondary" to={back.to} state={back.state}>Voltar à ficha</Link>}
          <Button variant="ghost" onClick={() => setParams(criteria({}, false), false)}>Limpar filtro de trabalhador</Button>
        </div>}
        {success && <Feedback tone="success">{success}</Feedback>}
        <form className={`panel ${styles.toolbar}`} onSubmit={search}>
          <Field label="Buscar curso ou trabalhador"><input maxLength={160} value={input} onChange={event => setInput(event.target.value)}/></Field>
          <Field label="Situação"><select value={status} onChange={event => setParams(criteria({ q: query, status: event.target.value }))}><option value="">Todas</option>{Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
          <Button type="submit" disabled={list.isFetching}>Buscar</Button>
        </form>
        {!validCriteria ? <Feedback tone="warning">Os filtros do endereço são inválidos. <Button variant="ghost" onClick={() => setParams(criteria({}, false), false)}>Limpar filtros</Button></Feedback>
          : list.isPending ? <Spinner/> : list.isError ? <Feedback tone="danger">Não foi possível consultar os registros. Atualize a consulta.</Feedback>
          : list.data && (list.data.items.length ? <div className={styles.results}><div className={styles.scroll} role="region" aria-label="Tabela de treinamentos" tabIndex={0}><table className={`data-table ${styles.table}`}>
            <thead><tr><th scope="col">Curso</th><th scope="col">Trabalhador</th><th scope="col">Conclusão e carga horária</th><th scope="col">Renovação prevista</th><th scope="col">Situação</th></tr></thead>
            <tbody>{list.data.items.map(item => <tr key={item.id}><td><Link state={state} to={{ search: `?${criteria({ q: query, status, page, registro: item.id })}` }}>{item.title}</Link>{item.reference && <small>{item.reference}</small>}</td><td>{item.workerName}</td><td>{formatDay(item.completedOn)}<small>{duration(item.durationMinutes)}</small></td><td>{formatDay(item.renewalOn)}</td><td><TrainingBadge item={item}/></td></tr>)}</tbody>
          </table></div><div className={styles.footer}><span>{list.data.total} registro(s) · página {page} de {Math.max(1, Math.ceil(list.data.total / 20))}</span><div className="actions"><Button variant="secondary" disabled={page <= 1} onClick={() => setParams(criteria({ q: query, status, page: page - 1 }))}>Anterior</Button><Button variant="secondary" disabled={page * 20 >= list.data!.total} onClick={() => setParams(criteria({ q: query, status, page: page + 1 }))}>Próxima</Button></div></div></div>
            : <EmptyState title="Nenhum treinamento encontrado" description={context.data.canCreate ? 'Ajuste os filtros ou registre um treinamento realizado.' : 'Nenhum registro disponível para esta consulta.'}/>)}
      </>}
    {detailId && !unitMismatch && <Modal open title="Detalhes do treinamento" onClose={closeDetails}>
      {!enabled || !validId || !validCriteria || detail.isError || context.isError ? <Feedback tone="danger">Treinamento não encontrado ou fora do seu acesso.</Feedback> : !detail.data ? <Spinner/> : <div className="stack">
        <TrainingDetails item={detail.data}/>
        <TrainingEvidence training={detail.data} onCommand={command => { setEvidenceCommand(command); closeDetails(); }}/>
        <div className="actions">{can('workers.read') && <Link className="button button--secondary" to={`/app/trabalhadores/${detail.data.workerId}`}>Ficha do trabalhador</Link>}
          {context.data?.canEdit && !detail.data.revokedAt && <><Button variant="secondary" onClick={() => { setEditor({ item: detail.data }); closeDetails(); }}>Editar registro</Button><Button variant="danger" onClick={() => { setRevoking(detail.data); closeDetails(); }}>Invalidar registro</Button></>}
        </div>
        <details><summary>Histórico de alterações</summary>{history.isPending ? <Spinner/> : history.isError ? <Feedback tone="danger">Não foi possível consultar o histórico.</Feedback>
          : history.data?.length ? <ol>{history.data.map(event => <li key={event.id}><strong>{historyLabels[event.action]} · versão {event.revision}</strong><p>{event.actorName || 'Responsável não informado'} · {formatDate(event.occurredAt)}</p>{event.reason && <p className={styles.message}>{event.reason}</p>}</li>)}</ol> : <p>Nenhuma alteração disponível.</p>}</details>
      </div>}
    </Modal>}
    {editor && context.data && <TrainingEditor opening={editor.item} context={context.data} scope={selectedScope} onClose={() => setEditor(undefined)} onSaved={saved}/>}
    {revoking && <RevokeEditor opening={revoking} scope={selectedScope} onClose={() => setRevoking(undefined)} onSaved={saved}/>}
    {evidenceCommand && <TrainingEvidenceEditor command={evidenceCommand} onClose={() => setEvidenceCommand(undefined)} onSaved={saved}/>}
  </div>;
}
function TrainingBadge({ item }: { item: Training }) {
  const status = trainingStatus(item);
  return <Badge tone={status === 'REVOKED' || status === 'EXPIRED' ? 'danger' : status === 'EXPIRING' ? 'warning' : 'neutral'}>{statuses[status]}</Badge>;
}
function TrainingDetails({ item }: { item: Training }) {
  return <dl className={styles.details}>
    <dt>Curso</dt><dd>{item.title}</dd><dt>Trabalhador</dt><dd>{item.workerName}</dd>{item.reference && <><dt>Referência</dt><dd>{item.reference}</dd></>}<dt>Tipo</dt><dd>{kindLabels[item.kind]}</dd>
    <dt>Conclusão</dt><dd>{formatDay(item.completedOn)}</dd><dt>Carga horária</dt><dd>{duration(item.durationMinutes)}</dd>{item.renewalOn && <><dt>Renovação prevista</dt><dd>{formatDay(item.renewalOn)}</dd></>}
    <dt>Situação</dt><dd><TrainingBadge item={item}/></dd>{item.provider && <><dt>Instituição</dt><dd>{item.provider}</dd></>}{item.instructor && <><dt>Instrutor</dt><dd>{item.instructor}</dd></>}{item.venue && <><dt>Local</dt><dd>{item.venue}</dd></>}
    {item.content && <><dt>Conteúdo</dt><dd className={styles.message}>{item.content}</dd></>}{item.notes && <><dt>Observações</dt><dd className={styles.message}>{item.notes}</dd></>}
    {item.revokedAt && <><dt>Invalidado em</dt><dd>{formatDate(item.revokedAt)}</dd><dt>Motivo</dt><dd className={styles.message}>{item.revocationReason}</dd></>}
  </dl>;
}
async function refreshContext(scope: TrainingScope, signal: AbortSignal) {
  return checkedContext(await api.get<unknown>('/trainings/context', { query: { unitId: scope.unitId }, signal }), scope);
}
function TrainingEditor({ opening, context, scope, onClose, onSaved }: { opening?: Training; context: TrainingContext; scope: TrainingScope; onClose: () => void; onSaved: (id: string) => Promise<void> }) {
  const [fields, setFields] = useState({ workerId: opening?.workerId ?? scope.subjectWorkerId ?? '', title: opening?.title ?? '', reference: opening?.reference ?? '', kind: opening?.kind ?? 'INITIAL',
    completedOn: opening?.completedOn ?? localDay(), renewalOn: opening?.renewalOn ?? '', hours: String(Math.floor((opening?.durationMinutes ?? 0) / 60)), minutes: String((opening?.durationMinutes ?? 0) % 60),
    provider: opening?.provider ?? '', instructor: opening?.instructor ?? '', venue: opening?.venue ?? '', content: opening?.content ?? '', notes: opening?.notes ?? '', changeReason: '' });
  const [confirmed, confirm] = useState(false), [commandId] = useState(() => crypto.randomUUID()), savedId = useRef('');
  const [dirty, setDirty] = useState(false);
  function field(key: keyof typeof fields, value: string) {
    setFields(old => ({ ...old, [key]: value }));
    setDirty(true);
    confirm(false);
  }
  async function perform(signal: AbortSignal) {
    const parsed = trainingFields.safeParse(fields);
    if (!confirmed || !parsed.success || fields.completedOn > localDay() || opening && fields.changeReason.trim().length < 3) throw new NativeFormError('Confira trabalhador, curso, datas, carga horária e confirmação.');
    const fresh = await refreshContext(scope, signal);
    if (opening ? !fresh.canEdit : !fresh.canCreate || !fresh.workers.some(w => w.id === fields.workerId)) throw new NativeContextConflict('O acesso ou o vínculo mudou. Atualize a consulta.');
    if (opening) { const current = checkedTraining(await api.get<unknown>(`/trainings/${opening.id}`, { query: { unitId: scope.unitId }, signal }), scope, opening.id); if (current.revision !== opening.revision || current.revokedAt) throw new NativeContextConflict('O registro mudou. Atualize a consulta.'); }
    const f = parsed.data;
    const payload = { unitId: scope.unitId, workerId: f.workerId, commandId, title: f.title, reference: f.reference || null, kind: f.kind, completedOn: f.completedOn,
      renewalOn: f.renewalOn || null, durationMinutes: Number(f.hours) * 60 + Number(f.minutes), provider: f.provider || null, instructor: f.instructor || null,
      venue: f.venue || null, content: f.content || null, notes: f.notes || null, confirmation: true, ...(opening ? { expectedRevision: opening.revision, changeReason: f.changeReason } : {}) };
    const response = opening ? await api.put<unknown>(`/trainings/${opening.id}`, payload, { signal }) : await api.post<unknown>('/trainings', payload, { signal });
    const saved = checkedTraining(response, scope, opening?.id);
    if (saved.revokedAt || saved.revision !== (opening?.revision ?? 0) + 1 || Object.entries(payload).some(([key, value]) => key in saved && saved[key as keyof Training] !== value)) throw new InvalidReadResponse();
    const stored = checkedTraining(await api.get<unknown>(`/trainings/${saved.id}`, { query: { unitId: scope.unitId }, signal }), scope, saved.id);
    if (JSON.stringify(stored) !== JSON.stringify(saved)) throw new InvalidReadResponse(); savedId.current = saved.id;
  }
  return <NativeCommandDialog title={opening ? 'Editar treinamento' : 'Registrar treinamento'} dirty={dirty} disabled={!confirmed} onClose={onClose}
    onDone={() => onSaved(savedId.current)} perform={perform} submitLabel={opening ? 'Salvar alterações' : 'Registrar treinamento'}>{busy => <>
      {opening ? <p>{opening.workerName}</p> : <Field label="Trabalhador" required><select value={fields.workerId} disabled={busy || Boolean(scope.subjectWorkerId)} onChange={event => field('workerId', event.target.value)}><option value="">Selecionar trabalhador</option>{context.workers.map(worker => <option key={worker.id} value={worker.id}>{worker.name} · {worker.enrollment}</option>)}</select></Field>}
      <Field label="Nome do curso" required><input maxLength={160} value={fields.title} disabled={busy} onChange={event => field('title', event.target.value)}/></Field>
      <Field label="Referência ou NR"><input maxLength={40} value={fields.reference} disabled={busy} onChange={event => field('reference', event.target.value)}/></Field>
      <Field label="Tipo de treinamento"><select value={fields.kind} disabled={busy} onChange={event => field('kind', event.target.value)}>{Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
      <Field label="Data de conclusão" required><input type="date" max={localDay()} value={fields.completedOn} disabled={busy} onChange={event => field('completedOn', event.target.value)}/></Field>
      <Field label="Renovação prevista"><input type="date" min={fields.completedOn} value={fields.renewalOn} disabled={busy} onChange={event => field('renewalOn', event.target.value)}/></Field>
      <div className="form-grid"><Field label="Carga horária (horas)" required><input type="number" min={0} max={10000} step={1} value={fields.hours} disabled={busy} onChange={event => field('hours', event.target.value)}/></Field><Field label="Minutos adicionais"><input type="number" min={0} max={59} step={1} value={fields.minutes} disabled={busy} onChange={event => field('minutes', event.target.value)}/></Field></div>
      <details><summary>Informações complementares</summary><div className="stack">
        <Field label="Instituição"><input maxLength={160} value={fields.provider} disabled={busy} onChange={event => field('provider', event.target.value)}/></Field>
        <Field label="Instrutor"><input maxLength={160} value={fields.instructor} disabled={busy} onChange={event => field('instructor', event.target.value)}/></Field>
        <Field label="Local do treinamento"><input maxLength={160} value={fields.venue} disabled={busy} onChange={event => field('venue', event.target.value)}/></Field>
        <Field label="Conteúdo programático"><textarea maxLength={2000} value={fields.content} disabled={busy} onChange={event => field('content', event.target.value)}/></Field>
        <Field label="Observações"><textarea maxLength={500} value={fields.notes} disabled={busy} onChange={event => field('notes', event.target.value)}/></Field>
      </div></details>
      {opening && <Field label="Motivo da alteração" required><textarea maxLength={200} value={fields.changeReason} disabled={busy} onChange={event => field('changeReason', event.target.value)}/></Field>}
      <label className="check-label"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => confirm(event.target.checked)}/>Conferi os dados deste treinamento.</label>
    </>}</NativeCommandDialog>;
}
function RevokeEditor({ opening, scope, onClose, onSaved }: { opening: Training; scope: TrainingScope; onClose: () => void; onSaved: (id: string) => Promise<void> }) {
  const [reason, setReason] = useState(''), [confirmed, confirm] = useState(false);
  async function perform(signal: AbortSignal) {
    if (!confirmed || reason.trim().length < 3 || reason.trim().length > 200) throw new NativeFormError('Informe o motivo e confirme a invalidação.');
    if (!(await refreshContext(scope, signal)).canEdit) throw new NativeContextConflict('O acesso mudou. Atualize a consulta.');
    const current = checkedTraining(await api.get<unknown>(`/trainings/${opening.id}`, { query: { unitId: scope.unitId }, signal }), scope, opening.id);
    if (current.revision !== opening.revision || current.revokedAt) throw new NativeContextConflict('O registro foi alterado. Atualize a consulta.');
    const result = checkedTraining(await api.post<unknown>(`/trainings/${opening.id}/revoke`, { unitId: scope.unitId, expectedRevision: opening.revision, reason: reason.trim(), confirmation: true }, { signal }), scope, opening.id);
    if (result.revision !== opening.revision + 1 || !result.revokedAt || result.revocationReason !== reason.trim()
      || Object.entries(opening).some(([key, value]) => !['revision', 'revokedAt', 'revocationReason', 'workerName'].includes(key) && result[key as keyof Training] !== value)) throw new InvalidReadResponse();
    const stored = checkedTraining(await api.get<unknown>(`/trainings/${opening.id}`, { query: { unitId: scope.unitId }, signal }), scope, opening.id);
    if (JSON.stringify(stored) !== JSON.stringify(result)) throw new InvalidReadResponse();
  }
  return <NativeCommandDialog title="Invalidar treinamento" dirty={Boolean(reason)} disabled={!confirmed} perform={perform} onClose={onClose} onDone={() => onSaved(opening.id)} submitLabel="Confirmar invalidação">{busy => <>
    <p><strong>{opening.title}</strong><br/>{opening.workerName}</p><p>O registro e seu histórico serão preservados.</p>
    <Field label="Motivo da invalidação" required><textarea maxLength={200} value={reason} disabled={busy} onChange={event => { setReason(event.target.value); confirm(false); }}/></Field>
    <label className="check-label"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => confirm(event.target.checked)}/>Confirmo a invalidação deste registro.</label>
  </>}</NativeCommandDialog>;
}

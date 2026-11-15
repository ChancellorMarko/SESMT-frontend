import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import { InvalidReadResponse, useVerifiedRead } from '../../shared/lib/verified-read';
import { formatDate, plural } from '../../shared/lib/format';
import { Badge, Button, EmptyState, Feedback, Field, Modal, PageHeader, Spinner, RefreshButton } from '../../shared/ui';
import { NativeCommandDialog, NativeContextConflict, NativeFormError } from '../native-operations/NativeCommandDialog';
import { checkedAso, checkedContext, checkedHistory, checkedPage, correctionLabels, dueLabels, dueStatus, fieldsSchema, formatDay,
  historyLabels, kindLabels, localDay, revocationLabels, states, type Aso, type AsoContext, type AsoScope } from './contracts';
import styles from '../../shared/ui/NativeRecords.module.css';

export function NativeAsoPage() {
  const { sessionKey, unitId } = useSession(); return <AsoWorkspace key={`${sessionKey}:${unitId}`}/>;
}
function AsoWorkspace() {
  const { me, sessionKey, unitId, can, setUnitId } = useSession(), client = useQueryClient();
  const [params, setParams] = useSearchParams(), q = params.get('q') ?? '', due = params.get('due') ?? '', view = params.get('view') ?? 'LATEST', page = Number(params.get('page') ?? '1');
  const [input, setInput] = useState(q), [editor, setEditor] = useState<{ item?: Aso }>(), [revoking, setRevoking] = useState<Aso>(), [success, setSuccess] = useState('');
  useEffect(() => setInput(q), [q]);
  const valid = q.length <= 160 && ['LATEST', 'ALL'].includes(view) && (!due || Object.hasOwn(dueLabels, due)) && Number.isInteger(page) && page > 0 && page <= 1000000
    && ['q', 'due', 'view', 'page', 'registro', 'unitId'].every(k => params.getAll(k).length <= 1);
  const linkedUnit = params.get('unitId'), mismatch = Boolean(linkedUnit && linkedUnit !== unitId) || params.getAll('unitId').length > 1;
  const enabled = Boolean(unitId && can('aso:acompanhar') && !mismatch);
  const scope: AsoScope = { unitId: unitId ?? '', companyIds: me?.scope.companyIds ?? [], ownOnly: Boolean(me?.scope.ownOnly), workerId: me?.workerId };
  const context = useVerifiedRead({ queryKey: ['native-aso', sessionKey, unitId, 'context'], enabled,
    request: signal => api.get<unknown>('/occupational-health/context', { query: { unitId }, signal }), validate: v => checkedContext(v, scope) });
  const selectedScope = { ...scope, companyIds: context.data ? [context.data.companyId] : scope.companyIds, canDetail: context.data?.canDetail };
  const list = useVerifiedRead({ queryKey: ['native-aso', sessionKey, unitId, 'list', context.data?.companyId, context.data?.canDetail, q, due, view, page], enabled: enabled && Boolean(context.data) && valid,
    request: signal => api.get<unknown>('/occupational-health', { query: { unitId, q, due, view, page, pageSize: 20 }, signal }), validate: v => checkedPage(v, selectedScope, page, view, due) });
  const detailId = params.get('registro'), validId = Boolean(detailId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(detailId));
  const detail = useVerifiedRead({ queryKey: ['native-aso', sessionKey, unitId, 'detail', context.data?.companyId, context.data?.canDetail, detailId], enabled: enabled && Boolean(context.data) && valid && validId,
    request: signal => api.get<unknown>(`/occupational-health/${detailId}`, { query: { unitId }, signal }), validate: v => checkedAso(v, selectedScope, detailId!) });
  const history = useVerifiedRead({ queryKey: ['native-aso', sessionKey, unitId, 'history', detailId, detail.data?.revision], enabled: Boolean(detail.data),
    request: signal => api.get<unknown>(`/occupational-health/${detailId}/history`, { query: { unitId }, signal }), validate: v => checkedHistory(v, detail.data!.revision) });
  function criteria(values: { q?: string; due?: string; view?: string; page?: number; registro?: string }) {
    const p = new URLSearchParams(unitId ? { unitId } : {});
    for (const [k, v] of Object.entries(values)) if (v && !(k === 'page' && v === 1)) p.set(k, String(v)); return p;
  }
  const current = { q, due, view, page };
  function close() { setParams(criteria(current)); }
  async function saved(id: string) { setEditor(undefined); setRevoking(undefined); setSuccess('Registro salvo.'); await client.invalidateQueries({ queryKey: ['native-aso', sessionKey] }); setParams(criteria({ view: 'ALL', registro: id })); }
  function search(e: FormEvent) { e.preventDefault(); setParams(criteria({ q: input.trim(), due, view })); if (input.trim() === q && page === 1) void list.refetch(); }
  return <div className="stack"><PageHeader title="ASOs" description="Acompanhe atestados registrados e próximas avaliações."
    actions={context.data && <><RefreshButton label="Atualizar ASOs" disabled={list.isFetching} onClick={() => void client.invalidateQueries({ queryKey: ['native-aso', sessionKey] })}/>{context.data.canEdit && <Button onClick={() => { close(); setEditor({}); }}>Registrar ASO</Button>}</>}/>
    {mismatch ? <Feedback tone="warning"><p>O endereço se refere a outra unidade.</p><div className="actions"><Button variant="secondary" onClick={() => setParams(criteria({}))}>Usar unidade atual</Button>{params.getAll('unitId').length === 1 && me?.scope.unitIds?.includes(linkedUnit!) && <Button onClick={() => { if (window.dispatchEvent(new Event('sesmt:before-context-change', { cancelable: true }))) setUnitId(linkedUnit!); }}>Abrir unidade do link</Button>}</div></Feedback>
      : !enabled ? <Feedback tone="warning">Selecione uma unidade com acesso a ASOs.</Feedback> : context.isPending ? <Spinner/> : context.isError ? <Feedback tone="danger">Não foi possível consultar os ASOs desta unidade.</Feedback> : context.data && <>
        {success && <Feedback tone="success">{success}</Feedback>}
        <form className={`panel ${styles.toolbar}`} onSubmit={search}><Field label="Buscar trabalhador ou matrícula"><input maxLength={160} value={input} onChange={e => setInput(e.target.value)}/></Field>
          <Field label="Registros"><select value={view} onChange={e => setParams(criteria({ q, due, view: e.target.value }))}><option value="LATEST">Mais recente por trabalhador</option><option value="ALL">Todos, incluindo anteriores</option></select></Field>
          <Field label="Próxima avaliação"><select value={due} onChange={e => setParams(criteria({ q, view, due: e.target.value }))}><option value="">Todas</option>{Object.entries(dueLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field><Button type="submit" disabled={list.isFetching}>Buscar</Button></form>
        {!valid ? <Feedback tone="warning">Filtros inválidos. <Button variant="ghost" onClick={() => setParams(criteria({}))}>Limpar filtros</Button></Feedback> : list.isPending ? <Spinner/> : list.isError ? <Feedback tone="danger">Não foi possível ler os registros. Atualize a consulta.</Feedback> : list.data && (list.data.items.length ? <div className={styles.results}><div className={styles.scroll} role="region" aria-label="Tabela de ASOs" tabIndex={0}><table className={`data-table ${styles.table}`}>
          <thead><tr><th scope="col">Trabalhador</th><th scope="col">Exame</th><th scope="col">Informado no ASO</th><th scope="col">Próxima avaliação</th><th scope="col">Registro</th></tr></thead><tbody>{list.data.items.map(a => <tr key={a.id}><td><Link to={{ search: `?${criteria({ ...current, registro: a.id })}` }}>{a.workerName}</Link><small>{a.evaluatedFunction}</small></td><td>{kindLabels[a.examKind]}<small>{formatDay(a.examOn)}</small></td><td><Fitness a={a}/></td><td>{formatDay(a.nextEvaluationOn)}<small>{dueLabels[dueStatus(a)]}</small></td><td>{a.revokedAt ? 'Invalidado' : a.isLatest ? 'Mais recente' : 'Anterior'}</td></tr>)}</tbody>
        </table></div><div className={styles.footer}><span>{plural(list.data.total, 'registro', 'registros')} · página {page}</span><div className="actions"><Button variant="secondary" disabled={page <= 1} onClick={() => setParams(criteria({ ...current, page: page - 1 }))}>Anterior</Button><Button variant="secondary" disabled={page * 20 >= list.data!.total} onClick={() => setParams(criteria({ ...current, page: page + 1 }))}>Próxima</Button></div></div></div> : <EmptyState title="Nenhum ASO encontrado" description={context.data.canEdit ? 'Ajuste os filtros ou registre os dados de um ASO emitido.' : 'Nenhum registro disponível para esta consulta.'}/>)}
      </>}
    {detailId && !mismatch && <Modal open title="Detalhes do ASO" onClose={close}>{!validId || !valid || detail.isError ? <Feedback tone="danger">Registro indisponível ou fora do seu acesso.</Feedback> : !detail.data ? <Spinner/> : <div className="stack">
      <dl className={styles.details}><dt>Trabalhador</dt><dd>{detail.data.workerName}</dd><dt>Função avaliada</dt><dd>{detail.data.evaluatedFunction}</dd><dt>Tipo de exame</dt><dd>{kindLabels[detail.data.examKind]}</dd><dt>Exame</dt><dd>{formatDay(detail.data.examOn)}</dd><dt>Emissão</dt><dd>{formatDay(detail.data.issuedOn)}</dd><dt>Informado no ASO</dt><dd><Fitness a={detail.data}/></dd><dt>Próxima avaliação</dt><dd>{formatDay(detail.data.nextEvaluationOn)}</dd>
        <dt>Registro</dt><dd>{detail.data.revokedAt ? `Invalidado · ${revocationLabels[detail.data.revocationCode!]}` : detail.data.isLatest ? 'Mais recente' : 'Anterior'}</dd>
        {detail.data.medical && <><dt>Emitente</dt><dd>{detail.data.medical.physicianName}</dd><dt>CRM / UF</dt><dd>{detail.data.medical.physicianCrm} / {detail.data.medical.physicianState}</dd>{detail.data.medical.reference && <><dt>Referência</dt><dd>{detail.data.medical.reference}</dd></>}</>}
      </dl><div className="actions">{context.data?.canEdit && detail.data.medical && !detail.data.revokedAt && <><Button variant="secondary" onClick={() => { setEditor({ item: detail.data }); close(); }}>Corrigir cadastro</Button><Button variant="danger" onClick={() => { setRevoking(detail.data); close(); }}>Invalidar registro</Button></>}</div>
      <details><summary>Histórico de alterações</summary>{history.isPending ? <Spinner/> : history.isError ? <Feedback tone="danger">Não foi possível consultar o histórico.</Feedback> : <ol>{history.data?.map(e => <li key={e.id}><strong>{historyLabels[e.action]} · versão {e.revision}</strong><p>{e.actorName || 'Responsável'} · {formatDate(e.occurredAt)}</p>{e.reasonCode && <p>{({ ...correctionLabels, ...revocationLabels })[e.reasonCode]}</p>}</li>)}</ol>}</details>
      <details><summary>Sobre este cadastro</summary><p>Transcrição administrativa do ASO emitido. Não emite atestado, substitui avaliação médica ou libera atividades. A próxima avaliação é informada pelo responsável, conforme o acompanhamento ocupacional.</p></details>
    </div>}</Modal>}
    {editor && context.data && <AsoEditor opening={editor.item} context={context.data} scope={selectedScope} onClose={() => setEditor(undefined)} onSaved={saved}/>}
    {revoking && <RevokeEditor opening={revoking} scope={selectedScope} onClose={() => setRevoking(undefined)} onSaved={saved}/>}
  </div>;
}
function Fitness({ a }: { a: Aso }) { return <Badge tone={a.revokedAt || !a.isLatest ? 'neutral' : a.fitness === 'UNFIT' ? 'danger' : 'neutral'}>{a.fitness === 'FIT' ? 'Apto' : 'Inapto'}{!a.isLatest ? ' · histórico' : ''}</Badge>; }
async function contextNow(scope: AsoScope, signal: AbortSignal) {
  const c = checkedContext(await api.get<unknown>('/occupational-health/context', { query: { unitId: scope.unitId }, signal }), scope);
  if (!c.canEdit || !c.canDetail) throw new NativeContextConflict('Seu acesso mudou. Atualize a consulta.'); return c;
}
function AsoEditor({ opening, context, scope, onClose, onSaved }: { opening?: Aso; context: AsoContext; scope: AsoScope; onClose: () => void; onSaved: (id: string) => Promise<void> }) {
  const [f, set] = useState({ workerId: opening?.workerId ?? '', examKind: opening?.examKind ?? '', examOn: opening?.examOn ?? '', issuedOn: opening?.issuedOn ?? '', nextEvaluationOn: opening?.nextEvaluationOn ?? '',
    fitness: opening?.fitness ?? '', evaluatedFunction: opening?.evaluatedFunction ?? '', physicianName: opening?.medical?.physicianName ?? '', physicianCrm: opening?.medical?.physicianCrm ?? '', physicianState: opening?.medical?.physicianState ?? '', reference: opening?.medical?.reference ?? '', changeCode: '' });
  const [confirmed, confirm] = useState(false), [commandId] = useState(() => crypto.randomUUID()), savedId = useRef('');
  function field(k: keyof typeof f, v: string) { set(old => ({ ...old, [k]: v })); confirm(false); }
  async function perform(signal: AbortSignal) {
    const parsed = fieldsSchema.safeParse(f);
    if (!parsed.success || !confirmed || opening && !Object.hasOwn(correctionLabels, f.changeCode)) throw new NativeFormError('Confira os dados, datas, emitente e confirmação.');
    const fresh = await contextNow(scope, signal);
    if (!opening && !fresh.workers.some(w => w.id === f.workerId)) throw new NativeContextConflict('O vínculo do trabalhador mudou. Atualize a consulta.');
    if (opening) { const current = checkedAso(await api.get<unknown>(`/occupational-health/${opening.id}`, { query: { unitId: scope.unitId }, signal }), scope, opening.id); if (current.revision !== opening.revision || current.revokedAt) throw new NativeContextConflict('O registro mudou. Atualize a consulta.'); }
    const p = parsed.data, details = { fitness: p.fitness, evaluatedFunction: p.evaluatedFunction, physicianName: p.physicianName, physicianCrm: p.physicianCrm, physicianState: p.physicianState, reference: p.reference || null };
    const payload = { unitId: scope.unitId, workerId: p.workerId, commandId, examKind: p.examKind, examOn: p.examOn, issuedOn: p.issuedOn, nextEvaluationOn: p.nextEvaluationOn || null, details, confirmation: true, ...(opening ? { expectedRevision: opening.revision, changeCode: p.changeCode } : {}) };
    const raw = opening ? await api.put<unknown>(`/occupational-health/${opening.id}`, payload, { signal }) : await api.post<unknown>('/occupational-health', payload, { signal });
    const saved = checkedAso(raw, scope, opening?.id);
    if (saved.revokedAt || saved.revision !== (opening?.revision ?? 0) + 1 || saved.workerId !== p.workerId || saved.examKind !== p.examKind || saved.examOn !== p.examOn || saved.issuedOn !== p.issuedOn || saved.nextEvaluationOn !== payload.nextEvaluationOn
      || saved.fitness !== p.fitness || saved.evaluatedFunction !== p.evaluatedFunction || JSON.stringify(saved.medical) !== JSON.stringify({ physicianName: p.physicianName, physicianCrm: p.physicianCrm, physicianState: p.physicianState, reference: p.reference || null })) throw new InvalidReadResponse();
    const stored = checkedAso(await api.get<unknown>(`/occupational-health/${saved.id}`, { query: { unitId: scope.unitId }, signal }), scope, saved.id);
    if (JSON.stringify(stored) !== JSON.stringify(saved)) throw new InvalidReadResponse(); savedId.current = saved.id;
  }
  return <NativeCommandDialog title={opening ? 'Corrigir cadastro de ASO' : 'Registrar ASO'} dirty={Object.values(f).some(Boolean)} disabled={!confirmed} perform={perform} onClose={onClose} onDone={() => onSaved(savedId.current)}>{busy => <>
    {opening ? <p>{opening.workerName} · correção do cadastro existente</p> : <Field label="Trabalhador" required><select disabled={busy} value={f.workerId} onChange={e => field('workerId', e.target.value)}><option value="">Selecionar trabalhador</option>{context.workers.map(w => <option key={w.id} value={w.id}>{w.name} · {w.enrollment}</option>)}</select></Field>}
    <Field label="Tipo de exame" required><select disabled={busy} value={f.examKind} onChange={e => field('examKind', e.target.value)}><option value="">Selecionar tipo</option>{Object.entries(kindLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
    <div className="form-grid"><Field label="Data do exame" required><input type="date" max={localDay()} value={f.examOn} disabled={busy} onChange={e => field('examOn', e.target.value)}/></Field><Field label="Data de emissão" required><input type="date" min={f.examOn} max={localDay()} value={f.issuedOn} disabled={busy} onChange={e => field('issuedOn', e.target.value)}/></Field></div>
    <Field label="Função avaliada no ASO" required><input maxLength={160} disabled={busy} value={f.evaluatedFunction} onChange={e => field('evaluatedFunction', e.target.value)}/></Field>
    <Field label="Aptidão informada no ASO" required><select disabled={busy} value={f.fitness} onChange={e => field('fitness', e.target.value)}><option value="">Selecionar conforme o ASO</option><option value="FIT">Apto</option><option value="UNFIT">Inapto</option></select></Field>
    <Field label="Próxima avaliação informada"><input type="date" min={f.examOn} disabled={busy} value={f.nextEvaluationOn} onChange={e => field('nextEvaluationOn', e.target.value)}/></Field>
    <Field label="Médico emitente" required><input maxLength={160} disabled={busy} value={f.physicianName} onChange={e => field('physicianName', e.target.value)}/></Field>
    <div className="form-grid"><Field label="CRM" required><input inputMode="numeric" maxLength={12} disabled={busy} value={f.physicianCrm} onChange={e => field('physicianCrm', e.target.value)}/></Field><Field label="UF do CRM" required><select disabled={busy} value={f.physicianState} onChange={e => field('physicianState', e.target.value)}><option value="">Selecionar UF</option>{states.map(v => <option key={v}>{v}</option>)}</select></Field></div>
    <Field label="Referência do ASO"><input maxLength={80} disabled={busy} value={f.reference} onChange={e => field('reference', e.target.value)}/></Field>
    {opening && <Field label="Motivo da correção" required><select disabled={busy} value={f.changeCode} onChange={e => field('changeCode', e.target.value)}><option value="">Selecionar motivo</option>{Object.entries(correctionLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>}
    <label className="check-label"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => confirm(e.target.checked)}/>Conferi os dados com o ASO emitido.</label>
  </>}</NativeCommandDialog>;
}
function RevokeEditor({ opening, scope, onClose, onSaved }: { opening: Aso; scope: AsoScope; onClose: () => void; onSaved: (id: string) => Promise<void> }) {
  const [reasonCode, reason] = useState(''), [confirmed, confirm] = useState(false);
  async function perform(signal: AbortSignal) {
    if (!confirmed || !Object.hasOwn(revocationLabels, reasonCode)) throw new NativeFormError('Escolha o motivo e confirme.');
    await contextNow(scope, signal);
    const result = checkedAso(await api.post<unknown>(`/occupational-health/${opening.id}/revoke`, { unitId: scope.unitId, expectedRevision: opening.revision, reasonCode, confirmation: true }, { signal }), scope, opening.id);
    if (!result.revokedAt || result.revocationCode !== reasonCode || result.revision !== opening.revision + 1 || result.isLatest) throw new InvalidReadResponse();
    const stored = checkedAso(await api.get<unknown>(`/occupational-health/${opening.id}`, { query: { unitId: scope.unitId }, signal }), scope, opening.id);
    if (JSON.stringify(stored) !== JSON.stringify(result)) throw new InvalidReadResponse();
  }
  return <NativeCommandDialog title="Invalidar registro de ASO" dirty={Boolean(reasonCode)} disabled={!confirmed} perform={perform} onClose={onClose} onDone={() => onSaved(opening.id)} submitLabel="Confirmar invalidação">{busy => <><p>{opening.workerName} · exame de {formatDay(opening.examOn)}</p><p>O registro e seu histórico serão preservados.</p><Field label="Motivo administrativo" required><select disabled={busy} value={reasonCode} onChange={e => { reason(e.target.value); confirm(false); }}><option value="">Selecionar motivo</option>{Object.entries(revocationLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field><label className="check-label"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => confirm(e.target.checked)}/>Confirmo a invalidação deste cadastro.</label></>}</NativeCommandDialog>;
}

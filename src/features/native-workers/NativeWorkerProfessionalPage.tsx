import { useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, nativeWorkerProfileApi } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import { useVerifiedRead } from '../../shared/lib/verified-read';
import { Button, Feedback, Field, PageHeader, Spinner } from '../../shared/ui';
import { nativeId } from '../native-operations/contracts';
import { NativeCommandDialog, NativeContextConflict, NativeFormError } from '../native-operations/NativeCommandDialog';
import { workerNavigation } from '../workers/worker-navigation';
import { checkedProfessionalContext, checkedProfessionalReceipt, professionalFields, type ProfessionalContext } from './professional-profile';

export function NativeWorkerProfessionalPage() {
  const { id } = useParams(), { sessionKey, unitId } = useSession();
  return <Workspace key={`${sessionKey}:${unitId}:${id}`} id={id ?? ''}/>;
}
function Workspace({ id }: { id: string }) {
  const { sessionKey, unitId, me, can } = useSession(), location = useLocation(), navigate = useNavigate(), client = useQueryClient();
  const expected = { id, unitId: unitId ?? '', companyIds: me?.scope.companyIds ?? [] };
  const allowed = !me?.scope.ownOnly && can('workers.read') && can('trabalhador:editar');
  const valid = nativeId.safeParse(id).success && Boolean(unitId && me?.scope.unitIds.includes(unitId));
  const snapshot = useVerifiedRead({ queryKey: ['native-worker-professional', sessionKey, unitId, id], enabled: allowed && valid,
    request: signal => nativeWorkerProfileApi.context<unknown>(id, signal), validate: value => checkedProfessionalContext(value, expected) });
  const origin = workerNavigation(location.state, sessionKey, unitId);
  const close = () => void navigate(`/app/trabalhadores/${id}?unitId=${unitId}`, { replace: true, state: origin });
  return <div className="stack"><PageHeader title="Editar cadastro profissional"/>
    {!allowed || !valid ? <Feedback tone="warning">Abra o trabalhador pela unidade autorizada para editar o cadastro.</Feedback>
      : snapshot.isError ? <><Feedback tone="danger">Não foi possível conferir a revisão e os acessos deste cadastro. Volte à ficha e atualize a consulta.</Feedback><Button variant="secondary" onClick={close}>Voltar ao trabalhador</Button></>
      : snapshot.data ? <Editor initial={snapshot.data} expected={expected} refreshing={snapshot.isFetching} onClose={close} onDone={async () => {
        await Promise.all(['worker','workers','worker-movements','native-worker-account','native-worker-professional','native-opening'].map(key => client.invalidateQueries({ queryKey: [key, sessionKey] })));
        void navigate(`/app/trabalhadores/${id}?unitId=${unitId}`, { replace: true, state: { ...origin, success: 'Cadastro profissional atualizado.' } });
      }}/>
      : <Spinner/>}
  </div>;
}
function Editor({ initial, expected, refreshing, onClose, onDone }: { initial: ProfessionalContext; expected: Parameters<typeof checkedProfessionalContext>[1]; refreshing: boolean; onClose: () => void; onDone: () => Promise<void> }) {
  const [opening] = useState(initial), [name, setName] = useState(initial.worker.name), [enrollment, setEnrollment] = useState(initial.worker.enrollment);
  const [departmentId, setDepartment] = useState(initial.worker.departmentId ?? ''), [positionId, setPosition] = useState(initial.worker.positionId ?? ''), [reason, setReason] = useState(''), [confirmed, confirm] = useState(false);
  const worker = opening.worker;
  const dirty = name !== worker.name || enrollment !== worker.enrollment || departmentId !== (worker.departmentId ?? '') || positionId !== (worker.positionId ?? '') || Boolean(reason);
  async function perform(signal: AbortSignal) {
    const parsed = professionalFields.safeParse({ name, enrollment, departmentId: departmentId || null, positionId: positionId || null, reason });
    if (!parsed.success) throw new NativeFormError(parsed.error.issues[0].message);
    if (!confirmed) throw new NativeFormError('Confirme as alterações profissionais.');
    const fields = parsed.data;
    const fresh = checkedProfessionalContext(await nativeWorkerProfileApi.context<unknown>(worker.id, signal), expected);
    if (fresh.worker.revision !== worker.revision) throw new NativeContextConflict('O cadastro mudou enquanto o formulário estava aberto. Seus dados foram mantidos; feche e confira a revisão atual.');
    if (fields.departmentId && !fresh.departments.some(d => d.id === fields.departmentId) || fields.positionId && !fresh.positions.some(p => p.id === fields.positionId)
      || fresh.requiresDepartment && !fields.departmentId) throw new NativeFormError('Selecione cargo e setor disponíveis no seu acesso.');
    const changedAssignment = fields.departmentId !== worker.departmentId || fields.positionId !== worker.positionId;
    if (changedAssignment && (!fields.departmentId || !fields.positionId)) throw new NativeFormError('Selecione cargo e setor para registrar a mudança profissional.');
    let response: unknown;
    try { response = await nativeWorkerProfileApi.update<unknown>(worker.id, { ...fields, expectedRevision: worker.revision, confirmation: true }, signal); }
    catch (error) { if (error instanceof ApiError && error.status === 409 && error.code === 'DUPLICATE_ENROLLMENT') throw new NativeFormError('Esta matrícula já está em uso na empresa. Informe outra matrícula.'); throw error; }
    const saved = checkedProfessionalReceipt(response, worker, fields);
    const stored = checkedProfessionalContext(await nativeWorkerProfileApi.context<unknown>(worker.id, signal), expected);
    if (JSON.stringify(stored.worker) !== JSON.stringify(saved)) throw new NativeContextConflict('A leitura posterior não confirmou o cadastro salvo. Atualize a ficha antes de repetir.');
  }
  return <NativeCommandDialog title="Editar cadastro profissional" dirty={dirty} disabled={!dirty || !confirmed || refreshing} submitLabel="Salvar alterações" onClose={onClose} onDone={onDone} perform={perform}>{busy => <>
    <p className="muted">{opening.unitName}</p>
    <Field label="Nome completo" required><input value={name} disabled={busy} maxLength={200} onChange={e => { setName(e.target.value); confirm(false); }}/></Field>
    <Field label="Matrícula" required><input value={enrollment} disabled={busy} maxLength={30} onChange={e => { setEnrollment(e.target.value); confirm(false); }}/></Field>
    <Field label="Cargo"><select value={positionId} disabled={busy} onChange={e => { setPosition(e.target.value); confirm(false); }}><option value="">Não informado</option>{worker.positionId && !opening.positions.some(p => p.id === worker.positionId) && <option value={worker.positionId} disabled>Cargo atual indisponível</option>}{opening.positions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
    <Field label="Setor" required={opening.requiresDepartment}><select value={departmentId} disabled={busy} onChange={e => { setDepartment(e.target.value); confirm(false); }}><option value="">Não informado</option>{opening.departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
    <Field label="Motivo da alteração" required><textarea value={reason} disabled={busy} maxLength={200} onChange={e => { setReason(e.target.value); confirm(false); }}/></Field>
    <label className="check-label"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => confirm(e.target.checked)}/>Confirmo as alterações profissionais deste trabalhador.</label>
  </>}</NativeCommandDialog>;
}

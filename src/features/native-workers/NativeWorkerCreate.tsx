import { useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api, createNativeWorker } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import { InvalidReadResponse, useVerifiedRead } from '../../shared/lib/verified-read';
import { Feedback, Field, PageHeader, Spinner } from '../../shared/ui';
import { NativeCommandDialog, NativeContextConflict, NativeFormError } from '../native-operations/NativeCommandDialog';
import { checkedWorkerDetail } from '../workers/worker-read';
import { workerNavigation } from '../workers/worker-navigation';
import { todayCivil } from '../workers/support';
import { checkedWorkerCreated, checkedWorkerDirectory, workerCreateBody } from './contracts';

export function NativeWorkerCreate() {
  const { sessionKey, unitId } = useSession();
  return <Create key={`${sessionKey}:${unitId}`}/>;
}
function Create() {
  const { sessionKey, unitId, me, can } = useSession(), location = useLocation(), navigate = useNavigate(), client = useQueryClient();
  const origin = workerNavigation(location.state, sessionKey, unitId), savedId = useRef('');
  const [name, setName] = useState(''), [enrollment, setEnrollment] = useState(''), [cpf, setCpf] = useState('');
  const [dateOfBirth, setBirth] = useState(''), [admissionDate, setAdmission] = useState(todayCivil()), [departmentId, setDepartment] = useState(''), [positionId, setPosition] = useState('');
  const allowed = can('trabalhador:criar') && can('workers.read'), catalogsAllowed = allowed && can('organization.read');
  const directory = useVerifiedRead({ queryKey: ['native-worker-create-directory', sessionKey, unitId], enabled: catalogsAllowed && Boolean(unitId),
    request: signal => api.get<unknown>('/organization', { query: { unitId }, signal }), validate: checkedWorkerDirectory });
  const unit = directory.data?.units.find(u => u.id === unitId && u.status === 'ACTIVE'), company = directory.data?.companies.find(c => c.id === unit?.companyId && c.status === 'ACTIVE');
  const ready = Boolean(allowed && me && unit && company && !directory.isFetching && !directory.isError);
  async function perform(signal: AbortSignal) {
    if (!ready || !me || !unit || !company || !directory.data) throw new NativeFormError('Selecione uma unidade autorizada e confira os dados da organização.');
    const body = workerCreateBody({ name, enrollment, cpf, dateOfBirth, admissionDate, departmentId, positionId }, company.id, unit.id, todayCivil());
    const fresh = checkedWorkerDirectory(await api.get<unknown>('/organization', { query: { unitId }, signal }));
    if (!fresh.units.some(u => u.id === unit.id && u.companyId === company.id && u.status === 'ACTIVE') || !fresh.companies.some(c => c.id === company.id && c.status === 'ACTIVE')
      || departmentId && !fresh.sectors.some(d => d.id === departmentId && d.unitId === unit.id && d.status === 'ACTIVE')
      || positionId && !fresh.jobs.some(p => p.id === positionId && p.companyId === company.id && p.status === 'ACTIVE')) throw new NativeContextConflict('A organização foi alterada. Atualize o cadastro antes de salvar.');
    const id = checkedWorkerCreated(await createNativeWorker<unknown>(body, { signal }), body);
    const raw = await api.get<unknown>(`/workers/${id}`, { signal }), person = checkedWorkerDetail(raw, id, unit.id);
    if (person.companyId !== company.id || person.unitId !== unit.id || person.fullName !== body.name || person.registration !== body.enrollment || person.admissionDate !== admissionDate || person.status !== 'ACTIVE'
      || (raw as { sectorId?: unknown }).sectorId !== body.departmentId || (raw as { jobId?: unknown }).jobId !== body.positionId) throw new InvalidReadResponse();
    savedId.current = id;
  }
  return <div className="stack"><PageHeader title="Novo trabalhador"/>{!allowed ? <Feedback tone="warning">Seu acesso não permite cadastrar trabalhadores.</Feedback> : <NativeCommandDialog inline title="Cadastrar trabalhador" dirty={Boolean(name || enrollment || cpf || dateOfBirth || departmentId || positionId || admissionDate !== todayCivil())} disabled={!ready} submitLabel="Cadastrar"
    perform={perform} onClose={() => void navigate(`/app/trabalhadores${origin?.workerListReturnTo.search ?? ''}`, { state: origin })}
    onDone={async () => { await client.invalidateQueries({ queryKey: ['workers', sessionKey] }); void navigate(`/app/trabalhadores/${savedId.current}`, { replace: true, state: origin }); }}>{(busy, errors) => <>
      {!unitId && <Feedback>Selecione a unidade de trabalho para iniciar o cadastro.</Feedback>}{!catalogsAllowed && <Feedback tone="warning">Seu acesso precisa permitir a consulta da organização para selecionar setor e cargo.</Feedback>}
      {directory.isPending && <Spinner/>}{directory.isError && <Feedback tone="danger">Não foi possível conferir a organização. Atualize a página antes de continuar.</Feedback>}
      {unit && company && <p>{company.name} · {unit.name}</p>}
      <Field label="Nome completo" required error={errors.name}><input maxLength={200} autoComplete="off" disabled={busy} value={name} onChange={e => setName(e.target.value)}/></Field>
      <div className="form-grid"><Field label="Matrícula" required error={errors.enrollment}><input maxLength={30} autoComplete="off" disabled={busy} value={enrollment} onChange={e => setEnrollment(e.target.value)}/></Field>
      <Field label="CPF" required error={errors.cpf}><input inputMode="numeric" maxLength={14} autoComplete="off" disabled={busy} value={cpf} onChange={e => setCpf(e.target.value)}/></Field>
      <Field label="Nascimento" required error={errors.dateOfBirth}><input type="date" max={todayCivil()} disabled={busy} value={dateOfBirth} onChange={e => setBirth(e.target.value)}/></Field>
      <Field label="Admissão" required error={errors.admissionDate}><input type="date" disabled={busy} value={admissionDate} onChange={e => setAdmission(e.target.value)}/></Field>
      <Field label="Setor"><select disabled={busy || !unit} value={departmentId} onChange={e => setDepartment(e.target.value)}><option value="">Não informado</option>{directory.data?.sectors.filter(s => s.unitId === unitId && s.status === 'ACTIVE').map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
      <Field label="Cargo"><select disabled={busy || !company} value={positionId} onChange={e => setPosition(e.target.value)}><option value="">Não informado</option>{directory.data?.jobs.filter(p => p.companyId === company?.id && p.status === 'ACTIVE').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field></div>
    </>}</NativeCommandDialog>}</div>;
}

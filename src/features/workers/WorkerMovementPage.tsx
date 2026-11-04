import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useController, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { api, revisionEtag } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { AssigneeDto, OrganizationDto, WorkerDto, WorkerMovementDto } from '../../shared/contracts';
import { Button, EmptyState, Feedback, Field, PageHeader, Spinner } from '../../shared/ui';
import { PagedSelect } from '../../shared/ui/PagedSelect';
import { usePagedLookup } from '../../shared/lib/use-paged-lookup';
import { allowedMovementTypes, assignmentError, errorMessage, fieldErrorsOf, movementLabels, QueryError, todayCivil, unavailableWorkerQuery, workerMovementSchema, type WorkerMovementValues } from './support';
import { UnsavedChanges } from './UnsavedChanges';
import { workerNavigation } from './worker-navigation';

type Values = WorkerMovementValues;

export function WorkerMovementPage() {
  const { id } = useParams();
  const { can, unitId, sessionKey } = useSession();
  const [reloadKey, setReloadKey] = useState(0);
  const contextKey = `${sessionKey}-${unitId}-${id}`;
  const currentContext = useRef(contextKey); currentContext.current = contextKey;
  const worker = useQuery({ queryKey: ['worker', sessionKey, unitId, id], queryFn: ({ signal }) => api.get<WorkerDto>(`/workers/${id}`, { signal }), enabled: can('workers.write') && Boolean(id), refetchOnMount: 'always', refetchOnWindowFocus: false, refetchOnReconnect: false });
  const organization = useQuery({ queryKey: ['organization', sessionKey, unitId], queryFn: ({ signal }) => api.get<OrganizationDto>('/organization', { signal, query: { unitId: unitId || undefined } }), enabled: can('workers.write') });
  if (!can('workers.write')) return <EmptyState title="Acesso restrito" description="Seu perfil não pode registrar movimentações de trabalhadores." />;
  if (worker.isPending || organization.isPending || !worker.isFetchedAfterMount && worker.isFetching) return <Spinner />;
  if (worker.isError && (!worker.data || unavailableWorkerQuery(worker.error))) return <QueryError error={worker.error} retry={() => void worker.refetch()} />;
  if (organization.isError && (!organization.data || unavailableWorkerQuery(organization.error))) return <QueryError error={organization.error} retry={() => void organization.refetch()} />;
  if (!worker.data || !organization.data) return null;
  const verified = !worker.isError && !worker.isFetching && !organization.isError && !organization.isFetching;
  return <MovementForm key={`${contextKey}-${reloadKey}`} initialWorker={worker.data} organization={organization.data} verified={verified} retry={() => { void worker.refetch(); void organization.refetch(); }} onReload={async () => { const result = await worker.refetch(); if (result.isError) throw result.error; if (currentContext.current === contextKey) setReloadKey(value => value + 1); }} />;
}

function MovementForm({ initialWorker, organization, verified, retry, onReload }: { initialWorker: WorkerDto; organization: OrganizationDto; verified: boolean; retry: () => void; onReload: () => Promise<void> }) {
  const [worker] = useState(initialWorker);
  const [reloading, setReloading] = useState(false);
  const { sessionKey, unitId } = useSession();
  const location = useLocation();
  const origin = worker.unitId === unitId ? workerNavigation(location.state, sessionKey, unitId) : undefined;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [saveError, setSaveError] = useState<unknown>();
  const pendingRequest = useRef<AbortController | null>(null);
  const lastRequest = useRef<{ payload: string; key: string } | undefined>(undefined);
  useEffect(() => () => { pendingRequest.current?.abort(); pendingRequest.current = null; }, []);
  const form = useForm<Values>({ resolver: zodResolver(workerMovementSchema(worker)), defaultValues: { type: worker.status === 'TERMINATED' ? 'ADMISSION' : worker.status === 'ON_LEAVE' ? 'RETURN' : 'TRANSFER', effectiveDate: todayCivil(), reason: '', companyId: worker.companyId, unitId: worker.unitId, sectorId: worker.sectorId, jobId: worker.jobId || '', jobFunctionId: worker.jobFunctionId || '', workCenterId: worker.workCenterId || '', managerId: worker.managerId || '' } });
  const setChangedValue = (name: keyof Values, value: string) => form.setValue(name, value, { shouldDirty: true });
  const values = form.watch();
  const manager = useController({ control: form.control, name: 'managerId' });
  const busy = form.formState.isSubmitting || reloading;
  const changesAssignment = values.type === 'TRANSFER' || values.type === 'ADMISSION';
  const assignees = usePagedLookup<AssigneeDto>({ queryKey: ['assignees', sessionKey, unitId, values.unitId, 'WORKER_MANAGER'], path: '/assignees', query: { unitId: values.unitId, purpose: 'WORKER_MANAGER' }, selectedIds: values.managerId ? [values.managerId] : [], enabled: Boolean(values.unitId) && changesAssignment && verified });
  const managerVerified = !changesAssignment || !values.managerId || assignees.verified && assignees.selectedItems.some(item => item.id === values.managerId);
  async function submit(data: Values) {
    if (reloading || pendingRequest.current) return;
    setSaveError(undefined);
    if (!verified) { setSaveError(new Error('Atualize o vínculo antes de registrar a movimentação. Seu preenchimento foi preservado.')); return; }
    const changesDestination = data.type === 'TRANSFER' || data.type === 'ADMISSION';
    if (changesDestination) {
      const invalid = assignmentError(data, organization); if (invalid) { setSaveError(new Error(invalid)); return; }
      if (data.managerId && (!assignees.verified || !assignees.selectedItems.some(item => item.id === data.managerId))) {
        form.setError('managerId', { message: 'Selecione um gestor disponível na unidade.' }, { shouldFocus: true }); return;
      }
    }
    const { type, effectiveDate, reason, ...assignment } = data;
    const newAssignment = changesDestination ? { ...assignment, jobId: assignment.jobId || null, jobFunctionId: assignment.jobFunctionId || null, workCenterId: assignment.workCenterId || null, managerId: assignment.managerId || null } : undefined;
    const payload = { type, effectiveDate, reason, ...(newAssignment ? { newAssignment } : {}) };
    const serialized = JSON.stringify(payload);
    if (lastRequest.current?.payload !== serialized) lastRequest.current = { payload: serialized, key: crypto.randomUUID() };
    const controller = new AbortController(); pendingRequest.current = controller;
    try {
      const result = await api.post<{ movement: WorkerMovementDto; worker: WorkerDto; createdPendingItems: number }>(`/workers/${worker.id}/movements`, payload, { etag: revisionEtag(worker.revision), idempotencyKey: lastRequest.current.key, signal: controller.signal });
      if (controller.signal.aborted) return;
      if (result.worker.id !== worker.id || result.worker.unitId !== (newAssignment?.unitId || worker.unitId)) throw new Error('A resposta não corresponde ao vínculo enviado. Seu preenchimento foi preservado.');
      for (const key of ['workers', 'worker', 'worker-movements', 'worker-documents', 'dashboard']) void queryClient.invalidateQueries({ queryKey: [key] });
      navigate(`/app/trabalhadores/${worker.id}`, { state: { ...origin, success: `Movimentação registrada. ${result.createdPendingItems} pendência(s) criada(s) pelos módulos habilitados.` } });
    } catch (error) {
      if (controller.signal.aborted) return;
      setSaveError(error);
      fieldErrorsOf(error).forEach((item, index) => { const field = item.field.replace('newAssignment.', '') as keyof Values; if (field in data) form.setError(field, { message: item.message }, { shouldFocus: index === 0 }); });
    } finally { if (pendingRequest.current === controller) pendingRequest.current = null; }
  }
  const options = (items: { id: string; name: string; status: string }[], selected: string) => {
    const active = items.filter(item => item.status === 'ACTIVE');
    return <>{active.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}{selected && !active.some(item => item.id === selected) && <option value={selected}>{items.find(item => item.id === selected)?.name || 'Vínculo selecionado'} · indisponível</option>}</>;
  };
  const error = (name: keyof Values) => form.formState.errors[name]?.message;
  async function reload() {
    if (form.formState.isDirty && !window.confirm('Descartar o preenchimento e carregar o vínculo atual?')) return;
    setReloading(true);
    try { await onReload(); } catch (error) { setSaveError(error); } finally { setReloading(false); }
  }
  return <>
    <UnsavedChanges protectContext dirty={form.formState.isDirty} busy={busy} />
    <PageHeader eyebrow="Histórico de vínculos" title="Registrar movimentação" description={worker.fullName} actions={<Link className="button button--secondary" to={`/app/trabalhadores/${worker.id}`} state={origin}>Voltar ao trabalhador</Link>} />
    <form className="panel stack" onSubmit={form.handleSubmit(submit)} noValidate>
      <Feedback tone="info">O vínculo anterior será preservado. As pendências são recalculadas pela API dos módulos habilitados.</Feedback>
      {saveError !== undefined && <Feedback tone="danger">{errorMessage(saveError)} <Button type="button" variant="ghost" disabled={busy} onClick={() => void reload()}>Recarregar vínculo</Button></Feedback>}
      {!verified && <Feedback tone="warning">Os dados estão sendo atualizados ou não puderam ser confirmados. Seu preenchimento foi preservado.<Button type="button" variant="ghost" disabled={busy} onClick={retry}>Atualizar dados</Button></Feedback>}
      <fieldset className="stack" disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <div className="form-grid"><Field label="Tipo de movimentação *" error={error('type')}><select {...form.register('type')}>{allowedMovementTypes(worker.status).map(value => <option key={value} value={value}>{movementLabels[value]}</option>)}</select></Field><Field label="Data efetiva *" error={error('effectiveDate')}><input type="date" min={worker.admissionDate} max={todayCivil()} {...form.register('effectiveDate')} /></Field></div>
      {changesAssignment && <fieldset className="stack"><legend>Vínculo de destino</legend><div className="form-grid">
        <Field label="Empresa *" error={error('companyId')}><select {...form.register('companyId')} value={values.companyId} onChange={event => { setChangedValue('companyId', event.target.value); ['unitId', 'sectorId', 'jobId', 'jobFunctionId', 'workCenterId', 'managerId'].forEach(name => setChangedValue(name as keyof Values, '')); }}><option value="">Selecione</option>{options(organization.companies, values.companyId)}</select></Field>
        <Field label="Unidade *" error={error('unitId')}><select {...form.register('unitId')} value={values.unitId} onChange={event => { setChangedValue('unitId', event.target.value); ['sectorId', 'workCenterId', 'managerId'].forEach(name => setChangedValue(name as keyof Values, '')); }}><option value="">Selecione</option>{options(organization.units.filter(item => item.companyId === values.companyId), values.unitId)}</select></Field>
        <Field label="Setor *" error={error('sectorId')}><select {...form.register('sectorId')} value={values.sectorId} onChange={event => { setChangedValue('sectorId', event.target.value); setChangedValue('workCenterId', ''); }}><option value="">Selecione</option>{options(organization.sectors.filter(item => item.unitId === values.unitId), values.sectorId)}</select></Field>
        <Field label="Cargo" error={error('jobId')}><select {...form.register('jobId')} value={values.jobId} onChange={event => { setChangedValue('jobId', event.target.value); setChangedValue('jobFunctionId', ''); }}><option value="">Não informado</option>{options(organization.jobs.filter(item => item.companyId === values.companyId), values.jobId)}</select></Field>
        <Field label="Função" error={error('jobFunctionId')}><select {...form.register('jobFunctionId')} value={values.jobFunctionId}><option value="">Não informado</option>{options(organization.jobFunctions.filter(item => item.companyId === values.companyId && (!item.jobId || item.jobId === values.jobId)), values.jobFunctionId)}</select></Field>
        <Field label="Centro de trabalho" error={error('workCenterId')}><select {...form.register('workCenterId')} value={values.workCenterId}><option value="">Não informado</option>{options(organization.workCenters.filter(item => item.unitId === values.unitId && (!item.sectorId || item.sectorId === values.sectorId)), values.workCenterId)}</select></Field>
        <PagedSelect lookup={assignees} label="Gestor" noun="gestores" value={manager.field.value || ''} onChange={value => { manager.field.onChange(value); form.clearErrors('managerId'); }} getLabel={item => item.displayName} emptyLabel="Não informado" error={error('managerId')} disabled={busy || !verified} />
      </div></fieldset>}
      <Field label="Motivo / justificativa *" error={error('reason')}><textarea rows={4} {...form.register('reason')} placeholder="Descreva o motivo desta alteração de vínculo." /></Field>
      </fieldset>
      <div className="actions"><Button type="submit" disabled={busy || !verified || !managerVerified}>{form.formState.isSubmitting ? 'Registrando…' : 'Confirmar movimentação'}</Button><Link className="button button--secondary" to={`/app/trabalhadores/${worker.id}`} state={origin}>Cancelar</Link></div>
    </form>
  </>;
}

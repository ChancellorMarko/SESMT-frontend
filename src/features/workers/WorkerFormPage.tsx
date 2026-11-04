import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useController, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { api, revisionEtag } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { WorkerDto, OrganizationDto, AssigneeDto } from '../../shared/contracts';
import { Button, EmptyState, Feedback, Field, PageHeader, Spinner } from '../../shared/ui';
import { PagedSelect } from '../../shared/ui/PagedSelect';
import { usePagedLookup } from '../../shared/lib/use-paged-lookup';
import { assignmentError, errorMessage, fieldErrorsOf, QueryError, todayCivil, unavailableWorkerQuery, workerFormSchema, type WorkerFormValues } from './support';
import { UnsavedChanges } from './UnsavedChanges';
import { workerNavigation } from './worker-navigation';

export function WorkerFormPage() {
  const { id } = useParams();
  const { unitId, sessionKey, can } = useSession();
  const [reloadKey, setReloadKey] = useState(0);
  const contextKey = `${sessionKey}-${unitId}-${id || 'new'}`;
  const currentContext = useRef(contextKey); currentContext.current = contextKey;
  const organization = useQuery({ queryKey: ['organization', sessionKey, unitId], queryFn: ({ signal }) => api.get<OrganizationDto>('/organization', { signal, query: { unitId: unitId || undefined } }), enabled: can('workers.write') });
  const worker = useQuery({ queryKey: ['worker', sessionKey, unitId, id], queryFn: ({ signal }) => api.get<WorkerDto>(`/workers/${id}`, { signal }), enabled: Boolean(id) && can('workers.write'), refetchOnMount: 'always', refetchOnWindowFocus: false, refetchOnReconnect: false });
  if (!can('workers.write')) return <EmptyState title="Acesso restrito" description="O cadastro de trabalhadores exige uma permissão de edição." />;
  if (organization.isPending || (id && (worker.isPending || !worker.isFetchedAfterMount && worker.isFetching))) return <Spinner />;
  if (organization.isError && (!organization.data || unavailableWorkerQuery(organization.error))) return <QueryError error={organization.error} retry={() => void organization.refetch()} />;
  if (id && worker.isError && (!worker.data || unavailableWorkerQuery(worker.error))) return <QueryError error={worker.error} retry={() => void worker.refetch()} />;
  if (!organization.data) return null;
  const verified = !organization.isError && !organization.isFetching && (!id || (!worker.isError && !worker.isFetching));
  return <WorkerForm key={`${contextKey}-${reloadKey}`} organization={organization.data} initialWorker={worker.data} selectedUnit={unitId} verified={verified} retry={() => { void organization.refetch(); if (id) void worker.refetch(); }} onReload={async () => { const result = await worker.refetch(); if (result.isError) throw result.error; if (currentContext.current === contextKey) setReloadKey(value => value + 1); }} />;
}

function WorkerForm({ organization, initialWorker, selectedUnit, verified, retry, onReload }: { organization: OrganizationDto; initialWorker?: WorkerDto; selectedUnit?: string | null; verified: boolean; retry: () => void; onReload: () => Promise<void> }) {
  const [worker] = useState(initialWorker);
  const [reloading, setReloading] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { sessionKey, unitId } = useSession();
  const location = useLocation();
  const origin = !worker || worker.unitId === unitId ? workerNavigation(location.state, sessionKey, unitId) : undefined;
  const backHref = worker ? `/app/trabalhadores/${worker.id}` : `/app/trabalhadores${origin?.workerListReturnTo.search ?? ''}`;
  const [saveError, setSaveError] = useState<unknown>();
  const pendingRequest = useRef<AbortController | null>(null);
  const lastRequest = useRef<{ payload: string; key: string } | undefined>(undefined);
  useEffect(() => () => { pendingRequest.current?.abort(); pendingRequest.current = null; }, []);
  const firstUnit = organization.units.find(item => item.id === selectedUnit);
  const form = useForm<WorkerFormValues>({ resolver: zodResolver(workerFormSchema), defaultValues: {
    registration: worker?.registration || '', fullName: worker?.fullName || '', employmentType: worker?.employmentType || '',
    companyId: worker?.companyId || firstUnit?.companyId || organization.companies[0]?.id || '', unitId: worker?.unitId || selectedUnit || '', sectorId: worker?.sectorId || '',
    admissionDate: worker?.admissionDate || todayCivil(), jobId: worker?.jobId || '', jobFunctionId: worker?.jobFunctionId || '', workCenterId: worker?.workCenterId || '', managerId: worker?.managerId || '',
  } });
  const setChangedValue = (name: keyof WorkerFormValues, value: string) => form.setValue(name, value, { shouldDirty: true });
  const values = form.watch();
  const manager = useController({ control: form.control, name: 'managerId' });
  const busy = form.formState.isSubmitting || reloading;
  const assignees = usePagedLookup<AssigneeDto>({ queryKey: ['assignees', sessionKey, unitId, values.unitId, 'WORKER_MANAGER'], path: '/assignees', query: { unitId: values.unitId, purpose: 'WORKER_MANAGER' }, selectedIds: values.managerId ? [values.managerId] : [], enabled: Boolean(values.unitId) && verified });
  const managerRequiresVerification = Boolean(values.managerId && (!worker || values.managerId !== worker.managerId));
  const managerVerified = !managerRequiresVerification || assignees.verified && assignees.selectedItems.some(item => item.id === values.managerId);
  async function submit(data: WorkerFormValues) {
    if (reloading || pendingRequest.current) return;
    setSaveError(undefined);
    if (!verified) { setSaveError(new Error('Atualize os dados antes de salvar. Seu preenchimento foi preservado.')); return; }
    if (!worker) {
      const invalid = assignmentError(data, organization);
      if (invalid) { setSaveError(new Error(invalid)); return; }
    }
    if (data.managerId && (!worker || data.managerId !== worker.managerId) && (!assignees.verified || !assignees.selectedItems.some(item => item.id === data.managerId))) {
      form.setError('managerId', { message: 'Selecione um gestor disponível na unidade.' }, { shouldFocus: true }); return;
    }
    const payload = worker ? { registration: data.registration, fullName: data.fullName, employmentType: data.employmentType, managerId: data.managerId || null } : Object.fromEntries(Object.entries(data).filter(([, value]) => value !== ''));
    const serialized = JSON.stringify(payload);
    if (lastRequest.current?.payload !== serialized) lastRequest.current = { payload: serialized, key: crypto.randomUUID() };
    const controller = new AbortController(); pendingRequest.current = controller;
    try {
      const saved = worker ? await api.patch<WorkerDto>(`/workers/${worker.id}`, payload, { etag: revisionEtag(worker.revision), signal: controller.signal }) : await api.post<WorkerDto>('/workers', payload, { idempotencyKey: lastRequest.current.key, signal: controller.signal });
      if (controller.signal.aborted) return;
      if (saved.unitId !== data.unitId || (worker && saved.id !== worker.id)) throw new Error('A resposta não corresponde ao cadastro enviado. Seu preenchimento foi preservado.');
      void queryClient.invalidateQueries({ queryKey: ['workers'] });
      void queryClient.invalidateQueries({ queryKey: ['worker'] });
      navigate(`/app/trabalhadores/${saved.id}`, { state: { ...(saved.unitId === unitId ? origin : undefined), success: worker ? 'Cadastro atualizado.' : 'Trabalhador cadastrado.' } });
    } catch (error) {
      if (controller.signal.aborted) return;
      setSaveError(error);
      fieldErrorsOf(error).forEach((item, index) => { if (item.field in data) form.setError(item.field as keyof WorkerFormValues, { message: item.message }, { shouldFocus: index === 0 }); });
    } finally { if (pendingRequest.current === controller) pendingRequest.current = null; }
  }
  const options = (items: { id: string; name: string; status: string }[], selected: string) => {
    const active = items.filter(item => item.status === 'ACTIVE');
    return <>{active.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}{selected && !active.some(item => item.id === selected) && <option value={selected}>{items.find(item => item.id === selected)?.name || 'Vínculo selecionado'} · indisponível</option>}</>;
  };
  const error = (name: keyof WorkerFormValues) => form.formState.errors[name]?.message;
  async function reload() {
    if (form.formState.isDirty && !window.confirm('Descartar o preenchimento e carregar o cadastro atual?')) return;
    setReloading(true);
    try { await onReload(); } catch (error) { setSaveError(error); } finally { setReloading(false); }
  }
  return <>
    <UnsavedChanges protectContext dirty={form.formState.isDirty} busy={busy} />
    <PageHeader eyebrow="Trabalhadores" title={worker ? 'Editar cadastro' : 'Novo trabalhador'} description="Registre somente os dados necessários para o vínculo ocupacional." actions={<Link className="button button--secondary" to={backHref} state={origin}>Voltar</Link>} />
    <form className="panel stack" onSubmit={form.handleSubmit(submit)} noValidate>
      {saveError !== undefined && <Feedback tone="danger">{errorMessage(saveError)} {worker && <Button type="button" variant="ghost" disabled={busy} onClick={() => void reload()}>Recarregar cadastro</Button>}</Feedback>}
      {!verified && <Feedback tone="warning">Os dados estão sendo atualizados ou não puderam ser confirmados. Seu preenchimento foi preservado.<Button type="button" variant="ghost" disabled={busy} onClick={retry}>Atualizar dados</Button></Feedback>}
      {worker && <Feedback tone="info">Mudanças de unidade, setor, cargo, função e situação são registradas em uma movimentação para preservar o histórico.</Feedback>}
      <fieldset className="form-grid" disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <Field label="Nome completo *" error={error('fullName')}><input {...form.register('fullName')} autoComplete="name" /></Field>
        <Field label="Matrícula *" error={error('registration')}><input {...form.register('registration')} /></Field>
        <Field label="Tipo de vínculo *" error={error('employmentType')}><input {...form.register('employmentType')} placeholder="Ex.: CLT, temporário" /></Field>
        <Field label="Data de admissão *" error={error('admissionDate')}><input type="date" {...form.register('admissionDate')} disabled={Boolean(worker)} /></Field>
        <Field label="Empresa *" error={error('companyId')}><select {...form.register('companyId')} value={values.companyId} disabled={Boolean(worker)} onChange={event => { setChangedValue('companyId', event.target.value); ['unitId', 'sectorId', 'jobId', 'jobFunctionId', 'workCenterId', 'managerId'].forEach(name => setChangedValue(name as keyof WorkerFormValues, '')); }}><option value="">Selecione</option>{options(organization.companies, values.companyId)}</select></Field>
        <Field label="Unidade *" error={error('unitId')}><select {...form.register('unitId')} value={values.unitId} disabled={Boolean(worker)} onChange={event => { setChangedValue('unitId', event.target.value); ['sectorId', 'workCenterId', 'managerId'].forEach(name => setChangedValue(name as keyof WorkerFormValues, '')); }}><option value="">Selecione</option>{options(organization.units.filter(item => item.companyId === values.companyId), values.unitId)}</select></Field>
        <Field label="Setor *" error={error('sectorId')}><select {...form.register('sectorId')} value={values.sectorId} disabled={Boolean(worker)} onChange={event => { setChangedValue('sectorId', event.target.value); setChangedValue('workCenterId', ''); }}><option value="">Selecione</option>{options(organization.sectors.filter(item => item.unitId === values.unitId), values.sectorId)}</select></Field>
        <Field label="Cargo" error={error('jobId')}><select {...form.register('jobId')} value={values.jobId} disabled={Boolean(worker)} onChange={event => { setChangedValue('jobId', event.target.value); setChangedValue('jobFunctionId', ''); }}><option value="">Não informado</option>{options(organization.jobs.filter(item => item.companyId === values.companyId), values.jobId)}</select></Field>
        <Field label="Função" error={error('jobFunctionId')}><select {...form.register('jobFunctionId')} value={values.jobFunctionId} disabled={Boolean(worker)}><option value="">Não informado</option>{options(organization.jobFunctions.filter(item => item.companyId === values.companyId && (!item.jobId || item.jobId === values.jobId)), values.jobFunctionId)}</select></Field>
        <Field label="Centro de trabalho" error={error('workCenterId')}><select {...form.register('workCenterId')} value={values.workCenterId} disabled={Boolean(worker)}><option value="">Não informado</option>{options(organization.workCenters.filter(item => item.unitId === values.unitId && (!item.sectorId || item.sectorId === values.sectorId)), values.workCenterId)}</select></Field>
        <PagedSelect lookup={assignees} label="Gestor" noun="gestores" value={manager.field.value || ''} onChange={value => { manager.field.onChange(value); form.clearErrors('managerId'); }} getLabel={item => item.displayName} emptyLabel="Não informado" error={error('managerId')} disabled={busy || !verified} />
      </fieldset>
      <div className="actions"><Button type="submit" disabled={busy || !verified || !managerVerified}>{form.formState.isSubmitting ? 'Salvando…' : 'Salvar cadastro'}</Button><Link className="button button--secondary" to={backHref} state={origin}>Cancelar</Link></div>
    </form>
  </>;
}

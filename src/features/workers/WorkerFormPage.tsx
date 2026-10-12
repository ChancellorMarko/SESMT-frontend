import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { api, revisionEtag } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { WorkerDto, OrganizationDto, AssigneeDto, PageDto } from '../../shared/contracts';
import { Button, EmptyState, Feedback, Field, PageHeader, Spinner } from '../../shared/ui';
import { assignmentError, errorMessage, fieldErrorsOf, QueryError, todayCivil, workerFormSchema, type WorkerFormValues } from './support';
import { UnsavedChanges } from './UnsavedChanges';

export function WorkerFormPage() {
  const { id } = useParams();
  const { unitId, sessionKey, can } = useSession();
  const [reloadKey, setReloadKey] = useState(0);
  const organization = useQuery({ queryKey: ['organization', sessionKey, unitId], queryFn: ({ signal }) => api.get<OrganizationDto>('/organization', { signal, query: { unitId: unitId || undefined } }), enabled: can('workers.write') });
  const worker = useQuery({ queryKey: ['worker', sessionKey, unitId, id], queryFn: ({ signal }) => api.get<WorkerDto>(`/workers/${id}`, { signal }), enabled: Boolean(id) && can('workers.write'), refetchOnMount: 'always', refetchOnWindowFocus: false, refetchOnReconnect: false });
  if (!can('workers.write')) return <EmptyState title="Acesso restrito" description="O cadastro de trabalhadores exige uma permissão de edição." />;
  if (organization.isPending || (id && worker.isPending)) return <Spinner />;
  if (organization.isError && !organization.data) return <QueryError error={organization.error} retry={() => void organization.refetch()} />;
  if (id && worker.isError && !worker.data) return <QueryError error={worker.error} retry={() => void worker.refetch()} />;
  if (!organization.data) return null;
  return <WorkerForm key={`${sessionKey}-${unitId}-${id || 'new'}-${reloadKey}`} organization={organization.data} initialWorker={worker.data} selectedUnit={unitId} onReload={async () => { const result = await worker.refetch(); if (result.isError) throw result.error; setReloadKey(value => value + 1); }} />;
}

function WorkerForm({ organization, initialWorker, selectedUnit, onReload }: { organization: OrganizationDto; initialWorker?: WorkerDto; selectedUnit?: string | null; onReload: () => Promise<void> }) {
  const [worker] = useState(initialWorker);
  const [reloading, setReloading] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { sessionKey, unitId } = useSession();
  const [saveError, setSaveError] = useState<unknown>();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const firstUnit = organization.units.find(item => item.id === selectedUnit);
  const form = useForm<WorkerFormValues>({ resolver: zodResolver(workerFormSchema), defaultValues: {
    registration: worker?.registration || '', fullName: worker?.fullName || '', employmentType: worker?.employmentType || '',
    companyId: worker?.companyId || firstUnit?.companyId || organization.companies[0]?.id || '', unitId: worker?.unitId || selectedUnit || '', sectorId: worker?.sectorId || '',
    admissionDate: worker?.admissionDate || todayCivil(), jobId: worker?.jobId || '', jobFunctionId: worker?.jobFunctionId || '', workCenterId: worker?.workCenterId || '', managerId: worker?.managerId || '',
  } });
  const setChangedValue = (name: keyof WorkerFormValues, value: string) => form.setValue(name, value, { shouldDirty: true });
  const values = form.watch();
  const busy = form.formState.isSubmitting || reloading;
  const assignees = useQuery({ queryKey: ['assignees', sessionKey, unitId, values.unitId, 'WORKER_MANAGER'], queryFn: ({ signal }) => api.get<PageDto<AssigneeDto>>('/assignees', { signal, query: { unitId: values.unitId, purpose: 'WORKER_MANAGER', pageSize: 100 } }), enabled: Boolean(values.unitId) });
  async function submit(data: WorkerFormValues) {
    if (reloading) return;
    setSaveError(undefined);
    if (!worker) {
      const invalid = assignmentError(data, organization);
      if (invalid) { setSaveError(new Error(invalid)); return; }
    }
    try {
      const payload = worker ? { registration: data.registration, fullName: data.fullName, employmentType: data.employmentType, managerId: data.managerId || null } : Object.fromEntries(Object.entries(data).filter(([, value]) => value !== ''));
      const saved = worker ? await api.patch<WorkerDto>(`/workers/${worker.id}`, payload, { etag: revisionEtag(worker.revision) }) : await api.post<WorkerDto>('/workers', payload, { idempotencyKey });
      await queryClient.invalidateQueries({ queryKey: ['workers'] });
      await queryClient.invalidateQueries({ queryKey: ['worker'] });
      navigate(`/app/trabalhadores/${saved.id}`, { state: { success: worker ? 'Cadastro atualizado.' : 'Trabalhador cadastrado.' } });
    } catch (error) {
      setSaveError(error);
      fieldErrorsOf(error).forEach((item, index) => { if (item.field in data) form.setError(item.field as keyof WorkerFormValues, { message: item.message }, { shouldFocus: index === 0 }); });
    }
  }
  const options = (items: { id: string; name: string; status: string }[]) => items.filter(item => item.status === 'ACTIVE').map(item => <option key={item.id} value={item.id}>{item.name}</option>);
  const error = (name: keyof WorkerFormValues) => form.formState.errors[name]?.message;
  async function reload() {
    if (form.formState.isDirty && !window.confirm('Descartar o preenchimento e carregar o cadastro atual?')) return;
    setReloading(true);
    try { await onReload(); } catch (error) { setSaveError(error); } finally { setReloading(false); }
  }
  return <>
    <UnsavedChanges protectContext dirty={form.formState.isDirty} busy={busy} />
    <PageHeader eyebrow="Trabalhadores" title={worker ? 'Editar cadastro' : 'Novo trabalhador'} description="Registre somente os dados necessários para o vínculo ocupacional." actions={<Link className="button button--secondary" to={worker ? `/app/trabalhadores/${worker.id}` : '/app/trabalhadores'}>Voltar</Link>} />
    <form className="panel stack" onSubmit={form.handleSubmit(submit)} noValidate>
      {saveError !== undefined && <Feedback tone="danger">{errorMessage(saveError)} {worker && <Button type="button" variant="ghost" disabled={busy} onClick={() => void reload()}>Recarregar cadastro</Button>}</Feedback>}
      {worker && <Feedback tone="info">Mudanças de unidade, setor, cargo, função e situação são registradas em uma movimentação para preservar o histórico.</Feedback>}
      <fieldset className="form-grid" disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <Field label="Nome completo *" error={error('fullName')}><input {...form.register('fullName')} autoComplete="name" /></Field>
        <Field label="Matrícula *" error={error('registration')}><input {...form.register('registration')} /></Field>
        <Field label="Tipo de vínculo *" error={error('employmentType')}><input {...form.register('employmentType')} placeholder="Ex.: CLT, temporário" /></Field>
        <Field label="Data de admissão *" error={error('admissionDate')}><input type="date" {...form.register('admissionDate')} disabled={Boolean(worker)} /></Field>
        <Field label="Empresa *" error={error('companyId')}><select {...form.register('companyId')} disabled={Boolean(worker)} onChange={event => { setChangedValue('companyId', event.target.value); ['unitId', 'sectorId', 'jobId', 'jobFunctionId', 'workCenterId', 'managerId'].forEach(name => setChangedValue(name as keyof WorkerFormValues, '')); }}><option value="">Selecione</option>{options(organization.companies)}</select></Field>
        <Field label="Unidade *" error={error('unitId')}><select {...form.register('unitId')} disabled={Boolean(worker)} onChange={event => { setChangedValue('unitId', event.target.value); ['sectorId', 'workCenterId', 'managerId'].forEach(name => setChangedValue(name as keyof WorkerFormValues, '')); }}><option value="">Selecione</option>{options(organization.units.filter(item => item.companyId === values.companyId))}</select></Field>
        <Field label="Setor *" error={error('sectorId')}><select {...form.register('sectorId')} disabled={Boolean(worker)} onChange={event => { setChangedValue('sectorId', event.target.value); setChangedValue('workCenterId', ''); }}><option value="">Selecione</option>{options(organization.sectors.filter(item => item.unitId === values.unitId))}</select></Field>
        <Field label="Cargo" error={error('jobId')}><select {...form.register('jobId')} disabled={Boolean(worker)} onChange={event => { setChangedValue('jobId', event.target.value); setChangedValue('jobFunctionId', ''); }}><option value="">Não informado</option>{options(organization.jobs.filter(item => item.companyId === values.companyId))}</select></Field>
        <Field label="Função" error={error('jobFunctionId')}><select {...form.register('jobFunctionId')} disabled={Boolean(worker)}><option value="">Não informado</option>{options(organization.jobFunctions.filter(item => item.companyId === values.companyId && (!item.jobId || item.jobId === values.jobId)))}</select></Field>
        <Field label="Centro de trabalho" error={error('workCenterId')}><select {...form.register('workCenterId')} disabled={Boolean(worker)}><option value="">Não informado</option>{options(organization.workCenters.filter(item => item.unitId === values.unitId && (!item.sectorId || item.sectorId === values.sectorId)))}</select></Field>
        <Field label="Gestor" error={error('managerId')}><select {...form.register('managerId')} disabled={assignees.isPending || assignees.isError}><option value="">Não informado</option>{worker?.managerId && !assignees.data?.items.some(item => item.id === worker.managerId) && <option value={worker.managerId}>Gestor vinculado</option>}{assignees.data?.items.map(item => <option value={item.id} key={item.id}>{item.displayName}</option>)}</select></Field>
      </fieldset>
      {assignees.isError && <QueryError error={assignees.error} retry={() => void assignees.refetch()} />}
      <div className="actions"><Button type="submit" disabled={busy}>{form.formState.isSubmitting ? 'Salvando…' : 'Salvar cadastro'}</Button><Link className="button button--secondary" to={worker ? `/app/trabalhadores/${worker.id}` : '/app/trabalhadores'}>Cancelar</Link></div>
    </form>
  </>;
}

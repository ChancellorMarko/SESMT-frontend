import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api, revisionEtag } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { AssigneeDto, OrganizationDto, PageDto, WorkerDto, WorkerMovementDto } from '../../shared/contracts';
import { Button, EmptyState, Feedback, Field, PageHeader, Spinner } from '../../shared/ui';
import { assignmentError, errorMessage, fieldErrorsOf, movementLabels, QueryError, todayCivil, validCivil } from './support';
import { UnsavedChanges } from './UnsavedChanges';

const schema = z.object({ type: z.enum(['ADMISSION', 'TRANSFER', 'LEAVE', 'RETURN', 'TERMINATION']), effectiveDate: z.string().refine(validCivil, 'Informe uma data válida.'), reason: z.string().trim().min(2, 'Descreva o motivo da movimentação.'), companyId: z.string(), unitId: z.string(), sectorId: z.string(), jobId: z.string(), jobFunctionId: z.string(), workCenterId: z.string(), managerId: z.string() }).superRefine((values, context) => {
  if (values.type === 'TRANSFER' || values.type === 'ADMISSION') {
    for (const field of ['companyId', 'unitId', 'sectorId'] as const) if (!values[field]) context.addIssue({ code: 'custom', path: [field], message: 'Selecione o vínculo de destino.' });
  }
});
type Values = z.infer<typeof schema>;

export function WorkerMovementPage() {
  const { id } = useParams();
  const { can, unitId, sessionKey } = useSession();
  const [reloadKey, setReloadKey] = useState(0);
  const worker = useQuery({ queryKey: ['worker', sessionKey, unitId, id], queryFn: ({ signal }) => api.get<WorkerDto>(`/workers/${id}`, { signal }), enabled: can('workers.write') && Boolean(id), refetchOnMount: 'always', refetchOnWindowFocus: false, refetchOnReconnect: false });
  const organization = useQuery({ queryKey: ['organization', sessionKey, unitId], queryFn: ({ signal }) => api.get<OrganizationDto>('/organization', { signal, query: { unitId: unitId || undefined } }), enabled: can('workers.write') });
  if (!can('workers.write')) return <EmptyState title="Acesso restrito" description="Seu perfil não pode registrar movimentações de trabalhadores." />;
  if (worker.isPending || organization.isPending) return <Spinner />;
  if (worker.isError && !worker.data) return <QueryError error={worker.error} retry={() => void worker.refetch()} />;
  if (organization.isError && !organization.data) return <QueryError error={organization.error} retry={() => void organization.refetch()} />;
  if (!worker.data || !organization.data) return null;
  return <MovementForm key={`${sessionKey}-${unitId}-${id}-${reloadKey}`} initialWorker={worker.data} organization={organization.data} onReload={async () => { const result = await worker.refetch(); if (result.isError) throw result.error; setReloadKey(value => value + 1); }} />;
}

function MovementForm({ initialWorker, organization, onReload }: { initialWorker: WorkerDto; organization: OrganizationDto; onReload: () => Promise<void> }) {
  const [worker] = useState(initialWorker);
  const [reloading, setReloading] = useState(false);
  const { sessionKey, unitId } = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [saveError, setSaveError] = useState<unknown>();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { type: worker.status === 'TERMINATED' ? 'ADMISSION' : worker.status === 'ON_LEAVE' ? 'RETURN' : 'TRANSFER', effectiveDate: todayCivil(), reason: '', companyId: worker.companyId, unitId: worker.unitId, sectorId: worker.sectorId, jobId: worker.jobId || '', jobFunctionId: worker.jobFunctionId || '', workCenterId: worker.workCenterId || '', managerId: worker.managerId || '' } });
  const setChangedValue = (name: keyof Values, value: string) => form.setValue(name, value, { shouldDirty: true });
  const values = form.watch();
  const busy = form.formState.isSubmitting || reloading;
  const changesAssignment = values.type === 'TRANSFER' || values.type === 'ADMISSION';
  const assignees = useQuery({ queryKey: ['assignees', sessionKey, unitId, values.unitId, 'WORKER_MANAGER'], queryFn: ({ signal }) => api.get<PageDto<AssigneeDto>>('/assignees', { signal, query: { unitId: values.unitId, purpose: 'WORKER_MANAGER', pageSize: 100 } }), enabled: Boolean(values.unitId) && changesAssignment });
  async function submit(data: Values) {
    if (reloading) return;
    setSaveError(undefined);
    if (changesAssignment) { const invalid = assignmentError(data, organization); if (invalid) { setSaveError(new Error(invalid)); return; } }
    const { type, effectiveDate, reason, ...assignment } = data;
    const newAssignment = changesAssignment ? Object.fromEntries(Object.entries(assignment).filter(([, value]) => value !== '')) : undefined;
    try {
      const result = await api.post<{ movement: WorkerMovementDto; worker: WorkerDto; createdPendingItems: number }>(`/workers/${worker.id}/movements`, { type, effectiveDate, reason, ...(newAssignment ? { newAssignment } : {}) }, { etag: revisionEtag(worker.revision), idempotencyKey });
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['workers'] }), queryClient.invalidateQueries({ queryKey: ['worker'] }), queryClient.invalidateQueries({ queryKey: ['worker-movements'] }), queryClient.invalidateQueries({ queryKey: ['dashboard'] })]);
      navigate(`/app/trabalhadores/${worker.id}`, { state: { success: `Movimentação registrada. ${result.createdPendingItems} pendência(s) criada(s) pelos módulos habilitados.` } });
    } catch (error) {
      setSaveError(error);
      fieldErrorsOf(error).forEach((item, index) => { const field = item.field.replace('newAssignment.', '') as keyof Values; if (field in data) form.setError(field, { message: item.message }, { shouldFocus: index === 0 }); });
    }
  }
  const options = (items: { id: string; name: string; status: string }[]) => items.filter(item => item.status === 'ACTIVE').map(item => <option value={item.id} key={item.id}>{item.name}</option>);
  const error = (name: keyof Values) => form.formState.errors[name]?.message;
  async function reload() {
    if (form.formState.isDirty && !window.confirm('Descartar o preenchimento e carregar o vínculo atual?')) return;
    setReloading(true);
    try { await onReload(); } catch (error) { setSaveError(error); } finally { setReloading(false); }
  }
  return <>
    <UnsavedChanges protectContext dirty={form.formState.isDirty} busy={busy} />
    <PageHeader eyebrow="Histórico de vínculos" title="Registrar movimentação" description={worker.fullName} actions={<Link className="button button--secondary" to={`/app/trabalhadores/${worker.id}`}>Voltar ao trabalhador</Link>} />
    <form className="panel stack" onSubmit={form.handleSubmit(submit)} noValidate>
      <Feedback tone="info">O vínculo anterior será preservado. As pendências são recalculadas pela API dos módulos habilitados.</Feedback>
      {saveError !== undefined && <Feedback tone="danger">{errorMessage(saveError)} <Button type="button" variant="ghost" disabled={busy} onClick={() => void reload()}>Recarregar vínculo</Button></Feedback>}
      <fieldset className="stack" disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <div className="form-grid"><Field label="Tipo de movimentação *" error={error('type')}><select {...form.register('type')}>{Object.entries(movementLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label="Data efetiva *" error={error('effectiveDate')}><input type="date" {...form.register('effectiveDate')} /></Field></div>
      {changesAssignment && <fieldset className="stack"><legend>Vínculo de destino</legend><div className="form-grid">
        <Field label="Empresa *" error={error('companyId')}><select {...form.register('companyId')} onChange={event => { setChangedValue('companyId', event.target.value); ['unitId', 'sectorId', 'jobId', 'jobFunctionId', 'workCenterId', 'managerId'].forEach(name => setChangedValue(name as keyof Values, '')); }}><option value="">Selecione</option>{options(organization.companies)}</select></Field>
        <Field label="Unidade *" error={error('unitId')}><select {...form.register('unitId')} onChange={event => { setChangedValue('unitId', event.target.value); ['sectorId', 'workCenterId', 'managerId'].forEach(name => setChangedValue(name as keyof Values, '')); }}><option value="">Selecione</option>{options(organization.units.filter(item => item.companyId === values.companyId))}</select></Field>
        <Field label="Setor *" error={error('sectorId')}><select {...form.register('sectorId')} onChange={event => { setChangedValue('sectorId', event.target.value); setChangedValue('workCenterId', ''); }}><option value="">Selecione</option>{options(organization.sectors.filter(item => item.unitId === values.unitId))}</select></Field>
        <Field label="Cargo"><select {...form.register('jobId')} onChange={event => { setChangedValue('jobId', event.target.value); setChangedValue('jobFunctionId', ''); }}><option value="">Não informado</option>{options(organization.jobs.filter(item => item.companyId === values.companyId))}</select></Field>
        <Field label="Função"><select {...form.register('jobFunctionId')}><option value="">Não informado</option>{options(organization.jobFunctions.filter(item => item.companyId === values.companyId && (!item.jobId || item.jobId === values.jobId)))}</select></Field>
        <Field label="Centro de trabalho"><select {...form.register('workCenterId')}><option value="">Não informado</option>{options(organization.workCenters.filter(item => item.unitId === values.unitId && (!item.sectorId || item.sectorId === values.sectorId)))}</select></Field>
        <Field label="Gestor"><select {...form.register('managerId')} disabled={assignees.isPending || assignees.isError}><option value="">Não informado</option>{worker.managerId && !assignees.data?.items.some(item => item.id === worker.managerId) && <option value={worker.managerId}>Gestor vinculado</option>}{assignees.data?.items.map(item => <option value={item.id} key={item.id}>{item.displayName}</option>)}</select></Field>
      </div>{assignees.isError && <QueryError error={assignees.error} retry={() => void assignees.refetch()} />}</fieldset>}
      <Field label="Motivo / justificativa *" error={error('reason')}><textarea rows={4} {...form.register('reason')} placeholder="Descreva o motivo desta alteração de vínculo." /></Field>
      </fieldset>
      <div className="actions"><Button type="submit" disabled={busy}>{form.formState.isSubmitting ? 'Registrando…' : 'Confirmar movimentação'}</Button><Link className="button button--secondary" to={`/app/trabalhadores/${worker.id}`}>Cancelar</Link></div>
    </form>
  </>;
}

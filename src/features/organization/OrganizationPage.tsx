import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api, revisionEtag } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { AssigneeDto, OrganizationDto, OrganizationItemDto, PageDto } from '../../shared/contracts';
import { Badge, Button, EmptyState, Feedback, Field, Modal, PageHeader, Spinner } from '../../shared/ui';
import { errorMessage, fieldErrorsOf, QueryError } from '../workers/support';
import { useEditorProtection } from '../administration/useEditorProtection';

const resources = [
  { key: 'companies', path: 'companies', label: 'Empresas', singular: 'empresa' },
  { key: 'establishments', path: 'establishments', label: 'Estabelecimentos', singular: 'estabelecimento' },
  { key: 'units', path: 'units', label: 'Unidades', singular: 'unidade' },
  { key: 'sectors', path: 'sectors', label: 'Setores', singular: 'setor' },
  { key: 'jobs', path: 'jobs', label: 'Cargos', singular: 'cargo' },
  { key: 'jobFunctions', path: 'job-functions', label: 'Funções', singular: 'função' },
  { key: 'workCenters', path: 'work-centers', label: 'Centros de trabalho', singular: 'centro de trabalho' },
] as const;
type Resource = typeof resources[number];
const formSchema = z.object({ name: z.string().trim().min(2, 'Informe um nome com pelo menos 2 caracteres.'), code: z.string().trim(), taxId: z.string(), companyId: z.string(), establishmentId: z.string(), unitId: z.string(), sectorId: z.string(), jobId: z.string(), address: z.string().trim(), description: z.string().trim(), occupationCode: z.string().trim(), responsibleIds: z.array(z.string()) });
type Values = z.infer<typeof formSchema>;

export function OrganizationPage() {
  const { can, sessionKey, unitId } = useSession();
  const [resource, setResource] = useState<Resource>(resources[2]);
  const [modal, setModal] = useState<{ item?: OrganizationItemDto } | null>(null);
  const [confirm, setConfirm] = useState<OrganizationItemDto | null>(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [isSavingForm, setIsSavingForm] = useState(false);
  const [isFormDirty, setIsFormDirty] = useState(false);
  const [statusError, setStatusError] = useState<unknown>();
  const [success, setSuccess] = useState('');
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const queryClient = useQueryClient();
  const closeForm = useEditorProtection({ dirty: isFormDirty, busy: isSavingForm || isUpdatingStatus }, () => setModal(null));
  const organization = useQuery({ queryKey: ['organization', sessionKey, unitId, 'all'], queryFn: ({ signal }) => api.get<OrganizationDto>('/organization', { signal, query: { unitId: unitId || undefined, includeInactive: true } }), enabled: can('organization.read') });
  async function toggleStatus() {
    if (!confirm || isUpdatingStatus || !can('organization.write')) return;
    setIsUpdatingStatus(true); setStatusError(undefined);
    try {
      await api.patch<OrganizationItemDto>(`/${resource.path}/${confirm.id}`, { status: confirm.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }, { etag: revisionEtag(confirm.revision) });
      await queryClient.invalidateQueries({ queryKey: ['organization'] });
      setSuccess(confirm.status === 'ACTIVE' ? 'Cadastro inativado. Os vínculos e o histórico foram preservados.' : 'Cadastro reativado.');
      setConfirm(null);
    } catch (error) { setStatusError(error); } finally { setIsUpdatingStatus(false); }
  }
  if (!can('organization.read')) return <EmptyState title="Acesso restrito" description="Seu perfil não pode consultar a estrutura organizacional." />;
  const data = organization.data;
  const items = data?.[resource.key].filter(item => (showInactive || item.status === 'ACTIVE') && `${item.name} ${item.code || ''}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR'))) || [];
  function parentName(item: OrganizationItemDto) { return data?.sectors.find(parent => parent.id === item.sectorId)?.name || data?.units.find(parent => parent.id === item.unitId)?.name || data?.jobs.find(parent => parent.id === item.jobId)?.name || data?.companies.find(parent => parent.id === item.companyId)?.name || 'Organização'; }
  return <>
    <PageHeader eyebrow="Base organizacional" title="Estrutura da organização" description="Organize unidades, setores e vínculos para manter cada registro no contexto correto." actions={can('organization.write') && <Button onClick={() => { setSuccess(''); setModal({}); }}>Cadastrar {resource.singular}</Button>} />
    {success && <Feedback tone="success">{success}</Feedback>}
    {organization.isPending && <Spinner />}
    {organization.isError && <QueryError error={organization.error} retry={() => void organization.refetch()} />}
    {data && <>
      <section className="panel stack" aria-labelledby="organization-tree-heading"><h2 id="organization-tree-heading">Empresas e unidades</h2>
        {data.companies.length ? <ul className="stack" style={{ paddingLeft: '1.25rem' }}>{data.companies.map(company => <li key={company.id}><strong>{company.name}</strong> {company.status === 'INACTIVE' && <Badge tone="neutral">Inativa</Badge>}
          {data.establishments.filter(item => item.companyId === company.id).map(establishment => <p className="muted" key={establishment.id}>Estabelecimento: {establishment.name}</p>)}
          <ul style={{ paddingLeft: '1.25rem' }}>{data.units.filter(item => item.companyId === company.id && (showInactive || item.status === 'ACTIVE')).map(unit => <li key={unit.id}><strong>{unit.name}</strong> {unit.status === 'INACTIVE' && <Badge tone="neutral">Inativa</Badge>}<ul style={{ paddingLeft: '1.25rem' }}>{data.sectors.filter(sector => sector.unitId === unit.id && (showInactive || sector.status === 'ACTIVE')).map(sector => <li key={sector.id}>{sector.name} {sector.status === 'INACTIVE' && <Badge tone="neutral">Inativo</Badge>}</li>)}</ul></li>)}</ul>
        </li>)}</ul> : <EmptyState title="Estrutura ainda não cadastrada" description="Comece pela empresa e depois cadastre suas unidades e setores." />}
      </section>
      <section className="panel stack" aria-labelledby="organization-registers-heading"><h2 id="organization-registers-heading">Cadastros organizacionais</h2><div className="tabs" aria-label="Tipo de cadastro">{resources.map(item => <Button key={item.key} variant={item.key === resource.key ? 'primary' : 'ghost'} aria-pressed={item.key === resource.key} onClick={() => { setResource(item); setSearch(''); setSuccess(''); }}>{item.label} <span className="muted">({data[item.key].length})</span></Button>)}</div>
        <div className="toolbar"><Field label={`Buscar em ${resource.label.toLocaleLowerCase('pt-BR')}`}><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Nome ou código" /></Field><label className="actions"><input type="checkbox" checked={showInactive} onChange={event => setShowInactive(event.target.checked)} /> Mostrar inativos</label></div>
        {items.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Nome / código</th><th>Vínculo</th><th>Situação</th>{can('organization.write') && <th>Ações</th>}</tr></thead><tbody>{items.map(item => <tr key={item.id}><td><strong>{item.name}</strong><span className="muted" style={{ display: 'block' }}>{item.code || 'Sem código'}</span></td><td>{parentName(item)}</td><td><Badge tone={item.status === 'ACTIVE' ? 'success' : 'neutral'}>{item.status === 'ACTIVE' ? 'Ativo' : 'Inativo'}</Badge></td>{can('organization.write') && <td><div className="actions"><Button variant="ghost" onClick={() => setModal({ item })} aria-label={`Editar ${item.name}`}>Editar</Button><Button variant={item.status === 'ACTIVE' ? 'danger' : 'secondary'} onClick={() => { setStatusError(undefined); setConfirm(item); }} aria-label={`${item.status === 'ACTIVE' ? 'Inativar' : 'Reativar'} ${item.name}`}>{item.status === 'ACTIVE' ? 'Inativar' : 'Reativar'}</Button></div></td>}</tr>)}</tbody></table></div> : <EmptyState title="Nenhum cadastro encontrado" description="Revise a busca, inclua registros inativos ou cadastre um novo item." />}
      </section>
      <Modal open={Boolean(modal) && can('organization.write')} title={`${modal?.item ? 'Editar' : 'Cadastrar'} ${resource.singular}`} onClose={closeForm}>{modal && <OrganizationForm key={`${resource.key}-${modal.item?.id || 'new'}-${modal.item?.revision || 0}`} resource={resource} organization={data} item={modal.item} selectedUnit={unitId} onBusyChange={setIsSavingForm} onDirtyChange={setIsFormDirty} onCancel={closeForm} onSaved={async () => { await queryClient.invalidateQueries({ queryKey: ['organization'] }); setModal(null); setSuccess('Cadastro organizacional salvo.'); }} />}</Modal>
      <Modal open={Boolean(confirm)} title={confirm?.status === 'ACTIVE' ? 'Inativar cadastro' : 'Reativar cadastro'} onClose={() => { if (!isUpdatingStatus) setConfirm(null); }}><div className="stack"><p>{confirm?.status === 'ACTIVE' ? 'Deseja inativar' : 'Deseja reativar'} <strong>{confirm?.name}</strong>?</p><p className="muted">O histórico será preservado. A operação depende das regras de integridade dos vínculos existentes.</p>{statusError !== undefined && <Feedback tone="danger">{errorMessage(statusError)}</Feedback>}<div className="actions"><Button variant={confirm?.status === 'ACTIVE' ? 'danger' : 'primary'} disabled={isUpdatingStatus} onClick={() => void toggleStatus()}>{isUpdatingStatus ? 'Salvando…' : 'Confirmar'}</Button><Button variant="secondary" disabled={isUpdatingStatus} onClick={() => setConfirm(null)}>Cancelar</Button></div></div></Modal>
    </>}
  </>;
}

function OrganizationForm({ resource, organization, item, selectedUnit, onCancel, onSaved, onBusyChange, onDirtyChange }: { resource: Resource; organization: OrganizationDto; item?: OrganizationItemDto; selectedUnit?: string; onCancel: () => void; onSaved: () => Promise<void>; onBusyChange: (busy: boolean) => void; onDirtyChange: (dirty: boolean) => void }) {
  const { sessionKey, unitId } = useSession();
  const [saveError, setSaveError] = useState<unknown>();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const initialUnit = organization.units.find(unit => unit.id === selectedUnit);
  const form = useForm<Values>({ resolver: zodResolver(formSchema), defaultValues: { name: item?.name || '', code: item?.code || '', taxId: item?.taxId || '', companyId: item?.companyId || initialUnit?.companyId || organization.companies[0]?.id || '', establishmentId: item?.establishmentId || '', unitId: item?.unitId || selectedUnit || '', sectorId: item?.sectorId || '', jobId: item?.jobId || '', address: item?.address || '', description: item?.description || '', occupationCode: item?.occupationCode || '', responsibleIds: item?.responsibleIds || [] } });
  useEffect(() => { onBusyChange(form.formState.isSubmitting); return () => onBusyChange(false); }, [form.formState.isSubmitting, onBusyChange]);
  useEffect(() => { onDirtyChange(form.formState.isDirty); return () => onDirtyChange(false); }, [form.formState.isDirty, onDirtyChange]);
  const values = form.watch();
  const needsCompany = ['establishments', 'units', 'jobs', 'jobFunctions'].includes(resource.key);
  const needsUnit = resource.key === 'sectors' || resource.key === 'workCenters';
  const assignees = useQuery({ queryKey: ['assignees', sessionKey, unitId, item?.id, 'UNIT_RESPONSIBLE'], queryFn: ({ signal }) => api.get<PageDto<AssigneeDto>>('/assignees', { signal, query: { unitId: item?.id, purpose: 'UNIT_RESPONSIBLE', pageSize: 100 } }), enabled: resource.key === 'units' && Boolean(item?.id) });
  async function submit(data: Values) {
    setSaveError(undefined);
    if (resource.key === 'companies' && data.taxId.replace(/\D/g, '').length !== 14) { form.setError('taxId', { message: 'Informe um CNPJ com 14 dígitos.' }, { shouldFocus: true }); return; }
    if (needsCompany && !organization.companies.some(company => company.id === data.companyId && company.status === 'ACTIVE')) { form.setError('companyId', { message: 'Selecione uma empresa ativa.' }, { shouldFocus: true }); return; }
    if (needsUnit && !organization.units.some(unit => unit.id === data.unitId && unit.status === 'ACTIVE')) { form.setError('unitId', { message: 'Selecione uma unidade ativa.' }, { shouldFocus: true }); return; }
    if (resource.key === 'units' && data.establishmentId && !organization.establishments.some(parent => parent.id === data.establishmentId && parent.companyId === data.companyId && parent.status === 'ACTIVE')) { form.setError('establishmentId', { message: 'O estabelecimento precisa pertencer à empresa.' }, { shouldFocus: true }); return; }
    if (resource.key === 'jobFunctions' && data.jobId && !organization.jobs.some(parent => parent.id === data.jobId && parent.companyId === data.companyId && parent.status === 'ACTIVE')) { form.setError('jobId', { message: 'O cargo precisa pertencer à empresa.' }, { shouldFocus: true }); return; }
    if (resource.key === 'workCenters' && data.sectorId && !organization.sectors.some(parent => parent.id === data.sectorId && parent.unitId === data.unitId && parent.status === 'ACTIVE')) { form.setError('sectorId', { message: 'O setor precisa pertencer à unidade.' }, { shouldFocus: true }); return; }
    const emptyOptional = item ? null : undefined;
    const payload: Record<string, unknown> = { name: data.name, code: data.code || emptyOptional };
    if (resource.key === 'companies') payload.taxId = data.taxId.replace(/\D/g, '');
    if (needsCompany) payload.companyId = data.companyId;
    if (needsUnit) payload.unitId = data.unitId;
    if (resource.key === 'units') { payload.establishmentId = data.establishmentId || emptyOptional; if (item) payload.responsibleIds = data.responsibleIds; }
    if (resource.key === 'establishments' || resource.key === 'units') payload.address = data.address || emptyOptional;
    if (resource.key === 'jobFunctions') { payload.jobId = data.jobId || emptyOptional; payload.description = data.description || emptyOptional; payload.occupationCode = data.occupationCode || emptyOptional; }
    if (resource.key === 'workCenters') payload.sectorId = data.sectorId || emptyOptional;
    try {
      if (item) await api.patch<OrganizationItemDto>(`/${resource.path}/${item.id}`, payload, { etag: revisionEtag(item.revision) });
      else await api.post<OrganizationItemDto>(`/${resource.path}`, payload, { idempotencyKey });
      await onSaved();
    } catch (error) { setSaveError(error); fieldErrorsOf(error).forEach((entry, index) => { if (entry.field in data) form.setError(entry.field as keyof Values, { message: entry.message }, { shouldFocus: index === 0 }); }); }
  }
  const options = (items: OrganizationItemDto[]) => items.filter(option => option.status === 'ACTIVE' || option.id === item?.companyId || option.id === item?.unitId || option.id === item?.establishmentId || option.id === item?.jobId || option.id === item?.sectorId).map(option => <option key={option.id} value={option.id}>{option.name}{option.status === 'INACTIVE' ? ' (inativo)' : ''}</option>);
  const error = (name: keyof Values) => form.formState.errors[name]?.message;
  return <form className="stack" aria-busy={form.formState.isSubmitting} onSubmit={form.handleSubmit(submit)} noValidate><fieldset className="stack" disabled={form.formState.isSubmitting} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
    {saveError !== undefined && <Feedback tone="danger">{errorMessage(saveError)}</Feedback>}
    <div className="form-grid">
      <Field label="Nome *" error={error('name')}><input autoFocus {...form.register('name')} /></Field><Field label="Código" error={error('code')}><input {...form.register('code')} /></Field>
      {resource.key === 'companies' && <Field label="CNPJ *" error={error('taxId')}><input {...form.register('taxId')} inputMode="numeric" placeholder="00.000.000/0000-00" /></Field>}
      {needsCompany && <Field label="Empresa *" error={error('companyId')}><select {...form.register('companyId')} onChange={event => { form.setValue('companyId', event.target.value, { shouldDirty: true, shouldValidate: true }); form.setValue('establishmentId', '', { shouldDirty: true, shouldValidate: true }); form.setValue('jobId', '', { shouldDirty: true, shouldValidate: true }); }}><option value="">Selecione</option>{options(organization.companies)}</select></Field>}
      {needsUnit && <Field label="Unidade *" error={error('unitId')}><select {...form.register('unitId')} onChange={event => { form.setValue('unitId', event.target.value, { shouldDirty: true, shouldValidate: true }); form.setValue('sectorId', '', { shouldDirty: true, shouldValidate: true }); }}><option value="">Selecione</option>{options(organization.units)}</select></Field>}
      {resource.key === 'units' && <Field label="Estabelecimento" error={error('establishmentId')}><select {...form.register('establishmentId')}><option value="">Não informado</option>{options(organization.establishments.filter(parent => parent.companyId === values.companyId))}</select></Field>}
      {(resource.key === 'establishments' || resource.key === 'units') && <Field label="Endereço" error={error('address')}><textarea rows={2} {...form.register('address')} /></Field>}
      {resource.key === 'jobFunctions' && <><Field label="Cargo" error={error('jobId')}><select {...form.register('jobId')}><option value="">Não informado</option>{options(organization.jobs.filter(parent => parent.companyId === values.companyId))}</select></Field><Field label="CBO (opcional)" error={error('occupationCode')}><input {...form.register('occupationCode')} /></Field><Field label="Descrição da função" error={error('description')}><textarea rows={3} {...form.register('description')} /></Field></>}
      {resource.key === 'workCenters' && <Field label="Setor" error={error('sectorId')}><select {...form.register('sectorId')}><option value="">Não informado</option>{options(organization.sectors.filter(parent => parent.unitId === values.unitId))}</select></Field>}
    </div>
    {resource.key === 'units' && (item ? <fieldset className="stack"><legend>Responsáveis da unidade</legend>{assignees.isPending && <Spinner />}{assignees.isError && <QueryError error={assignees.error} retry={() => void assignees.refetch()} />}{assignees.data?.items.map(assignee => <label key={assignee.id} className="actions"><input type="checkbox" value={assignee.id} {...form.register('responsibleIds')} /> {assignee.displayName}</label>)}{assignees.data?.items.length === 0 && <p className="muted">Nenhum responsável elegível nesta unidade.</p>}</fieldset> : <p className="muted">Após salvar a unidade, edite o cadastro para selecionar seus responsáveis elegíveis.</p>)}
    <div className="actions"><Button type="submit" disabled={form.formState.isSubmitting || (resource.key === 'units' && Boolean(item) && assignees.isError)}>{form.formState.isSubmitting ? 'Salvando…' : 'Salvar cadastro'}</Button><Button type="button" variant="secondary" disabled={form.formState.isSubmitting} onClick={onCancel}>Cancelar</Button></div>
  </fieldset></form>;
}

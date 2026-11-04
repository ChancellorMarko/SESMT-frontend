import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useController, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api, ApiError, revisionEtag } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { AssigneeDto, CompanyClassification, OrganizationReadDto as OrganizationDto, OrganizationReadItemDto as OrganizationItemDto } from '../../shared/contracts';
import { Badge, Button, EmptyState, Feedback, Field, Modal, PageHeader, Spinner } from '../../shared/ui';
import { usePagedLookup } from '../../shared/lib/use-paged-lookup';
import { PagedSelect } from '../../shared/ui/PagedSelect';
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
const formSchema = z.object({ name: z.string().trim().min(2, 'Informe um nome com pelo menos 2 caracteres.').max(200, 'Use no máximo 200 caracteres.'), code: z.string().trim().max(100, 'Use no máximo 100 caracteres.'), taxId: z.string(), classification: z.enum(['', 'INTERNAL', 'SERVICE_PROVIDER']), companyId: z.string(), establishmentId: z.string(), unitId: z.string(), sectorId: z.string(), jobId: z.string(), address: z.string().trim().max(1000, 'Use no máximo 1.000 caracteres.'), description: z.string().trim().max(2000, 'Use no máximo 2.000 caracteres.'), occupationCode: z.string().trim().max(100, 'Use no máximo 100 caracteres.'), responsibleIds: z.array(z.string()) });
type Values = z.infer<typeof formSchema>;
const classificationLabel = (classification?: CompanyClassification) => classification === 'INTERNAL' ? 'Interna' : classification === 'SERVICE_PROVIDER' ? 'Prestadora de serviços' : 'Não informada';
type ClassificationFilter = 'ALL' | 'UNSPECIFIED' | CompanyClassification;

export function OrganizationPage() {
  const { can, sessionKey, unitId } = useSession();
  return <OrganizationContextPage key={`${sessionKey}:${unitId || ''}:${can('organization.read')}:${can('organization.write')}`} />;
}

function OrganizationContextPage() {
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
  const [classificationFilter, setClassificationFilter] = useState<ClassificationFilter>('ALL');
  const statusRequest = useRef<AbortController | null>(null);
  useEffect(() => () => { statusRequest.current?.abort(); }, []);
  const queryClient = useQueryClient();
  const closeForm = useEditorProtection({ dirty: isFormDirty, busy: isSavingForm || isUpdatingStatus }, () => setModal(null));
  const organization = useQuery({ queryKey: ['organization', sessionKey, unitId, 'all'], queryFn: ({ signal }) => api.get<OrganizationDto>('/organization', { signal, query: { unitId: unitId || undefined, includeInactive: true } }), enabled: can('organization.read') });
  async function toggleStatus() {
    if (!confirm || isUpdatingStatus || statusRequest.current || !can('organization.write')) return;
    const latest = organization.data?.[resource.key].find(item => item.id === confirm.id);
    if (organization.isError || !latest || latest.revision !== confirm.revision || latest.status !== confirm.status) {
      setStatusError(new Error('O cadastro foi atualizado. Feche esta janela, confira a versão atual e tente novamente.')); return;
    }
    const controller = new AbortController(); statusRequest.current = controller;
    setIsUpdatingStatus(true); setStatusError(undefined);
    try {
      await api.patch<OrganizationItemDto>(`/${resource.path}/${confirm.id}`, { status: confirm.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }, { etag: revisionEtag(confirm.revision), signal: controller.signal });
      if (controller.signal.aborted) return;
      await queryClient.invalidateQueries({ queryKey: ['organization'] });
      if (controller.signal.aborted) return;
      setSuccess(confirm.status === 'ACTIVE' ? 'Cadastro inativado. Os vínculos e o histórico foram preservados.' : 'Cadastro reativado.');
      setConfirm(null);
    } catch (error) {
      if (!controller.signal.aborted) {
        setStatusError(error);
        if (error instanceof ApiError && error.status === 412) void queryClient.invalidateQueries({ queryKey: ['organization'] });
      }
    } finally { if (statusRequest.current === controller) statusRequest.current = null; if (!controller.signal.aborted) setIsUpdatingStatus(false); }
  }
  if (!can('organization.read')) return <EmptyState title="Acesso restrito" description="Seu perfil não pode consultar a estrutura organizacional." />;
  const data = organization.data;
  const currentStatusItem = confirm && data?.[resource.key].find(item => item.id === confirm.id);
  const staleStatusIntent = Boolean(confirm && (!currentStatusItem || currentStatusItem.revision !== confirm.revision || currentStatusItem.status !== confirm.status));
  const classificationMatches = (company: OrganizationItemDto) => resource.key !== 'companies' || classificationFilter === 'ALL' || (classificationFilter === 'UNSPECIFIED' ? !company.classification : company.classification === classificationFilter);
  const companies = data?.companies.filter(classificationMatches) ?? [];
  const items = data?.[resource.key].filter(item => (showInactive || item.status === 'ACTIVE') && (resource.key !== 'companies' || classificationMatches(item)) && `${item.name} ${item.code || ''}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR'))) || [];
  function parentName(item: OrganizationItemDto) { return data?.sectors.find(parent => parent.id === item.sectorId)?.name || data?.units.find(parent => parent.id === item.unitId)?.name || data?.jobs.find(parent => parent.id === item.jobId)?.name || data?.companies.find(parent => parent.id === item.companyId)?.name || 'Organização'; }
  return <>
    <PageHeader eyebrow="Base organizacional" title="Estrutura da organização" description="Organize unidades, setores e vínculos para manter cada registro no contexto correto." actions={can('organization.write') && <Button disabled={Boolean(modal) || Boolean(confirm)} onClick={() => { setSuccess(''); setModal({}); }}>Cadastrar {resource.singular}</Button>} />
    {success && <Feedback tone="success">{success}</Feedback>}
    {organization.isPending && <Spinner />}
    {organization.isError && <QueryError error={organization.error} retry={() => void organization.refetch()} />}
    {data && <>
      <section className="panel stack" aria-labelledby="organization-tree-heading"><h2 id="organization-tree-heading">Empresas e unidades</h2>
        {companies.length ? <ul className="stack" style={{ paddingLeft: '1.25rem' }}>{companies.map(company => <li key={company.id}><strong>{company.name}</strong> <Badge tone={company.classification === 'INTERNAL' ? 'info' : 'neutral'}>{classificationLabel(company.classification)}</Badge> {company.status === 'INACTIVE' && <Badge tone="neutral">Inativa</Badge>}
          {data.establishments.filter(item => item.companyId === company.id).map(establishment => <p className="muted" key={establishment.id}>Estabelecimento: {establishment.name}</p>)}
          <ul style={{ paddingLeft: '1.25rem' }}>{data.units.filter(item => item.companyId === company.id && (showInactive || item.status === 'ACTIVE')).map(unit => <li key={unit.id}><strong>{unit.name}</strong> {unit.status === 'INACTIVE' && <Badge tone="neutral">Inativa</Badge>}<ul style={{ paddingLeft: '1.25rem' }}>{data.sectors.filter(sector => sector.unitId === unit.id && (showInactive || sector.status === 'ACTIVE')).map(sector => <li key={sector.id}>{sector.name} {sector.status === 'INACTIVE' && <Badge tone="neutral">Inativo</Badge>}</li>)}</ul></li>)}</ul>
        </li>)}</ul> : <EmptyState title={data.companies.length ? 'Nenhuma empresa nesta classificação' : 'Estrutura ainda não cadastrada'} description={data.companies.length ? 'Escolha outra classificação para consultar as empresas e seus vínculos.' : 'Comece pela empresa e depois cadastre suas unidades e setores.'} />}
      </section>
      <section className="panel stack" aria-labelledby="organization-registers-heading"><h2 id="organization-registers-heading">Cadastros organizacionais</h2><div className="tabs" aria-label="Tipo de cadastro">{resources.map(item => <Button key={item.key} variant={item.key === resource.key ? 'primary' : 'ghost'} aria-pressed={item.key === resource.key} disabled={Boolean(modal) || Boolean(confirm)} onClick={() => { setResource(item); setSearch(''); setSuccess(''); }}>{item.label} <span className="muted">({data[item.key].length})</span></Button>)}</div>
        <div className="toolbar"><Field label={`Buscar em ${resource.label.toLocaleLowerCase('pt-BR')}`}><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Nome ou código" /></Field>{resource.key === 'companies' && <Field label="Filtrar empresas por classificação"><select value={classificationFilter} onChange={event => setClassificationFilter(event.target.value as ClassificationFilter)}><option value="ALL">Todas as classificações</option><option value="INTERNAL">Interna</option><option value="SERVICE_PROVIDER">Prestadora de serviços</option><option value="UNSPECIFIED">Não informada</option></select></Field>}<label className="actions"><input type="checkbox" checked={showInactive} onChange={event => setShowInactive(event.target.checked)} /> Mostrar inativos</label></div>
        {items.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Nome / código</th>{resource.key === 'companies' && <th>Classificação</th>}<th>Vínculo</th><th>Situação</th>{can('organization.write') && <th>Ações</th>}</tr></thead><tbody>{items.map(item => <tr key={item.id}><td><strong>{item.name}</strong><span className="muted" style={{ display: 'block' }}>{item.code || 'Sem código'}</span></td>{resource.key === 'companies' && <td><Badge tone={item.classification === 'INTERNAL' ? 'info' : 'neutral'}>{classificationLabel(item.classification)}</Badge></td>}<td>{parentName(item)}</td><td><Badge tone={item.status === 'ACTIVE' ? 'success' : 'neutral'}>{item.status === 'ACTIVE' ? 'Ativo' : 'Inativo'}</Badge></td>{can('organization.write') && <td><div className="actions"><Button variant="ghost" onClick={() => setModal({ item })} aria-label={`Editar ${item.name}`}>Editar</Button><Button variant={item.status === 'ACTIVE' ? 'danger' : 'secondary'} onClick={() => { setStatusError(undefined); setConfirm(item); }} aria-label={`${item.status === 'ACTIVE' ? 'Inativar' : 'Reativar'} ${item.name}`}>{item.status === 'ACTIVE' ? 'Inativar' : 'Reativar'}</Button></div></td>}</tr>)}</tbody></table></div> : <EmptyState title="Nenhum cadastro encontrado" description="Revise a busca, a classificação, inclua registros inativos ou cadastre um novo item." />}
      </section>
      <Modal open={Boolean(modal) && can('organization.write')} title={`${modal?.item ? 'Editar' : 'Cadastrar'} ${resource.singular}`} onClose={closeForm}>{modal && <OrganizationForm key={`${resource.key}-${modal.item?.id || 'new'}-${modal.item?.revision || 0}`} resource={resource} organization={data} unavailable={organization.isError} item={modal.item} selectedUnit={unitId} onBusyChange={setIsSavingForm} onDirtyChange={setIsFormDirty} onCancel={closeForm} onSaved={async signal => { await queryClient.invalidateQueries({ queryKey: ['organization'] }); if (!signal.aborted) { setModal(null); setSuccess('Cadastro organizacional salvo.'); } }} />}</Modal>
      <Modal open={Boolean(confirm)} title={confirm?.status === 'ACTIVE' ? 'Inativar cadastro' : 'Reativar cadastro'} onClose={() => { if (!isUpdatingStatus) setConfirm(null); }}><div className="stack"><p>{confirm?.status === 'ACTIVE' ? 'Deseja inativar' : 'Deseja reativar'} <strong>{confirm?.name}</strong>?</p><p className="muted">O histórico será preservado. A operação depende das regras de integridade dos vínculos existentes.</p>{staleStatusIntent && <Feedback tone="warning">O cadastro foi atualizado enquanto esta janela estava aberta. Feche a janela e confira a versão atual.</Feedback>}{statusError !== undefined && <Feedback tone="danger">{errorMessage(statusError)}</Feedback>}<div className="actions"><Button variant={confirm?.status === 'ACTIVE' ? 'danger' : 'primary'} disabled={isUpdatingStatus || staleStatusIntent || organization.isError} onClick={() => void toggleStatus()}>{isUpdatingStatus ? 'Salvando…' : 'Confirmar'}</Button><Button variant="secondary" disabled={isUpdatingStatus} onClick={() => setConfirm(null)}>Cancelar</Button></div></div></Modal>
    </>}
  </>;
}

function OrganizationForm({ resource, organization, unavailable, item, selectedUnit, onCancel, onSaved, onBusyChange, onDirtyChange }: { resource: Resource; organization: OrganizationDto; unavailable: boolean; item?: OrganizationItemDto; selectedUnit?: string; onCancel: () => void; onSaved: (signal: AbortSignal) => Promise<void>; onBusyChange: (busy: boolean) => void; onDirtyChange: (dirty: boolean) => void }) {
  const { can, sessionKey, unitId } = useSession();
  const queryClient = useQueryClient();
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { request.current?.abort(); }, []);
  const [saveError, setSaveError] = useState<unknown>();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const initialUnit = organization.units.find(unit => unit.id === selectedUnit);
  const form = useForm<Values>({ resolver: zodResolver(formSchema), defaultValues: { name: item?.name || '', code: item?.code || '', taxId: item?.taxId || '', classification: item?.classification || '', companyId: item?.companyId || initialUnit?.companyId || organization.companies[0]?.id || '', establishmentId: item?.establishmentId || '', unitId: item?.unitId || selectedUnit || '', sectorId: item?.sectorId || '', jobId: item?.jobId || '', address: item?.address || '', description: item?.description || '', occupationCode: item?.occupationCode || '', responsibleIds: item?.responsibleIds || [] } });
  useEffect(() => { onBusyChange(form.formState.isSubmitting); return () => onBusyChange(false); }, [form.formState.isSubmitting, onBusyChange]);
  useEffect(() => { onDirtyChange(form.formState.isDirty); return () => onDirtyChange(false); }, [form.formState.isDirty, onDirtyChange]);
  const values = form.watch();
  const responsible = useController({ control: form.control, name: 'responsibleIds' });
  const needsCompany = ['establishments', 'units', 'jobs', 'jobFunctions'].includes(resource.key);
  const needsUnit = resource.key === 'sectors' || resource.key === 'workCenters';
  const editsUnit = resource.key === 'units' && Boolean(item?.id);
  const assignees = usePagedLookup<AssigneeDto>({ queryKey: ['assignees', sessionKey, unitId, item?.id, 'UNIT_RESPONSIBLE'], path: '/assignees', query: { unitId: item?.id, purpose: 'UNIT_RESPONSIBLE' }, selectedIds: values.responsibleIds, enabled: editsUnit && !unavailable && can('organization.write') });
  async function submit(data: Values) {
    if (request.current || unavailable || !can('organization.write')) return;
    setSaveError(undefined);
    if (editsUnit && (assignees.isPending || assignees.isFetching || assignees.isError)) { setSaveError(new Error('Aguarde a consulta dos responsáveis elegíveis antes de salvar.')); return; }
    if (editsUnit && (!assignees.verified || data.responsibleIds.some(id => !assignees.selectedItems.some(assignee => assignee.id === id)))) { form.setError('responsibleIds', { message: 'Remova os responsáveis que deixaram de ser elegíveis nesta unidade.' }); return; }
    if (resource.key === 'companies' && (!/^[\d./\-\s]+$/.test(data.taxId) || data.taxId.replace(/\D/g, '').length !== 14)) { form.setError('taxId', { message: 'Informe um CNPJ com 14 dígitos.' }, { shouldFocus: true }); return; }
    if (resource.key === 'companies' && !data.classification) { form.setError('classification', { message: 'Selecione se a empresa é interna ou prestadora de serviços.' }, { shouldFocus: true }); return; }
    if (needsCompany && !organization.companies.some(company => company.id === data.companyId && company.status === 'ACTIVE')) { form.setError('companyId', { message: 'Selecione uma empresa ativa.' }, { shouldFocus: true }); return; }
    if (needsUnit && !organization.units.some(unit => unit.id === data.unitId && unit.status === 'ACTIVE')) { form.setError('unitId', { message: 'Selecione uma unidade ativa.' }, { shouldFocus: true }); return; }
    if (resource.key === 'units' && data.establishmentId && !organization.establishments.some(parent => parent.id === data.establishmentId && parent.companyId === data.companyId && parent.status === 'ACTIVE')) { form.setError('establishmentId', { message: 'O estabelecimento precisa pertencer à empresa.' }, { shouldFocus: true }); return; }
    if (resource.key === 'jobFunctions' && data.jobId && !organization.jobs.some(parent => parent.id === data.jobId && parent.companyId === data.companyId && parent.status === 'ACTIVE')) { form.setError('jobId', { message: 'O cargo precisa pertencer à empresa.' }, { shouldFocus: true }); return; }
    if (resource.key === 'workCenters' && data.sectorId && !organization.sectors.some(parent => parent.id === data.sectorId && parent.unitId === data.unitId && parent.status === 'ACTIVE')) { form.setError('sectorId', { message: 'O setor precisa pertencer à unidade.' }, { shouldFocus: true }); return; }
    const emptyOptional = item ? null : undefined;
    const payload: Record<string, unknown> = { name: data.name, code: data.code || emptyOptional };
    if (resource.key === 'companies') { payload.taxId = data.taxId.replace(/\D/g, ''); payload.classification = data.classification; }
    if (needsCompany) payload.companyId = data.companyId;
    if (needsUnit) payload.unitId = data.unitId;
    if (resource.key === 'units') { payload.establishmentId = data.establishmentId || emptyOptional; if (item) payload.responsibleIds = data.responsibleIds; }
    if (resource.key === 'establishments' || resource.key === 'units') payload.address = data.address || emptyOptional;
    if (resource.key === 'jobFunctions') { payload.jobId = data.jobId || emptyOptional; payload.description = data.description || emptyOptional; payload.occupationCode = data.occupationCode || emptyOptional; }
    if (resource.key === 'workCenters') payload.sectorId = data.sectorId || emptyOptional;
    const controller = new AbortController(); request.current = controller;
    try {
      if (item) await api.patch<OrganizationItemDto>(`/${resource.path}/${item.id}`, payload, { etag: revisionEtag(item.revision), signal: controller.signal });
      else await api.post<OrganizationItemDto>(`/${resource.path}`, payload, { idempotencyKey, signal: controller.signal });
      if (!controller.signal.aborted) await onSaved(controller.signal);
    } catch (error) {
      if (!controller.signal.aborted) {
        setSaveError(error); fieldErrorsOf(error).forEach((entry, index) => { if (entry.field in data) form.setError(entry.field as keyof Values, { message: entry.message }, { shouldFocus: index === 0 }); });
        if (error instanceof ApiError && error.status === 412) void queryClient.invalidateQueries({ queryKey: ['organization'] });
      }
    } finally { if (request.current === controller) request.current = null; }
  }
  const options = (items: OrganizationItemDto[]) => items.filter(option => option.status === 'ACTIVE' || option.id === item?.companyId || option.id === item?.unitId || option.id === item?.establishmentId || option.id === item?.jobId || option.id === item?.sectorId).map(option => <option key={option.id} value={option.id}>{option.name}{option.status === 'INACTIVE' ? ' (inativo)' : ''}</option>);
  const error = (name: keyof Values) => form.formState.errors[name]?.message;
  return <form className="stack" aria-busy={form.formState.isSubmitting} onSubmit={form.handleSubmit(submit)} noValidate><fieldset className="stack" disabled={form.formState.isSubmitting} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
    {saveError !== undefined && <Feedback tone="danger">{errorMessage(saveError)}</Feedback>}
    <div className="form-grid">
      <Field label="Nome *" error={error('name')}><input autoFocus {...form.register('name')} /></Field><Field label="Código" error={error('code')}><input {...form.register('code')} /></Field>
      {resource.key === 'companies' && <Field label="CNPJ *" error={error('taxId')}><input {...form.register('taxId')} inputMode="numeric" placeholder="00.000.000/0000-00" /></Field>}
      {resource.key === 'companies' && <Field label="Classificação da empresa *" error={error('classification')}><select {...form.register('classification')}><option value="">Selecione a classificação</option><option value="INTERNAL">Interna</option><option value="SERVICE_PROVIDER">Prestadora de serviços</option></select></Field>}
      {needsCompany && <Field label="Empresa *" error={error('companyId')}><select {...form.register('companyId')} onChange={event => { form.setValue('companyId', event.target.value, { shouldDirty: true, shouldValidate: true }); form.setValue('establishmentId', '', { shouldDirty: true, shouldValidate: true }); form.setValue('jobId', '', { shouldDirty: true, shouldValidate: true }); }}><option value="">Selecione</option>{options(organization.companies)}</select></Field>}
      {needsUnit && <Field label="Unidade *" error={error('unitId')}><select {...form.register('unitId')} onChange={event => { form.setValue('unitId', event.target.value, { shouldDirty: true, shouldValidate: true }); form.setValue('sectorId', '', { shouldDirty: true, shouldValidate: true }); }}><option value="">Selecione</option>{options(organization.units)}</select></Field>}
      {resource.key === 'units' && <Field label="Estabelecimento" error={error('establishmentId')}><select {...form.register('establishmentId')}><option value="">Não informado</option>{options(organization.establishments.filter(parent => parent.companyId === values.companyId))}</select></Field>}
      {(resource.key === 'establishments' || resource.key === 'units') && <Field label="Endereço" error={error('address')}><textarea rows={2} {...form.register('address')} /></Field>}
      {resource.key === 'jobFunctions' && <><Field label="Cargo" error={error('jobId')}><select {...form.register('jobId')}><option value="">Não informado</option>{options(organization.jobs.filter(parent => parent.companyId === values.companyId))}</select></Field><Field label="CBO (opcional)" error={error('occupationCode')}><input {...form.register('occupationCode')} /></Field><Field label="Descrição da função" error={error('description')}><textarea rows={3} {...form.register('description')} /></Field></>}
      {resource.key === 'workCenters' && <Field label="Setor" error={error('sectorId')}><select {...form.register('sectorId')}><option value="">Não informado</option>{options(organization.sectors.filter(parent => parent.unitId === values.unitId))}</select></Field>}
    </div>
    {resource.key === 'companies' && item && !item.classification && <Feedback tone="info">Este cadastro ainda não informa a classificação. Escolha uma opção para salvar a edição.</Feedback>}
    {resource.key === 'units' && (item ? <fieldset className="stack"><legend>Responsáveis da unidade</legend><PagedSelect lookup={assignees} label="Responsáveis elegíveis" noun="responsáveis da unidade" multiple value={responsible.field.value} onChange={value => { responsible.field.onChange(value); form.clearErrors('responsibleIds'); }} getLabel={assignee => assignee.displayName} error={error('responsibleIds')} disabled={unavailable || form.formState.isSubmitting} />{!assignees.isPending && !assignees.isError && !assignees.total && <p className="muted">Nenhum responsável elegível nesta unidade.</p>}</fieldset> : <p className="muted">Após salvar a unidade, edite o cadastro para selecionar seus responsáveis elegíveis.</p>)}
    <div className="actions"><Button type="submit" disabled={unavailable || form.formState.isSubmitting || editsUnit && !assignees.verified}>{form.formState.isSubmitting ? 'Salvando…' : 'Salvar cadastro'}</Button><Button type="button" variant="secondary" disabled={form.formState.isSubmitting} onClick={onCancel}>Cancelar</Button></div>
  </fieldset></form>;
}

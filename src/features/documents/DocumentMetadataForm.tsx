import { useEffect, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useController, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { api } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { AssigneeDto, DocumentWriteDto, DocumentTypeDto, OrganizationDto, WorkerDto } from '../../shared/contracts';
import { usePagedLookup } from '../../shared/lib/use-paged-lookup';
import { PagedSelect } from '../../shared/ui/PagedSelect';
import { Button, Feedback, Field, Spinner } from '../../shared/ui';
import { UnsavedChanges } from '../workers/UnsavedChanges';
import { accessLabels, errorMessage, metadataSchema, toDocumentWrite, type DocumentFields } from './validation';

interface Props {
  initial?: DocumentWriteDto;
  pending: boolean;
  submitLabel: string;
  onSave: (values: DocumentWriteDto) => Promise<void>;
  children?: ReactNode;
  onTypeChange?: (type?: DocumentTypeDto) => void;
  additionalDirty?: boolean;
  navigationState?: { state: unknown };
}

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const emptyValues = (unitId?: string): DocumentFields => ({ code: '', title: '', typeId: '', companyId: '', unitId: unitId ?? '', sectorId: '', ownerId: '', responsibleIds: [], workerIds: [], accessClass: 'INTERNAL', issueDate: today(), validFrom: '', validUntil: '', keywords: '' });
const fromDto = (dto: DocumentWriteDto): DocumentFields => ({ ...dto, sectorId: dto.sectorId ?? '', responsibleIds: dto.responsibleIds ?? [], workerIds: dto.workerIds ?? [], validFrom: dto.validFrom ?? '', validUntil: dto.validUntil ?? '', keywords: dto.keywords?.join(', ') ?? '' });

export function DocumentMetadataForm({ initial, pending, submitLabel, onSave, children, onTypeChange, additionalDirty = false, navigationState }: Props) {
  const { unitId: sessionUnitId, sessionKey, can } = useSession();
  const client = useQueryClient();
  const [submissionError, setSubmissionError] = useState('');
  const organization = useQuery({ queryKey: ['organization', sessionKey], queryFn: ({ signal }) => api.get<OrganizationDto>('/organization', { signal }) });
  const [requiredFields, setRequiredFields] = useState<string[]>([]);
  const { register, control, handleSubmit, watch, setValue, setError, formState: { errors, isDirty, isSubmitting } } = useForm<DocumentFields>({ resolver: zodResolver(metadataSchema(requiredFields)), defaultValues: initial ? fromDto(initial) : emptyValues(sessionUnitId) });
  const typeField = useController({ control, name: 'typeId' });
  const ownerField = useController({ control, name: 'ownerId' });
  const responsibleField = useController({ control, name: 'responsibleIds' });
  const workerField = useController({ control, name: 'workerIds' });
  const busy = pending || isSubmitting;
  const companyId = watch('companyId');
  const selectedUnitId = watch('unitId');
  const sectorId = watch('sectorId');
  const typeId = typeField.field.value;
  const accessClass = watch('accessClass');
  const canReadWorkers = can('workers.read');
  const organizationData = organization.isError ? undefined : organization.data;
  const relationAccess = Boolean(organizationData && selectedUnitId) && (accessClass !== 'MEDICAL' || can('documents.medical.write'));
  const types = usePagedLookup<DocumentTypeDto>({ queryKey: ['document-types', sessionKey, sessionUnitId, 'document-form'], path: '/document-types', query: { activeOnly: true }, selectedIds: typeId ? [typeId] : [], enabled: Boolean(organizationData) });
  const typeAllowed = (type: DocumentTypeDto) => type.allowedAccessClasses.some(classification => classification !== 'MEDICAL' || can('documents.medical.write'));
  const selectableTypes = { ...types, items: types.items.filter(typeAllowed), selectedItems: types.selectedItems.filter(typeAllowed) };
  const selectedType = [...selectableTypes.selectedItems, ...selectableTypes.items].find(type => type.id === typeId);
  const owners = usePagedLookup<AssigneeDto>({ queryKey: ['assignees', sessionKey, sessionUnitId, 'document-form'], path: '/assignees', query: { unitId: selectedUnitId, purpose: 'DOCUMENT_OWNER', accessClass }, selectedIds: ownerField.field.value ? [ownerField.field.value] : [], enabled: relationAccess });
  const responsible = usePagedLookup<AssigneeDto>({ queryKey: ['assignees', sessionKey, sessionUnitId, 'document-form'], path: '/assignees', query: { unitId: selectedUnitId, purpose: 'DOCUMENT_RESPONSIBLE', accessClass }, selectedIds: responsibleField.field.value, enabled: relationAccess });
  const workers = usePagedLookup<WorkerDto>({ queryKey: ['workers', 'document-form', sessionKey, sessionUnitId], path: '/workers', query: { unitId: selectedUnitId }, selectedIds: canReadWorkers ? workerField.field.value : [], enabled: Boolean(organizationData && selectedUnitId) && canReadWorkers });
  const lookups = [types, owners, responsible, ...(canReadWorkers ? [workers] : [])];
  const optionsVerified = Boolean(organizationData) && !organization.isFetching && lookups.every(lookup => lookup.verified && !lookup.isFetching);
  const optionsError = organization.isError || lookups.some(lookup => lookup.isError);

  useEffect(() => {
    if (!initial && organizationData && !companyId) {
      const defaultUnit = organizationData.units.find((unit) => unit.id === sessionUnitId && unit.status === 'ACTIVE') ?? organizationData.units.find(unit => unit.status === 'ACTIVE');
      setValue('companyId', defaultUnit?.companyId ?? organizationData.companies[0]?.id ?? '');
      setValue('unitId', defaultUnit?.id ?? '');
    }
  }, [organizationData, initial, sessionUnitId, companyId, setValue]);
  useEffect(() => { setRequiredFields(selectedType?.requiredFields ?? []); onTypeChange?.(selectedType); }, [selectedType, onTypeChange]);

  async function save(values: DocumentFields) {
    if (pending) return;
    setSubmissionError('');
    if (!optionsVerified || optionsError || !organizationData) { setSubmissionError('Atualize as opções e aguarde a verificação dos vínculos antes de salvar.'); return; }
    if (!selectedType) { setError('typeId', { message: 'Selecione um tipo documental disponível.' }); return; }
    if (!selectedType.allowedAccessClasses.includes(values.accessClass) || (values.accessClass === 'MEDICAL' && !can('documents.medical.write'))) { setError('accessClass', { message: 'Classificação indisponível para seu acesso.' }); return; }
    let invalid = false;
    const invalidField = (field: keyof DocumentFields, message: string) => { invalid = true; setError(field, { type: 'validate', message }); };
    if (!organizationData.companies.some(company => company.id === values.companyId)) invalidField('companyId', 'Selecione uma empresa disponível.');
    if (!organizationData.units.some(unit => unit.id === values.unitId && unit.companyId === values.companyId && unit.status === 'ACTIVE')) invalidField('unitId', 'Selecione uma unidade ativa da empresa.');
    if (values.sectorId && !organizationData.sectors.some(sector => sector.id === values.sectorId && sector.unitId === values.unitId && sector.status === 'ACTIVE')) invalidField('sectorId', 'Selecione um setor ativo da unidade ou remova o vínculo.');
    if (![...owners.selectedItems, ...owners.items].some(person => person.id === values.ownerId)) invalidField('ownerId', 'Selecione um proprietário disponível para esta unidade e classificação.');
    if (values.responsibleIds.some(id => ![...responsible.selectedItems, ...responsible.items].some(person => person.id === id))) invalidField('responsibleIds', 'Revise os responsáveis indisponíveis antes de salvar.');
    if (canReadWorkers && values.workerIds.some(id => ![...workers.selectedItems, ...workers.items].some(worker => worker.id === id && worker.unitId === values.unitId && worker.companyId === values.companyId))) invalidField('workerIds', 'Revise os trabalhadores indisponíveis ou de outra unidade.');
    if (!canReadWorkers && initial?.workerIds?.length && (values.companyId !== initial.companyId || values.unitId !== initial.unitId)) invalidField('unitId', 'A mudança de unidade exige a revisão dos vínculos por um perfil com acesso aos trabalhadores.');
    if (invalid) return;
    try { await onSave(toDocumentWrite(values)); }
    catch (error) {
      setSubmissionError(errorMessage(error));
      const fieldErrors = (error as { fieldErrors?: { field: string; message: string }[] }).fieldErrors;
      fieldErrors?.forEach(({ field, message }) => { if (field in values) setError(field as keyof DocumentFields, { type: 'server', message }); });
    }
  }

  const classifications = (selectedType?.allowedAccessClasses ?? ['INTERNAL', 'RESTRICTED']).filter((classification) => classification !== 'MEDICAL' || can('documents.medical.write'));
  const changed = { shouldDirty: true, shouldValidate: false };
  const clearUnitRelations = () => { setValue('sectorId', '', changed); if (canReadWorkers) setValue('workerIds', [], changed); setValue('ownerId', '', changed); setValue('responsibleIds', [], changed); };
  function refreshOptions() {
    if (organization.isError) {
      void Promise.allSettled([
        client.invalidateQueries({ queryKey: ['document-types', sessionKey, sessionUnitId, 'document-form'] }),
        client.invalidateQueries({ queryKey: ['assignees', sessionKey, sessionUnitId, 'document-form'] }),
        client.invalidateQueries({ queryKey: ['workers', 'document-form', sessionKey, sessionUnitId] }),
        organization.refetch(),
      ]);
    } else void Promise.allSettled([organization.refetch(), ...lookups.map(lookup => lookup.refetch())]);
  }

  return <form className="panel stack" onSubmit={handleSubmit(save)} noValidate>
    <UnsavedChanges protectContext dirty={isDirty || additionalDirty} busy={busy} navigationState={navigationState} />
    {organization.isPending && <Spinner />}
    {optionsError && <Feedback tone="danger">Não foi possível verificar as opções. Os vínculos e o preenchimento foram mantidos; atualize antes de salvar.</Feedback>}
    <div className="actions"><Button variant="secondary" disabled={busy} onClick={refreshOptions}>Atualizar opções do formulário</Button>{!optionsVerified && !optionsError && <small className="muted">Aguarde a verificação das opções e dos vínculos selecionados.</small>}</div>
    {submissionError && <Feedback tone="danger">{submissionError}</Feedback>}
    {Object.keys(errors).length > 0 && <Feedback tone="danger">Confira os campos destacados antes de continuar.</Feedback>}
    <fieldset className="form-grid" disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <Field label="Código *" error={errors.code?.message}><input {...register('code')} autoComplete="off" /></Field>
      <Field label="Título *" error={errors.title?.message}><input {...register('title')} /></Field>
      <PagedSelect lookup={selectableTypes} label="Tipo documental *" noun="tipos documentais" value={typeId} error={errors.typeId?.message} disabled={busy} emptyLabel="Selecione um tipo" getLabel={type => type.name} onChange={value => { const nextId = String(value); typeField.field.onChange(nextId); const type = [...selectableTypes.selectedItems, ...selectableTypes.items].find(item => item.id === nextId); if (type) { const nextAccess = type.allowedAccessClasses.includes(type.defaultAccessClass) && (type.defaultAccessClass !== 'MEDICAL' || can('documents.medical.write')) ? type.defaultAccessClass : type.allowedAccessClasses.find(classification => classification !== 'MEDICAL' || can('documents.medical.write')); if (nextAccess) { setValue('accessClass', nextAccess, changed); if (nextAccess !== accessClass) { setValue('ownerId', '', changed); setValue('responsibleIds', [], changed); } } } }} />
      <Field label="Classificação de acesso *" error={errors.accessClass?.message}><select {...register('accessClass')} value={accessClass} onChange={(event) => { setValue('accessClass', event.target.value as DocumentFields['accessClass'], changed); setValue('ownerId', '', changed); setValue('responsibleIds', [], changed); }}>{classifications.map((classification) => <option key={classification} value={classification}>{accessLabels[classification]}</option>)}</select></Field>
      <Field label="Empresa *" error={errors.companyId?.message}><select {...register('companyId')} value={companyId} onChange={(event) => { setValue('companyId', event.target.value, changed); setValue('unitId', '', changed); clearUnitRelations(); }}><option value="">Selecione a empresa</option>{organizationData?.companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></Field>
      <Field label="Unidade *" error={errors.unitId?.message}><select {...register('unitId')} value={selectedUnitId} onChange={(event) => { setValue('unitId', event.target.value, changed); clearUnitRelations(); }}><option value="">Selecione a unidade</option>{organizationData?.units.filter((unit) => unit.companyId === companyId && unit.status === 'ACTIVE').map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></Field>
      <Field label="Setor" required={requiredFields.includes('sectorId')} error={errors.sectorId?.message}><select {...register('sectorId')} value={sectorId}><option value="">Sem setor específico</option>{organizationData?.sectors.filter((sector) => sector.unitId === selectedUnitId && sector.status === 'ACTIVE').map((sector) => <option key={sector.id} value={sector.id}>{sector.name}</option>)}</select></Field>
      <PagedSelect lookup={owners} label="Proprietário *" noun="proprietários" value={ownerField.field.value} onChange={ownerField.field.onChange} getLabel={person => person.displayName} error={errors.ownerId?.message} disabled={busy || !relationAccess} emptyLabel="Selecione o proprietário" />
      <Field label="Data de emissão *" error={errors.issueDate?.message}><input type="date" {...register('issueDate')} /></Field>
      <Field label="Início da validade" required={requiredFields.includes('validFrom')} error={errors.validFrom?.message}><input type="date" {...register('validFrom')} /></Field>
      <Field label="Fim da validade" required={requiredFields.includes('validUntil')} error={errors.validUntil?.message}><input type="date" {...register('validUntil')} /></Field>
      <Field label="Palavras-chave (separadas por vírgula)" required={requiredFields.includes('keywords')} error={errors.keywords?.message}><input {...register('keywords')} placeholder="auditoria, unidade, renovação" /></Field>
      <PagedSelect lookup={responsible} label="Responsáveis" required={requiredFields.includes('responsibleIds')} noun="responsáveis" multiple value={responsibleField.field.value} onChange={responsibleField.field.onChange} getLabel={person => person.displayName} error={errors.responsibleIds?.message} disabled={busy || !relationAccess} />
      {canReadWorkers && <PagedSelect lookup={workers} label="Trabalhadores vinculados" required={requiredFields.includes('workerIds')} noun="trabalhadores" multiple value={workerField.field.value} onChange={workerField.field.onChange} getLabel={worker => `${worker.fullName} · ${worker.registration}`} error={errors.workerIds?.message} disabled={busy || !selectedUnitId} />}
    </fieldset>
    <fieldset className="stack" disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>{children}</fieldset>
    <div className="actions"><Button type="submit" disabled={busy || !optionsVerified || optionsError}>{busy ? 'Enviando…' : submitLabel}</Button><small className="muted">* Campo obrigatório. A gravação depende da validação das suas permissões.</small></div>
  </form>;
}

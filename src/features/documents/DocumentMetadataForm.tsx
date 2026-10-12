import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { api } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { AssigneeDto, DocumentWriteDto, DocumentTypeDto, OrganizationDto, PageDto, WorkerDto } from '../../shared/contracts';
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
}

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const emptyValues = (unitId?: string): DocumentFields => ({ code: '', title: '', typeId: '', companyId: '', unitId: unitId ?? '', sectorId: '', ownerId: '', responsibleIds: [], workerIds: [], accessClass: 'INTERNAL', issueDate: today(), validFrom: '', validUntil: '', keywords: '' });
const fromDto = (dto: DocumentWriteDto): DocumentFields => ({ ...dto, sectorId: dto.sectorId ?? '', responsibleIds: dto.responsibleIds ?? [], workerIds: dto.workerIds ?? [], validFrom: dto.validFrom ?? '', validUntil: dto.validUntil ?? '', keywords: dto.keywords?.join(', ') ?? '' });

export function DocumentMetadataForm({ initial, pending, submitLabel, onSave, children, onTypeChange, additionalDirty = false }: Props) {
  const { unitId: sessionUnitId, sessionKey, can } = useSession();
  const [submissionError, setSubmissionError] = useState('');
  const types = useQuery({ queryKey: ['document-types', sessionKey], queryFn: ({ signal }) => api.get<PageDto<DocumentTypeDto>>('/document-types', { signal, query: { pageSize: 100, activeOnly: true } }) });
  const organization = useQuery({ queryKey: ['organization', sessionKey], queryFn: ({ signal }) => api.get<OrganizationDto>('/organization', { signal }) });
  const [requiredFields, setRequiredFields] = useState<string[]>([]);
  const { register, handleSubmit, watch, setValue, setError, formState: { errors, isDirty, isSubmitting } } = useForm<DocumentFields>({ resolver: zodResolver(metadataSchema(requiredFields)), defaultValues: initial ? fromDto(initial) : emptyValues(sessionUnitId) });
  const busy = pending || isSubmitting;
  const companyId = watch('companyId');
  const selectedUnitId = watch('unitId');
  const typeId = watch('typeId');
  const accessClass = watch('accessClass');
  const selectedType = types.data?.items.find((type) => type.id === typeId);
  const owners = useQuery({ queryKey: ['assignees', sessionKey, selectedUnitId, accessClass, 'DOCUMENT_OWNER'], queryFn: ({ signal }) => api.get<PageDto<AssigneeDto>>('/assignees', { signal, query: { unitId: selectedUnitId, purpose: 'DOCUMENT_OWNER', accessClass, pageSize: 100 } }), enabled: Boolean(selectedUnitId) && (accessClass !== 'MEDICAL' || can('documents.medical.write')) });
  const responsible = useQuery({ queryKey: ['assignees', sessionKey, selectedUnitId, accessClass, 'DOCUMENT_RESPONSIBLE'], queryFn: ({ signal }) => api.get<PageDto<AssigneeDto>>('/assignees', { signal, query: { unitId: selectedUnitId, purpose: 'DOCUMENT_RESPONSIBLE', accessClass, pageSize: 100 } }), enabled: Boolean(selectedUnitId) && (accessClass !== 'MEDICAL' || can('documents.medical.write')) });
  const workers = useQuery({ queryKey: ['workers', 'document-form', sessionKey, selectedUnitId], queryFn: ({ signal }) => api.get<PageDto<WorkerDto>>('/workers', { signal, query: { unitId: selectedUnitId, pageSize: 100 } }), enabled: Boolean(selectedUnitId) && can('workers.read') });

  useEffect(() => {
    if (!initial && organization.data && !companyId) {
      const defaultUnit = organization.data.units.find((unit) => unit.id === sessionUnitId) ?? organization.data.units[0];
      setValue('companyId', defaultUnit?.companyId ?? organization.data.companies[0]?.id ?? '');
      setValue('unitId', defaultUnit?.id ?? '');
    }
  }, [organization.data, initial, sessionUnitId, companyId, setValue]);
  useEffect(() => { setRequiredFields(selectedType?.requiredFields ?? []); onTypeChange?.(selectedType); }, [selectedType, onTypeChange]);

  async function save(values: DocumentFields) {
    if (pending) return;
    setSubmissionError('');
    if (!selectedType) { setError('typeId', { message: 'Selecione um tipo documental disponível.' }); return; }
    if (!selectedType.allowedAccessClasses.includes(values.accessClass) || (values.accessClass === 'MEDICAL' && !can('documents.medical.write'))) { setError('accessClass', { message: 'Classificação indisponível para seu acesso.' }); return; }
    try { await onSave(toDocumentWrite(values)); }
    catch (error) {
      setSubmissionError(errorMessage(error));
      const fieldErrors = (error as { fieldErrors?: { field: string; message: string }[] }).fieldErrors;
      fieldErrors?.forEach(({ field, message }) => { if (field in values) setError(field as keyof DocumentFields, { type: 'server', message }); });
    }
  }

  if (types.isPending || organization.isPending) return <Spinner />;
  if ((types.isError && !types.data) || (organization.isError && !organization.data)) return <div className="panel stack"><Feedback tone="danger">Não foi possível carregar os dados do formulário.</Feedback><Button variant="secondary" onClick={() => { types.refetch(); organization.refetch(); }}>Tentar novamente</Button></div>;
  const classifications = (selectedType?.allowedAccessClasses ?? ['INTERNAL', 'RESTRICTED']).filter((classification) => classification !== 'MEDICAL' || can('documents.medical.write'));
  const changed = { shouldDirty: true, shouldValidate: false };
  const clearUnitRelations = () => { setValue('sectorId', '', changed); setValue('workerIds', [], changed); setValue('ownerId', '', changed); setValue('responsibleIds', [], changed); };

  return <form className="panel stack" onSubmit={handleSubmit(save)} noValidate>
    <UnsavedChanges protectContext dirty={isDirty || additionalDirty} busy={busy} />
    {(types.isError || organization.isError) && <Feedback tone="warning">Não foi possível atualizar as opções. Seu preenchimento foi mantido. <Button variant="ghost" disabled={busy} onClick={() => { void types.refetch(); void organization.refetch(); }}>Tentar novamente</Button></Feedback>}
    {submissionError && <Feedback tone="danger">{submissionError}</Feedback>}
    {Object.keys(errors).length > 0 && <Feedback tone="danger">Confira os campos destacados antes de continuar.</Feedback>}
    <fieldset className="form-grid" disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <Field label="Código *" error={errors.code?.message}><input {...register('code')} autoComplete="off" /></Field>
      <Field label="Título *" error={errors.title?.message}><input {...register('title')} /></Field>
      <Field label="Tipo documental *" error={errors.typeId?.message}><select {...register('typeId')} onChange={(event) => { setValue('typeId', event.target.value, changed); const type = types.data?.items.find((item) => item.id === event.target.value); if (type) { const nextAccess = type.allowedAccessClasses.includes(type.defaultAccessClass) && (type.defaultAccessClass !== 'MEDICAL' || can('documents.medical.write')) ? type.defaultAccessClass : type.allowedAccessClasses.find(value => value !== 'MEDICAL' || can('documents.medical.write')); if (nextAccess) { setValue('accessClass', nextAccess, changed); if (nextAccess !== accessClass) { setValue('ownerId', '', changed); setValue('responsibleIds', [], changed); } } } }}><option value="">Selecione um tipo</option>{types.data?.items.filter((type) => type.allowedAccessClasses.some((classification) => classification !== 'MEDICAL' || can('documents.medical.write'))).map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></Field>
      <Field label="Classificação de acesso *" error={errors.accessClass?.message}><select {...register('accessClass')} onChange={(event) => { setValue('accessClass', event.target.value as DocumentFields['accessClass'], changed); setValue('ownerId', '', changed); setValue('responsibleIds', [], changed); }}>{classifications.map((classification) => <option key={classification} value={classification}>{accessLabels[classification]}</option>)}</select></Field>
      <Field label="Empresa *" error={errors.companyId?.message}><select {...register('companyId')} onChange={(event) => { setValue('companyId', event.target.value, changed); setValue('unitId', '', changed); clearUnitRelations(); }}><option value="">Selecione a empresa</option>{organization.data?.companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></Field>
      <Field label="Unidade *" error={errors.unitId?.message}><select {...register('unitId')} onChange={(event) => { setValue('unitId', event.target.value, changed); clearUnitRelations(); }}><option value="">Selecione a unidade</option>{organization.data?.units.filter((unit) => unit.companyId === companyId && unit.status === 'ACTIVE').map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></Field>
      <Field label="Setor" error={errors.sectorId?.message}><select {...register('sectorId')}><option value="">Sem setor específico</option>{organization.data?.sectors.filter((sector) => sector.unitId === selectedUnitId && sector.status === 'ACTIVE').map((sector) => <option key={sector.id} value={sector.id}>{sector.name}</option>)}</select></Field>
      <Field label="Proprietário *" error={errors.ownerId?.message}><select {...register('ownerId')} disabled={owners.isPending}><option value="">Selecione o proprietário</option>{owners.data?.items.map((person) => <option key={person.id} value={person.id}>{person.displayName}</option>)}</select></Field>
      <Field label="Data de emissão *" error={errors.issueDate?.message}><input type="date" {...register('issueDate')} /></Field>
      <Field label="Início da validade" error={errors.validFrom?.message}><input type="date" {...register('validFrom')} /></Field>
      <Field label="Fim da validade" error={errors.validUntil?.message}><input type="date" {...register('validUntil')} /></Field>
      <Field label="Palavras-chave (separadas por vírgula)" error={errors.keywords?.message}><input {...register('keywords')} placeholder="auditoria, unidade, renovação" /></Field>
      <Field label="Responsáveis" error={errors.responsibleIds?.message}><select multiple size={4} {...register('responsibleIds')}>{responsible.data?.items.map((person) => <option key={person.id} value={person.id}>{person.displayName}</option>)}</select><small className="muted">Selecione um ou mais responsáveis da unidade.</small></Field>
      {can('workers.read') && <Field label="Trabalhadores vinculados" error={errors.workerIds?.message}><select multiple size={4} {...register('workerIds')}>{workers.data?.items.map((worker) => <option key={worker.id} value={worker.id}>{worker.fullName} · {worker.registration}</option>)}</select></Field>}
    </fieldset>
    {(owners.isError || responsible.isError || workers.isError) && <Feedback tone="warning">Alguns vínculos não foram carregados. Tente novamente antes de alterar esses campos.</Feedback>}
    <fieldset className="stack" disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>{children}</fieldset>
    <div className="actions"><Button type="submit" disabled={busy || owners.isError || responsible.isError}>{busy ? 'Enviando…' : submitLabel}</Button><small className="muted">* Campo obrigatório. A gravação depende da validação das suas permissões.</small></div>
  </form>;
}

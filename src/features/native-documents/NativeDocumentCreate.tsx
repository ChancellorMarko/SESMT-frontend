import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api, nativeDocumentsApi } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import { InvalidReadResponse, useVerifiedRead } from '../../shared/lib/verified-read';
import { Button, Feedback, Field, PageHeader, Spinner } from '../../shared/ui';
import { isCivilDate } from '../documents/validation';
import { NativeCommandDialog, NativeContextConflict, NativeFormError } from '../native-operations/NativeCommandDialog';
import { checkedNativePeople, checkedNativePerson } from '../native-operations/directory';
import { nativeId } from '../native-operations/contracts';
import { workerDocumentNavigation } from '../workers/worker-document-navigation';
import { checkedDocument, checkedDocumentDirectory, checkedDocumentType, checkedDocumentTypes } from './contracts';
import { useDocumentReturn } from './useDocumentReturn';
import { invalidateDocumentReads } from './queries';
import styles from './NativeDocuments.module.css';

export function NativeDocumentCreate() {
  const { sessionKey, unitId } = useSession();
  return <Create key={`${sessionKey}:${unitId}`}/>;
}
function Create() {
  const { me, sessionKey, unitId: headerUnit, can } = useSession(), navigate = useNavigate(), client = useQueryClient(), location = useLocation();
  const back = useDocumentReturn();
  const origin = workerDocumentNavigation(location.state, sessionKey, headerUnit, can('workers.read'), can('eligibility.read'));
  const originId = nativeId.safeParse(origin?.workerDocumentReturnTo.workerId).success ? origin!.workerDocumentReturnTo.workerId : undefined;
  const [unitId, setUnit] = useState(headerUnit ?? ''), [sectorId, setSector] = useState(''), [typeId, setType] = useState('');
  const [code, setCode] = useState(''), [title, setTitle] = useState(''), [description, setDescription] = useState('');
  const [issueDate, setIssue] = useState(''), [validFrom, setFrom] = useState(''), [validUntil, setUntil] = useState(''), [secrecy, setSecrecy] = useState('Interno');
  const [worker, chooseWorker] = useState<{ id: string; fullName: string }>(), [q, setQ] = useState(''), [applied, apply] = useState<string>(), [peoplePage, setPeoplePage] = useState(1);
  const savedId = useRef('');
  const allowed = Boolean(me && can('documento:criar') && can('documento:ler')), catalogsAllowed = allowed && can('organization.read');
  const organization = useVerifiedRead({ queryKey: ['native-document-directory', sessionKey], enabled: catalogsAllowed,
    request: signal => api.get<unknown>('/organization', { signal }), validate: checkedDocumentDirectory });
  const unit = organization.data?.units.find(u => u.id === unitId && u.status === 'ACTIVE');
  const company = organization.data?.companies.find(c => c.id === unit?.companyId && c.status === 'ACTIVE');
  const originPerson = useVerifiedRead({ queryKey: ['native-document-origin-worker', sessionKey, originId, unitId, company?.id], enabled: Boolean(originId && unit && company && catalogsAllowed),
    request: signal => api.get<unknown>(`/workers/${originId}`, { signal }), validate: value => {
      const person = checkedNativePerson(value, { id: originId!, companyId: company!.id }), sector = (value as { sectorId?: unknown }).sectorId;
      if (person.unitId !== unitId || person.status !== 'ACTIVE' || sector !== null && !nativeId.safeParse(sector).success) throw new InvalidReadResponse();
      return { ...person, sectorId: sector as string | null };
    } });
  const originSeeded = useRef(false);
  useEffect(() => { if (originPerson.data && !originSeeded.current) { originSeeded.current = true; setSector(originPerson.data.sectorId ?? ''); } }, [originPerson.data]);
  const linkedWorker = originId ? originPerson.data : worker;
  const types = useVerifiedRead({ queryKey: ['native-document-types', sessionKey], enabled: allowed,
    request: signal => nativeDocumentsApi.get<unknown>('/document-types', { query: { onlyActive: true }, signal }), validate: checkedDocumentTypes });
  const type = useVerifiedRead({ queryKey: ['native-document-type', sessionKey, typeId], scope: ['native-document-type', sessionKey], enabled: allowed && Boolean(types.data?.some(t => t.id === typeId)),
    request: signal => nativeDocumentsApi.get<unknown>(`/document-types/${typeId}`, { signal }), validate: value => checkedDocumentType(value, typeId) });
  const people = useVerifiedRead({ queryKey: ['native-document-people', sessionKey, unitId, sectorId, applied, peoplePage], scope: ['native-document-people', sessionKey, unitId, sectorId],
    enabled: Boolean(unit && company && can('workers.read') && applied !== undefined),
    request: signal => api.get<unknown>('/workers', { query: { unitId, sectorId: sectorId || undefined, q: applied || undefined, status: 'ACTIVE', page: peoplePage, pageSize: 20 }, signal }),
    validate: value => checkedNativePeople(value, { unitId, companyId: company!.id, page: peoplePage }) });
  const general = type.data && ['Publico', 'Interno'].includes(type.data.secrecyLevel);
  const schemaRequired = type.data && JSON.parse(type.data.metadataSchema).required;
  const supportedSchema = schemaRequired === undefined || Array.isArray(schemaRequired) && schemaRequired.length === 0;
  const broadUnit = Boolean(company && (me?.scope.companyIds.includes(company.id) || me?.scope.unitIds.includes(unitId)));
  const ready = allowed && catalogsAllowed && unit && company && general && supportedSchema && !type.isFetching && !organization.isFetching && !types.isFetching
    && (!originId || originPerson.data && !originPerson.isFetching && !originPerson.isError);
  function changeUnit(value: string) { setUnit(value); setSector(''); chooseWorker(undefined); apply(undefined); setPeoplePage(1); }
  async function perform(signal: AbortSignal) {
    if (!ready || !me || !unit || !company || !type.data) throw new NativeFormError('Confira unidade e tipo documental antes de continuar.');
    if (!code.trim() || !title.trim() || !isCivilDate(issueDate) || validFrom && !isCivilDate(validFrom) || validUntil && !isCivilDate(validUntil)
      || validFrom && validUntil && validUntil < validFrom || !broadUnit && !sectorId) throw new NativeFormError('Preencha código, título, emissão e abrangência. Confira o intervalo de validade.');
    if (type.data.secrecyLevel === 'Interno' && secrecy === 'Publico') throw new NativeFormError('Este tipo documental exige classificação interna.');
    const freshType = checkedDocumentType(await nativeDocumentsApi.get<unknown>(`/document-types/${typeId}`, { signal }), typeId);
    const freshDirectory = checkedDocumentDirectory(await api.get<unknown>('/organization', { signal }));
    if (JSON.stringify(freshType) !== JSON.stringify(type.data) || !freshDirectory.units.some(u => u.id === unitId && u.companyId === company.id && u.status === 'ACTIVE')
      || sectorId && !freshDirectory.sectors.some(s => s.id === sectorId && s.unitId === unitId && s.status === 'ACTIVE')) throw new NativeContextConflict('O tipo ou a organização foi alterado. Atualize os dados antes de continuar.');
    if (linkedWorker) {
      const raw = await api.get<unknown>(`/workers/${linkedWorker.id}`, { signal }), person = checkedNativePerson(raw, { id: linkedWorker.id, companyId: company.id });
      if (person.unitId !== unitId || person.status !== 'ACTIVE' || sectorId && (raw as { sectorId?: string }).sectorId !== sectorId) throw new NativeContextConflict('O vínculo do trabalhador foi alterado. Atualize o cadastro antes de continuar.');
    }
    const payload = { documentTypeId: typeId, companyId: company.id, unitId, departmentId: sectorId || null, ownerId: me.user.id,
      code: code.trim(), title: title.trim(), description: description.trim() || null, secrecyLevel: secrecy,
      issueDate, validFromDate: validFrom || null, validUntilDate: validUntil || null, keywords: [], metadata: '{}', personId: linkedWorker?.id ?? null, links: [] };
    const created = checkedDocument(await nativeDocumentsApi.post<unknown>('/documents', payload, { signal }), undefined, me.scope, unitId);
    if (created.code !== payload.code || created.title !== payload.title || created.documentTypeId !== typeId || created.companyId !== company.id
      || created.departmentId !== payload.departmentId || created.ownerId !== me.user.id || created.secrecyLevel !== secrecy
      || created.issueDate !== issueDate || created.validFromDate !== payload.validFromDate || created.validUntilDate !== payload.validUntilDate
      || created.currentVersionNumber !== 0 || created.status !== 'RASCUNHO') throw new InvalidReadResponse();
    const stored = checkedDocument(await nativeDocumentsApi.get<unknown>(`/documents/${created.id}`, { signal }), created.id, me.scope, unitId);
    if (JSON.stringify(stored) !== JSON.stringify(created)) throw new InvalidReadResponse();
    if (linkedWorker) {
      const projection = await api.get<unknown>(`/documents/${created.id}`, { signal });
      if (!projection || typeof projection !== 'object' || (projection as { id?: string }).id !== created.id
        || !Array.isArray((projection as { workerIds?: unknown }).workerIds) || !(projection as { workerIds: unknown[] }).workerIds.includes(linkedWorker.id)) throw new InvalidReadResponse();
    }
    savedId.current = created.id;
  }
  return <div className="stack"><PageHeader title="Novo documento"/>{!allowed ? <Feedback tone="warning">Seu acesso não permite cadastrar documentos.</Feedback> : <NativeCommandDialog title="Cadastrar documento" dirty={Boolean(code || title || description || issueDate || worker)} disabled={!ready}
    submitLabel="Cadastrar documento" onClose={() => void navigate(back.to, { replace: true, state: back.state })} perform={perform}
    onDone={async () => { await invalidateDocumentReads(client, sessionKey); void navigate(`/app/documentos/${savedId.current}`, { replace: true, state: location.state }); }}>{busy => <>
      {!catalogsAllowed && <Feedback tone="warning">Sua conta precisa de acesso à organização para selecionar o contexto do documento.</Feedback>}
      {(organization.isPending || types.isPending || type.isPending) && <Spinner/>}{(organization.isError || types.isError || type.isError) && <Feedback tone="danger">Não foi possível conferir os catálogos. Atualize a página antes de continuar.</Feedback>}
      {originPerson.isError && <Feedback tone="danger">Não foi possível conferir o trabalhador de origem. Retorne ao cadastro antes de continuar.</Feedback>}
      <div className={styles.grid}><Field label="Unidade" required><select value={unitId} disabled={busy || !organization.data || Boolean(originId)} onChange={e => changeUnit(e.target.value)}><option value="">Selecione</option>{organization.data?.units.filter(u => u.status === 'ACTIVE').map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
      <Field label="Setor" required={!broadUnit}><select value={sectorId} disabled={busy || !unit} onChange={e => { setSector(e.target.value); chooseWorker(undefined); apply(undefined); }}><option value="">{broadUnit ? 'Abrangência da unidade' : 'Selecione o setor'}</option>{organization.data?.sectors.filter(s => s.unitId === unitId && s.status === 'ACTIVE').map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field></div>
      {company && <p>{company.name}</p>}
      <Field label="Tipo documental" required><select value={typeId} disabled={busy || !types.data} onChange={e => { setType(e.target.value); setSecrecy('Interno'); }}><option value="">Selecione</option>{types.data?.map(t => <option key={t.id} value={t.id}>{t.name} · {t.code}</option>)}</select></Field>
      {type.data && !general && <Feedback tone="warning">Este tipo exige um cadastro protegido específico para documentos restritos ou médicos.</Feedback>}
      {!supportedSchema && <Feedback tone="warning">Este tipo exige informações específicas que precisam ser preenchidas no seu fluxo próprio.</Feedback>}
      <div className={styles.grid}><Field label="Código" required><input maxLength={80} value={code} disabled={busy} onChange={e => setCode(e.target.value)}/></Field><Field label="Classificação"><select value={secrecy} disabled={busy || type.data?.secrecyLevel === 'Interno'} onChange={e => setSecrecy(e.target.value)}><option value="Interno">Interno</option><option value="Publico">Público</option></select></Field></div>
      <Field label="Título" required><input maxLength={255} value={title} disabled={busy} onChange={e => setTitle(e.target.value)}/></Field><Field label="Descrição"><textarea maxLength={2000} value={description} disabled={busy} onChange={e => setDescription(e.target.value)}/></Field>
      <div className={styles.grid}><Field label="Emissão" required><input type="date" value={issueDate} disabled={busy} onChange={e => setIssue(e.target.value)}/></Field><Field label="Válido a partir de"><input type="date" value={validFrom} disabled={busy} onChange={e => setFrom(e.target.value)}/></Field><Field label="Válido até"><input type="date" value={validUntil} disabled={busy} onChange={e => setUntil(e.target.value)}/></Field></div>
      {originId && originPerson.data && <p>Trabalhador vinculado: <strong>{originPerson.data.fullName}</strong></p>}
      {can('workers.read') && !originId && <><Field label="Buscar trabalhador para vincular"><input value={q} maxLength={200} disabled={busy || !unit} onChange={e => setQ(e.target.value)}/></Field><Button variant="secondary" disabled={busy || !unit || people.isFetching} onClick={() => { apply(q.trim()); setPeoplePage(1); }}>Buscar trabalhadores</Button>
      {people.isPending && <Spinner/>}{people.isError && <Feedback tone="danger">Não foi possível conferir os trabalhadores.</Feedback>}
      <Field label="Trabalhador vinculado"><select value={worker?.id ?? ''} disabled={busy || people.isFetching} onChange={e => { const person = people.data?.items.find(p => p.id === e.target.value); chooseWorker(person && { id: person.id, fullName: person.fullName }); }}><option value="">Sem vínculo individual</option>{worker && !people.data?.items.some(p => p.id === worker.id) && <option value={worker.id}>{worker.fullName}</option>}{people.data?.items.map(p => <option key={p.id} value={p.id}>{p.fullName} · {p.registration}</option>)}</select></Field>
      {people.data && <div className="actions"><Button variant="secondary" disabled={busy || people.isFetching || peoplePage <= 1} onClick={() => setPeoplePage(p => p - 1)}>Anterior</Button><span>Página {peoplePage}</span><Button variant="secondary" disabled={busy || people.isFetching || peoplePage * 20 >= people.data.total} onClick={() => setPeoplePage(p => p + 1)}>Próxima</Button></div>}</>}
    </>}</NativeCommandDialog>}</div>;
}

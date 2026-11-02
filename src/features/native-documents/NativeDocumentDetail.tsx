import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, downloadNativeDocument, nativeDocumentsApi } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import { denyVerifiedRead, InvalidReadResponse, useVerifiedRead } from '../../shared/lib/verified-read';
import { formatDate } from '../../shared/lib/format';
import { Badge, Button, Feedback, InfoButton, PageHeader, Spinner } from '../../shared/ui';
import { nativeId } from '../native-operations/contracts';
import { NativeContextConflict } from '../native-operations/NativeCommandDialog';
import { useEditorRequest } from '../administration/useEditorRequest';
import { checkedDocument, checkedDocumentType, checkedFilePolicy, checkedVersions, statusLabels, type NativeDocument, type NativeDocumentVersion } from './contracts';
import { useDocumentReturn } from './useDocumentReturn';
import { NativeDocumentReview, NativeDocumentUpload } from './NativeDocumentCommands';
import { NativeDocumentPermitLink } from './NativeDocumentPermitLink';
import { documentHash, fileDownloadName } from './files';
import { invalidateDocumentReads } from './queries';
import { editableDocument, NativeDocumentMetadata } from './NativeDocumentMetadata';
import styles from '../../shared/ui/NativeRecords.module.css';

type Command = { kind: 'upload' | 'link' | 'metadata'; item: NativeDocument } | { kind: 'aceita' | 'reprovada'; item: NativeDocument; version: NativeDocumentVersion };
export function NativeDocumentDetail({ initialUpload = false, initialEdit = false }: { initialUpload?: boolean; initialEdit?: boolean }) {
  const { sessionKey, unitId } = useSession(), { id = '' } = useParams();
  return <Detail key={`${sessionKey}:${unitId}:${id}:${initialUpload}:${initialEdit}`} id={id} initialUpload={initialUpload} initialEdit={initialEdit}/>;
}
function Detail({ id, initialUpload, initialEdit }: { id: string; initialUpload: boolean; initialEdit: boolean }) {
  const { me, sessionKey, unitId, can } = useSession(), location = useLocation(), navigate = useNavigate(), client = useQueryClient();
  const [command, setCommand] = useState<Command>(), [notice, setNotice] = useState(''), [downloadId, setDownload] = useState(''), [downloadError, setDownloadError] = useState('');
  const openedUpload = useRef(false), download = useEditorRequest(), scope = me?.scope ?? { companyIds: [], unitIds: [], sectorIds: [] };
  const validId = nativeId.safeParse(id).success, allowed = can('documento:ler') && Boolean(me), back = useDocumentReturn();
  const readScope = ['native-document', sessionKey, unitId, id];
  const query = useVerifiedRead({ queryKey: readScope, enabled: allowed && validId,
    request: signal => nativeDocumentsApi.get<unknown>(`/documents/${id}`, { signal }), validate: value => checkedDocument(value, id, scope) });
  const item = query.data, active = Boolean(item && !query.isFetching);
  const versions = useVerifiedRead({ queryKey: ['native-document-versions', sessionKey, id, item?.revision], scope: ['native-document-versions', sessionKey, id], enabled: active,
    request: signal => nativeDocumentsApi.get<unknown>(`/documents/${id}/versions`, { signal }), validate: value => checkedVersions(value, item!) });
  const policy = useVerifiedRead({ queryKey: ['native-document-file-policy', sessionKey], enabled: active,
    request: signal => nativeDocumentsApi.get<unknown>('/documents/file-policy', { signal }), validate: checkedFilePolicy });
  const type = useVerifiedRead({ queryKey: ['native-document-type', sessionKey, item?.documentTypeId], scope: ['native-document-detail-type', sessionKey, id], enabled: active,
    request: signal => nativeDocumentsApi.get<unknown>(`/document-types/${item!.documentTypeId}`, { signal }), validate: value => checkedDocumentType(value, item!.documentTypeId) });
  const mayUpload = Boolean(item && item.status !== 'ARQUIVADO' && can('documento:editar') && (item.secrecyLevel !== 'Medico' || can('aso:editar')));
  const mayReview = Boolean(item && can('documento:aprovar') && (item.secrecyLevel !== 'Medico' || can('aso:editar')));
  const mayEdit = Boolean(item && editableDocument(item) && can('documento:editar') && (item.secrecyLevel !== 'Medico' || can('aso:editar')));
  const busy = query.isFetching || versions.isFetching || policy.isFetching;
  useEffect(() => { if (initialUpload && !openedUpload.current && item && mayUpload && policy.data && !busy) { openedUpload.current = true; setCommand({ kind: 'upload', item }); } }, [initialUpload, item, mayUpload, policy.data, busy]);
  useEffect(() => { if (initialEdit && !openedUpload.current && item && mayEdit && !busy) { openedUpload.current = true; setCommand({ kind: 'metadata', item }); } }, [initialEdit, item, mayEdit, busy]);
  function close() { setCommand(undefined); if (initialUpload || initialEdit) void navigate(`/app/documentos/${id}`, { replace: true, state: location.state }); }
  async function done(message: string) {
    close(); setNotice(message);
    await invalidateDocumentReads(client, sessionKey);
  }
  async function saveFile(version: NativeDocumentVersion) {
    if (!item || !policy.data || busy || download.isPending()) return;
    setDownload(version.id); setDownloadError('');
    try {
      const file = await download.run(async signal => {
        const fresh = checkedDocument(await nativeDocumentsApi.get<unknown>(`/documents/${id}`, { signal }), id, scope);
        if (fresh.revision !== item.revision || fresh.companyId !== item.companyId) throw new NativeContextConflict('O documento mudou. Atualize a consulta antes de baixar o arquivo.');
        const result = await downloadNativeDocument(id, version.id, policy.data!.maxSizeBytes, { signal });
        if (!policy.data!.allowedMimeTypes.includes(result.mimeType as 'application/pdf') || await documentHash(result.blob, signal) !== version.fileHash) throw new InvalidReadResponse();
        return result;
      });
      if (!download.isActive()) return;
      const url = URL.createObjectURL(file.blob), anchor = document.createElement('a');
      anchor.href = url; anchor.download = fileDownloadName(item.code, version.versionNumber, file.mimeType);
      try { document.body.append(anchor); anchor.click(); }
      finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    } catch (failure) {
      if (!download.isActive()) return;
      if (failure instanceof ApiError && [401, 403, 404].includes(failure.status)) denyVerifiedRead(client, readScope, failure);
      setDownloadError(failure instanceof NativeContextConflict ? failure.message : 'Não foi possível conferir e baixar o arquivo. Atualize a consulta antes de tentar novamente.');
    } finally { if (download.isActive()) setDownload(''); }
  }
  return <div className="stack"><PageHeader title={item?.title ?? 'Documento'} actions={<div className="actions"><Link className="button button--secondary" to={back.to} state={back.state}>{back.label}</Link><Button variant="secondary" disabled={busy} onClick={() => { setNotice(''); void query.refetch(); }}>Atualizar</Button></div>}/>
    {(!validId || !allowed) && <Feedback tone="warning">Documento ou acesso indisponível.</Feedback>}{query.isPending && <Spinner/>}{query.isError && <Feedback tone="danger">Não foi possível conferir este documento com seu acesso.</Feedback>}
    {notice && <Feedback tone="success">{notice}</Feedback>}{downloadError && <Feedback tone="danger">{downloadError}</Feedback>}
    {item && <><section className="panel stack" aria-label="Dados do documento"><div className="actions"><strong>{item.code}</strong><Badge>{statusLabels[item.status]}</Badge><span>{type.data?.name ?? 'Tipo documental'}</span></div>
      {item.description && <p className={styles.message}>{item.description}</p>}<dl className={styles.details}><dt>Emissão</dt><dd>{formatDate(item.issueDate)}</dd><dt>Validade</dt><dd>{item.validFromDate ? formatDate(item.validFromDate) : 'Não informada'} a {item.validUntilDate ? formatDate(item.validUntilDate) : 'sem vencimento informado'}</dd><dt>Classificação</dt><dd>{({ Publico: 'Público', Interno: 'Interno', Restrito: 'Restrito', Medico: 'Médico' })[item.secrecyLevel]}</dd><dt>Última versão</dt><dd>{item.currentVersionNumber || 'Sem arquivo'}</dd></dl>
      <InfoButton title="Identificação do documento"><dl className={styles.details}><dt>Documento</dt><dd>{item.id}</dd><dt>Empresa</dt><dd>{item.companyId}</dd><dt>Unidade</dt><dd>{item.unitId ?? 'Abrangência da empresa'}</dd><dt>Setor</dt><dd>{item.departmentId ?? 'Não informado'}</dd><dt>Responsável pelo cadastro</dt><dd>{item.ownerId}</dd><dt>Revisão do registro</dt><dd>{item.revision}</dd></dl></InfoButton>
      {(mayUpload || mayEdit) && <div className="actions">{mayEdit && <Button variant="secondary" disabled={busy} onClick={() => setCommand({ kind: 'metadata', item })}>Editar dados</Button>}{mayUpload && <Button disabled={busy || !policy.data || policy.isError} onClick={() => setCommand({ kind: 'upload', item })}>Anexar versão</Button>}</div>}</section>
      {initialEdit && !mayEdit && <Feedback tone="warning">A edição exige acesso aos dados e um documento em rascunho ou conferência.</Feedback>}
      {can('pt:editar') && item.status !== 'ARQUIVADO' && <div className="actions"><Button variant="secondary" disabled={busy} onClick={() => setCommand({ kind: 'link', item })}>Vincular a uma PT</Button></div>}
      {(versions.isPending || policy.isPending) && <Spinner/>}{(versions.isError || policy.isError) && <Feedback tone="danger">Não foi possível conferir as versões ou a política de arquivos. Atualize o documento.</Feedback>}
      {versions.data && <section className={styles.results} aria-label="Versões do documento"><div className={styles.scroll} role="region" aria-label="Tabela de versões" tabIndex={0}><table className={`data-table ${styles.table}`}><thead><tr><th scope="col">Versão</th><th scope="col">Situação</th><th scope="col">Observação</th><th scope="col">Ações</th></tr></thead><tbody>{versions.data.map(v => <tr key={v.id}><td><strong>Versão {v.versionNumber}</strong><small>{formatDate(v.createdAt)}</small></td><td><Badge>{statusLabels[v.state] ?? v.state}</Badge>{v.isCurrent && <small>Arquivo vigente</small>}</td><td>{v.justification ?? 'Não informada'}</td><td><div className="actions"><Button variant="secondary" disabled={busy || !policy.data || Boolean(downloadId)} onClick={() => void saveFile(v)}>{downloadId === v.id ? 'Conferindo…' : 'Baixar arquivo'}</Button>
      {mayReview && v.state === 'EM_REVISAO' && v.versionNumber === item.currentVersionNumber && <><Button disabled={busy || !type.data || type.isError || type.data.requiresSignature} onClick={() => setCommand({ kind: 'aceita', item, version: v })}>Aceitar</Button><Button variant="secondary" disabled={busy} onClick={() => setCommand({ kind: 'reprovada', item, version: v })}>Reprovar</Button></>}</div></td></tr>)}</tbody></table></div>
      {!versions.data.length && <p className="panel">Nenhum arquivo anexado.</p>}</section>}
      {type.data?.requiresSignature && <Feedback>O tipo documental exige assinatura. O aceite depende de um fluxo que confira essa exigência.</Feedback>}
      {command?.kind === 'upload' && policy.data && <NativeDocumentUpload item={command.item} policy={policy.data} onClose={close} onDone={() => done('Arquivo recebido para conferência.')}/>}
      {command?.kind === 'metadata' && <NativeDocumentMetadata item={command.item} onClose={close} onDone={() => done('Dados do documento atualizados.')}/>}
      {command?.kind === 'link' && <NativeDocumentPermitLink item={command.item} onClose={close} onDone={() => done('Vínculo registrado. Confira as pendências e as ciências na PT.')}/>}
      {command && (command.kind === 'aceita' || command.kind === 'reprovada') && <NativeDocumentReview item={command.item} version={command.version} decision={command.kind} onClose={close} onDone={() => done(command.kind === 'aceita' ? 'Evidência aceita pela API.' : 'Evidência reprovada pela API.')}/>}
    </>}
  </div>;
}

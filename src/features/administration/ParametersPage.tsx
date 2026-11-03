import { useState } from 'react';
import { Link } from 'react-router';
import { useSession } from '../../shared/auth/SessionProvider';
import type { DocumentTypeReadDto as DocumentTypeDto } from '../../shared/contracts';
import { usePagedLookup } from '../../shared/lib/use-paged-lookup';
import { Badge, Button, EmptyState, Feedback, Field, PageHeader, Spinner } from '../../shared/ui';
import styles from './administration.module.css';
import { NATIVE_MODULES } from '../../shared/api/native-mode';

export function ParametersPage() {
  const { sessionKey, unitId, can } = useSession();
  return <ParametersPageContent key={JSON.stringify([sessionKey, unitId, can('documentTypes.write'), can('documents.read')])} />;
}

function ParametersPageContent() {
  const { sessionKey, unitId, can } = useSession();
  const allowed = can('documentTypes.write') || can('documents.read');
  const types = usePagedLookup<DocumentTypeDto>({ queryKey: ['document-types', sessionKey, unitId, 'policies'], path: '/document-types', enabled: allowed, pageSize: 20 });
  const [search, setSearch] = useState('');
  const blocked = types.isFetching || types.isError;
  const lastPage = Math.max(1, Math.ceil(types.total / types.pageSize));
  if (!allowed) return <Feedback tone="warning">Seu acesso não permite consultar políticas documentais.</Feedback>;
  return <div className="stack"><PageHeader eyebrow="CONFIGURAÇÕES" title="Parâmetros documentais" description="Consulta das políticas retornadas pelos tipos documentais. Não existe gravação de parâmetros globais nesta etapa." actions={<Badge tone="neutral">Consulta das políticas</Badge>} />
    <Feedback tone="info">Alertas, renovação e limites de arquivo pertencem ao contrato de tipos documentais. Retenção, fonte e versão devem ser validadas pelos responsáveis técnicos.</Feedback>
    <form className="panel toolbar" aria-label="Buscar políticas documentais" onSubmit={event => { event.preventDefault(); if (!blocked) types.setTerm(search.slice(0, 200)); }}>
      <Field label="Buscar política por nome ou código"><input type="search" maxLength={200} value={search} disabled={blocked} onChange={event => setSearch(event.target.value)} placeholder="Ex.: procedimento, PGR" /></Field>
      <Button type="submit" disabled={blocked}>Buscar políticas</Button>
      {types.term && <Button variant="secondary" disabled={blocked} onClick={() => { setSearch(''); types.setTerm(''); }}>Limpar busca</Button>}
    </form>
    {types.isPending && <Spinner />}{types.isError && <Feedback tone="danger">Não foi possível consultar as políticas documentais. {types.error instanceof Error ? types.error.message : 'Confira seu acesso e tente novamente.'} <Button variant="ghost" disabled={types.isFetching} onClick={() => void types.refetch()}>Tentar novamente</Button></Feedback>}
    {!types.isPending && !types.isError && <>{types.items.map((type) => <article className={`panel ${styles.policyCard}`} aria-label={`Política de ${type.name}`} key={type.id}>
      <h2>{type.name} <span className="muted">· {type.code}</span></h2>
      {type.sourceReadOnly ? <dl className={styles.detail}>
        <dt>Categoria</dt><dd>{type.category}</dd>
        <dt>Periodicidade cadastrada</dt><dd>{type.periodicityInDays == null ? 'Não informada' : `${type.periodicityInDays} dias`}</dd>
        <dt>Prazo de guarda cadastrado</dt><dd>{type.retentionPeriodInYears == null ? 'Não informado' : `${type.retentionPeriodInYears} anos`}</dd>
        <dt>Aprovação</dt><dd>{type.requiresApproval ? 'Exigida' : 'Não exigida'}</dd>
        <dt>Assinatura</dt><dd>{type.requiresSignature ? 'Exigida' : 'Não exigida'}</dd>
        <dt>Versão do esquema</dt><dd>{type.schemaVersion}</dd>
      </dl> : <dl className={styles.detail}>
        <dt>Renovação</dt><dd>{type.renewalPolicy.enabled ? `${type.renewalPolicy.periodMonths ?? 'Não informada'} meses` : 'Sem periodicidade automática'}</dd>
        <dt>Aviso antecipado</dt><dd>{type.renewalPolicy.noticeDays} dias — parâmetro do tipo</dd>
        <dt>Limite por arquivo</dt><dd>{(type.maxFileSizeBytes / 1024 / 1024).toLocaleString('pt-BR')} MB</dd>
        <dt>Formatos permitidos</dt><dd>{type.allowedMimeTypes.join(', ')}</dd>
        <dt>Política de guarda</dt><dd>{type.retentionPolicyReference.code} · versão {type.retentionPolicyReference.version}</dd>
        <dt>Fonte</dt><dd>{type.retentionPolicyReference.source}</dd>
        <dt>Fluxo</dt><dd>{type.workflow.reviewRequired ? 'Revisão exigida' : 'Revisão facultativa'}; {type.workflow.signatureRequired ? 'assinatura exigida' : 'assinatura facultativa'}; {type.workflow.allowSelfApproval ? 'autoaprovação permitida pela política' : 'sem autoaprovação'}</dd>
        <dt>Versões vigentes</dt><dd>{type.workflow.allowMultipleActiveVersions ? 'Exceção de múltiplas vigentes configurada' : 'Uma vigente por escopo'}</dd>
      </dl>}
    </article>)}
      {!types.items.length && <EmptyState title="Nenhuma política disponível" description={types.term ? 'Ajuste a busca por nome ou código para consultar outras políticas.' : 'As políticas aparecerão após a configuração dos tipos documentais.'} />}
      <nav className="panel pagination" aria-label="Paginação das políticas"><span className="muted" role="status">{types.total} política(s) · Página {types.page} de {lastPage}</span><div className="actions">
        {types.page > 1 && !types.items.length && <Button variant="secondary" disabled={blocked} onClick={() => types.setPage(1)}>Primeira página</Button>}
        <Button variant="secondary" disabled={blocked || types.page <= 1} onClick={() => types.setPage(types.page - 1)}>Anterior</Button><Button variant="secondary" disabled={blocked || types.page >= lastPage} onClick={() => types.setPage(types.page + 1)}>Próxima</Button>
      </div></nav>
    </>}
    {(NATIVE_MODULES ? can('parametro:ler') || can('parametro:editar') : can('documentTypes.write')) && <Link to="/app/configuracoes/tipos-documentais">{NATIVE_MODULES?'Abrir tipos documentais →':'Gerenciar políticas nos tipos documentais →'}</Link>}
  </div>;
}

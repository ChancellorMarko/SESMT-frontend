import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../../shared/api';
import { useSession } from '../../shared/auth/SessionProvider';
import type { DocumentTypeDto, PageDto } from '../../shared/contracts';
import { Badge, Button, EmptyState, Feedback, PageHeader, Spinner } from '../../shared/ui';
import styles from './administration.module.css';

export function ParametersPage() {
  const { sessionKey, unitId, can } = useSession();
  const allowed = can('documentTypes.write') || can('documents.read');
  const types = useQuery({ queryKey: ['document-types', sessionKey, unitId, 'policies'], queryFn: ({ signal }) => api.get<PageDto<DocumentTypeDto>>('/document-types', { query: { page: 1, pageSize: 100 }, signal }), enabled: allowed });
  if (!allowed) return <Feedback tone="warning">Seu acesso não permite consultar políticas documentais.</Feedback>;
  return <div className="stack"><PageHeader eyebrow="CONFIGURAÇÕES" title="Parâmetros documentais" description="Consulta das políticas retornadas pelos tipos documentais. Não existe gravação de parâmetros globais nesta etapa." actions={<Badge tone="neutral">Consulta das políticas</Badge>} />
    <Feedback tone="info">Alertas, renovação e limites de arquivo pertencem ao contrato de tipos documentais. Retenção, fonte e versão devem ser validadas pelos responsáveis técnicos.</Feedback>
    {types.isPending && <Spinner />}{types.isError && <Feedback tone="danger">{types.error.message} <Button variant="ghost" onClick={() => types.refetch()}>Tentar novamente</Button></Feedback>}
    {types.data && !types.isError && <>{types.data.items.map((type) => <article className={`panel ${styles.policyCard}`} key={type.id}><h2>{type.name} <span className="muted">· {type.code}</span></h2><dl className={styles.detail}><dt>Renovação</dt><dd>{type.renewalPolicy.enabled ? `${type.renewalPolicy.periodMonths ?? 'Não informada'} meses` : 'Sem periodicidade automática'}</dd><dt>Aviso antecipado</dt><dd>{type.renewalPolicy.noticeDays} dias — parâmetro do tipo</dd><dt>Limite por arquivo</dt><dd>{(type.maxFileSizeBytes / 1024 / 1024).toLocaleString('pt-BR')} MB</dd><dt>Formatos permitidos</dt><dd>{type.allowedMimeTypes.join(', ')}</dd><dt>Política de guarda</dt><dd>{type.retentionPolicyReference.code} · versão {type.retentionPolicyReference.version}</dd><dt>Fonte</dt><dd>{type.retentionPolicyReference.source}</dd><dt>Fluxo</dt><dd>{type.workflow.reviewRequired ? 'Revisão exigida' : 'Revisão facultativa'}; {type.workflow.signatureRequired ? 'assinatura exigida' : 'assinatura facultativa'}; {type.workflow.allowSelfApproval ? 'autoaprovação permitida pela política' : 'sem autoaprovação'}</dd><dt>Versões vigentes</dt><dd>{type.workflow.allowMultipleActiveVersions ? 'Exceção de múltiplas vigentes configurada' : 'Uma vigente por escopo'}</dd></dl></article>)}{!types.data.items.length && <EmptyState title="Nenhuma política disponível" description="As políticas aparecerão após a configuração dos tipos documentais." />}{types.data.total > types.data.items.length && <Feedback tone="info">Exibindo os primeiros {types.data.items.length} tipos. Consulte a lista de tipos para navegar pelo restante.</Feedback>}</>}
    {can('documentTypes.write') && <Link to="/app/configuracoes/tipos-documentais">Gerenciar políticas nos tipos documentais →</Link>}
  </div>;
}

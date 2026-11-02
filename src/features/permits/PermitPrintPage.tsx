import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useParams, useSearchParams } from 'react-router';
import { Download, Printer } from 'lucide-react';
import { api, API_MODE } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import { BrandLogo } from '../../shared/brand/BrandLogo';
import type { FinalPdfDto, WorkPermitDto } from '../../shared/contracts/work-permits';
import type { PermitAttachmentDto } from '../../shared/contracts/permit-attachments';
import { formatDate } from '../../shared/lib/format';
import { triggerDownload } from '../../shared/lib/downloads';
import { Button, EmptyState, Feedback, Field, PageHeader, Spinner } from '../../shared/ui';
import { isDrawingRepresentation, isImageRepresentation, errorMessage } from './validation';
import { printablePermit } from './print-record';
import { permitEventLabels } from './event-labels';
import { validateFinalPdf } from './final-pdf';
import { permitNavigation } from './permit-navigation';
import { PT_ACTIVITIES, PT_EQUIPMENT, PT_CONTROLS } from './templates/ri-s-36001';
import styles from './print.module.css';

const answers: Record<string, string> = { YES: 'Sim', NO: 'Não', NA: 'Não aplicável' };
const evidenceStatus: Record<string, string> = { APPROVED: 'Conferido', MISSING: 'Ausente', PENDING: 'Aguardando conferência', REJECTED: 'Reprovado', EXPIRED: 'Vencido' };
const optionNames = (ids: string[], options: { id: string; label: string }[]) => ids.map(id => options.find(item => item.id === id)?.label || id).join(', ');
const identificationLabels: Record<string, string> = {
  serviceProvider: 'Fornecedor de serviço', subcontractor: 'Fornecedor quarteirizado', group: 'Grupo',
  workFront: 'Frente de serviço', location: 'Local', activityDescription: 'Atividade a realizar',
  riskAnalysisReference: 'Referência da análise de risco', executorName: 'Executante', issuerName: 'Emitente',
  atmosphereNotes: 'Registro de atmosfera / medições', watchers: 'Vigias', supervisors: 'Supervisores',
};
function CheckTable({ items }: { items: { id: string; label: string; answer: string | null; note?: string; section?: string; serviceName?: string; templateVersion?: string; blockingAnswers?: ('YES' | 'NO')[] }[] }) {
  return <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Conferência</th><th>Resposta</th><th>Observação / justificativa</th></tr></thead><tbody>{items.map(item => <tr key={item.id}><td>{item.section && <small>{item.section}<br /></small>}{item.serviceName && <small>{item.serviceName} · template v{item.templateVersion || 'não registrada'}<br /></small>}{item.label}{item.blockingAnswers && <small>{item.blockingAnswers.length ? `Respostas impeditivas: ${item.blockingAnswers.map(answer => answers[answer]).join(', ')}` : 'Sem resposta impeditiva configurada'}</small>}</td><td>{item.answer ? answers[item.answer] || item.answer : 'Não respondido'}</td><td>{item.note || '—'}</td></tr>)}</tbody></table></div>;
}
export function PermitPrintPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const { unitId, sessionKey, can } = useSession();
  const location = useLocation();
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [pdfError, setPdfError] = useState('');
  const [pdfDisclaimer, setPdfDisclaimer] = useState('');
  const pdfRequest = useRef<AbortController | null>(null);
  const query = useQuery({ queryKey: ['work-permit', sessionKey, unitId, id], queryFn: ({ signal }) => api.get<WorkPermitDto>(`/work-permits/${id}`, { signal }) });
  const attachments = useQuery({ queryKey: ['permit-attachments', sessionKey, unitId, id], queryFn: ({ signal }) => api.get<PermitAttachmentDto[]>(`/work-permits/${id}/attachments`, { signal }), enabled: Boolean(query.data && query.data.appointment.unitId === unitId) });
  const permit = query.data;
  const returnOrigin = permitNavigation(location.state, sessionKey, unitId, id, can('appointments.read'), can('eligibility.read'), permit?.appointment.id);
  const backLink = <Link className="button button--secondary" to={`/app/pts/${encodeURIComponent(id || '')}`} state={returnOrigin}>Voltar à PT</Link>;
  const record = permit && printablePermit(permit, params.get('version'));
  const pdfContext = useRef('');
  pdfContext.current = JSON.stringify([id, sessionKey, unitId, permit?.id, permit?.appointment.unitId, record?.version, !query.isError && record?.snapshot?.decision === 'APPROVE']);
  useEffect(() => {
    setIsDownloadingPdf(false); setPdfError(''); setPdfDisclaimer('');
    return () => { pdfRequest.current?.abort(); pdfRequest.current = null; };
  }, [id, sessionKey, unitId, record?.version]);
  useEffect(() => {
    if (!permit || !record) return;
    const previous = document.title;
    document.title = `${permit.code} — versão ${record.version} — Ampara SESMT`;
    return () => { document.title = previous; };
  }, [permit?.code, record?.version]);
  if (query.isPending) return <Spinner />;
  if (query.isError || !permit) return <div className="panel stack"><Feedback tone="danger">{errorMessage(query.error)}</Feedback><div className="actions"><Button onClick={() => void query.refetch()}>Tentar novamente</Button>{backLink}</div></div>;
  if (permit.appointment.unitId !== unitId) return <div className="panel stack"><EmptyState title="PT de outra unidade" description="Selecione a unidade do atendimento para visualizar o registro." />{backLink}</div>;
  if (!record) return <div className="panel stack"><EmptyState title="Versão indisponível" description="A versão solicitada não está no histórico desta PT." />{backLink}</div>;
  const versions = [...new Set([...permit.snapshots.map(item => item.version), permit.version])].sort((a, b) => b - a);
  const files = (attachments.data || []).filter(item => item.version === record.version);
  const preparation = record.preparation;
  const marginLabel = `${permit.code} · versão ${record.version} · ${record.documentStatus}${API_MODE === 'demo' ? ' · DEMONSTRAÇÃO · SEM VALIDADE OPERACIONAL' : ''}`;
  const canDownloadFinalPdf = record.snapshot?.decision === 'APPROVE';

  async function downloadFinalPdf() {
    if (!permit || !record || permit.id !== id || permit.appointment.unitId !== unitId || query.isError || record.snapshot?.decision !== 'APPROVE' || pdfRequest.current) return;
    const controller = new AbortController(); pdfRequest.current = controller;
    const requestContext = pdfContext.current;
    setIsDownloadingPdf(true);
    setPdfError(''); setPdfDisclaimer('');
    try {
      const res = await api.get<FinalPdfDto>(`/work-permits/${permit.id}/final-pdf`, { query: { version: record.version }, signal: controller.signal });
      if (controller.signal.aborted || pdfRequest.current !== controller || requestContext !== pdfContext.current) return;
      validateFinalPdf(res, permit.id, record.version);
      triggerDownload(res.url, res.fileName);
      setPdfDisclaimer(res.backendPersisted ? res.disclaimer : res.disclaimer || 'PDF demonstrativo, sem persistência ou validade operacional.');
    } catch (err) {
      if (!controller.signal.aborted && requestContext === pdfContext.current) setPdfError(errorMessage(err));
    } finally {
      if (pdfRequest.current === controller) { pdfRequest.current = null; setIsDownloadingPdf(false); }
    }
  }

  return <div className={`stack ${styles.page}`}>
    <style media="print">{`@page { @bottom-center { content: ${JSON.stringify(marginLabel)} " · Página " counter(page) " de " counter(pages); font: 7pt Arial, sans-serif; color: #596c63; } }`}</style>
    <div className={styles.toolbar}><PageHeader eyebrow="Registro da permissão" title="Visualização e impressão da PT" description="Confira a versão e o estado do registro antes de imprimir ou salvar em PDF." actions={<>{backLink}{canDownloadFinalPdf && <Button variant="secondary" onClick={downloadFinalPdf} disabled={isDownloadingPdf}><Download size={16} aria-hidden="true" /> {isDownloadingPdf ? 'Baixando…' : 'Baixar PDF final'}</Button>}<Button onClick={() => window.print()} disabled={attachments.isPending || attachments.isError}><Printer size={16} aria-hidden="true" /> Imprimir / salvar PDF</Button></>} />
      {pdfDisclaimer && <Feedback tone="info">{pdfDisclaimer}</Feedback>}
      {canDownloadFinalPdf && API_MODE === 'demo' && <Feedback>O PDF desta versão aprovada é demonstrativo, sem persistência ou validade operacional.</Feedback>}
      {pdfError && <Feedback tone="danger">{pdfError}</Feedback>}
      <Field label="Versão do registro"><select value={record.version} onChange={event => setParams({ version: event.target.value }, { state: returnOrigin })}>{versions.map(version => <option key={version} value={version}>Versão {version}{version === permit.version ? ' · atual' : ' · histórica'}</option>)}</select></Field>
      {attachments.isError && <Feedback tone="danger">Não foi possível carregar os anexos. <Button variant="secondary" onClick={() => void attachments.refetch()}>Tentar novamente</Button></Feedback>}
    </div>
    <article className={styles.paper} aria-label="Registro imprimível da PT" data-print-record>
      <header className={styles.documentHeader}><div><BrandLogo className={styles.documentBrand} /><p className={styles.kicker}>AMPARA SESMT · PERMISSÃO DE TRABALHO</p><h1>{permit.code}</h1><p>Versão {record.version} · Template {record.templateVersion}</p></div><strong className={styles.status}>{record.documentStatus}</strong></header>
      {API_MODE === 'demo' && <p className={styles.demo}>DEMONSTRAÇÃO · DADOS FICTÍCIOS · SEM VALIDADE OPERACIONAL</p>}
      <section><h2>Liberação e execução preservadas</h2>{record.release ? <><dl className={styles.facts}><div><dt>Liberação registrada em</dt><dd>{formatDate(record.release.releasedAt)}</dd></div><div><dt>Responsável pela liberação</dt><dd>{record.release.releasedByName}</dd></div><div><dt>Início registrado</dt><dd>{record.startedAt ? formatDate(record.startedAt) : 'Não preservado nesta versão'}</dd></div><div><dt>Conclusão registrada</dt><dd>{record.completedAt ? formatDate(record.completedAt) : 'Não preservada nesta versão'}</dd></div></dl><p className={styles.small}>A liberação preserva o contexto, preparação, checklist, ciências e conferência documental daquele momento. Alterações da revisão documental não autorizam retroativamente a operação.</p><CheckTable items={record.release.checklist} /></> : <p className={styles.notice}>{record.snapshot ? 'O registro de liberação não foi preservado nesta versão histórica.' : 'Nenhuma liberação registrada.'}</p>}</section>
      <section><h2>Identificação do atendimento</h2>{!record.identificationVersioned && <p className={styles.notice}>Esta versão antiga não armazenou a identificação do atendimento. Os dados abaixo são os do cadastro atual; o conteúdo submetido e a decisão estão preservados nas demais seções.</p>}<dl className={styles.facts}><div><dt>Serviço</dt><dd>{record.appointment.serviceLabel}</dd></div><div><dt>Equipe</dt><dd>{record.appointment.teamName}</dd></div><div><dt>Local</dt><dd>{record.appointment.location}</dd></div><div><dt>Responsável</dt><dd>{record.appointment.responsibleName}</dd></div><div><dt>Início planejado</dt><dd>{formatDate(record.appointment.startsAt)}</dd></div><div><dt>Término planejado</dt><dd>{formatDate(record.appointment.endsAt)}</dd></div></dl></section>
      {record.serviceTemplates?.length ? <section><h2>Serviços e templates preservados</h2><p className={styles.small}>Versões fixadas na abertura do atendimento, preservadas nesta versão documental.</p><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Serviço</th><th>Template</th><th>Publicação</th></tr></thead><tbody>{record.serviceTemplates.map(template => <tr key={template.serviceTypeId}><td>{template.serviceName}</td><td>Versão {template.version} · {template.questions.length} perguntas</td><td>{formatDate(template.publishedAt)} · {template.publishedBy}</td></tr>)}</tbody></table></div></section> : record.snapshot && <p className={styles.notice}>Os templates por serviço não foram armazenados nesta versão histórica. O catálogo atual não foi aplicado a este registro.</p>}
      {preparation ? <>
        <section><h2>Preparação e análise do serviço</h2><p className={styles.small}>Referência: {preparation.sourceId} · revisão {preparation.sourceRevision}</p><dl className={styles.facts}>{Object.entries(preparation.identification).filter(([, value]) => value).map(([key, value]) => <div key={key}><dt>{identificationLabels[key] || key}</dt><dd>{String(value)}</dd></div>)}</dl></section>
        <section><h2>EPIs/EPCs e medidas de controle</h2><p><strong>Atividades:</strong> {optionNames(preparation.activities, PT_ACTIVITIES) || 'Nenhuma registrada'}</p><p><strong>Equipamentos selecionados:</strong> {optionNames(preparation.equipment, PT_EQUIPMENT) || 'Nenhum registrado'}</p><p><strong>Medidas gerais:</strong> {optionNames(preparation.controls, PT_CONTROLS) || 'Nenhuma registrada'}</p><p><strong>Medidas adicionais:</strong> {preparation.additionalControls || 'Não registradas'}</p></section>
        {preparation.checks.some(item => preparation.activities.includes(item.section)) && <section><h2>Conferências por atividade</h2><CheckTable items={preparation.checks.filter(item => preparation.activities.includes(item.section)).map(item => ({ ...item, section: PT_ACTIVITIES.find(activity => activity.id === item.section)?.label || item.section }))} /></section>}
        {preparation.measurements.length > 0 && <section><h2>Registros de medições atmosféricas</h2><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Data / responsável / instrumento</th><th>Oxigênio / CO — valores e unidades</th><th>Explosividade / outros — valores e unidades</th></tr></thead><tbody>{preparation.measurements.map(item => <tr key={item.id}><td>{item.measuredAt}<br />{item.responsible}<br />{item.instrument}</td><td>{item.oxygen || '—'} / {item.carbonMonoxide || '—'}</td><td>{item.explosivity || '—'} / {item.other || '—'}</td></tr>)}</tbody></table></div><p className={styles.small}>Registros informados no atendimento. A seção de espaço confinado da PT não substitui a PET específica.</p></section>}
        {preparation.closingChecks.length > 0 && <section><h2>Checklist de encerramento</h2><CheckTable items={preparation.closingChecks.map(item => ({ ...item, section: undefined }))} /></section>}
      </> : <p className={styles.notice}>Registro anterior à adoção do modelo RI-S-36001. Preparação e checklist de encerramento não constam desta versão.</p>}
      <section><h2>Conferência inicial do atendimento</h2><CheckTable items={record.checklist} /></section>
      <section><h2>Conferência documental registrada</h2>{record.eligibility ? <><p className={styles.small}>Matriz {record.eligibility.requirementVersion} · {record.snapshot ? 'Registro preservado no encerramento' : 'Consulta atual do atendimento'} em {formatDate(record.eligibility.checkedAt)}. A situação documental não substitui a liberação operacional.</p><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Participante / função</th><th>Requisito</th><th>Situação administrativa</th></tr></thead><tbody>{record.eligibility.participants.flatMap(person => person.items.map(item => <tr key={`${person.workerId}-${item.requirementId}`}><td>{person.name}<br /><small>{person.serviceFunction}</small></td><td>{item.label}</td><td>{evidenceStatus[item.status] || item.status}{item.restricted && <small>Conferência restrita</small>}</td></tr>))}</tbody></table></div></> : <p className={styles.notice}>A conferência documental não foi armazenada nesta versão histórica.</p>}</section>
      <section><h2>Participantes e manifestações</h2><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Participante / função</th><th>Manifestação nesta versão</th><th>Coleta</th></tr></thead><tbody>{record.appointment.participants.map(person => { const science = record.sciences.find(item => item.workerId === person.workerId && item.version === record.version); return <tr key={person.workerId}><td>{person.name}<br /><small>{person.serviceFunction}</small></td><td>{science ? <>{science.method === 'DRAWN' && isDrawingRepresentation(science.representation) ? <img className={styles.signature} src={science.representation} alt={`Representação visual de ${person.name}`} /> : science.declarantName}<small>{science.method === 'DRAWN' ? 'Desenho' : 'Nome digitado'} · confirmação registrada</small></> : 'Não registrada'}</td><td>{science ? <>{science.collectedByName}<br />{formatDate(science.collectedAt)}</> : '—'}</td></tr>; })}</tbody></table></div><p className={styles.small}>Nome e desenho são representações visuais de manifestação; o método e o coletor estão identificados no registro.</p></section>
      <section><h2>Resultado e revisão do encerramento</h2><p className={styles.preserve}>{record.summary || 'Resumo ainda não registrado.'}</p>{record.snapshot && <dl className={styles.facts}><div><dt>Submetida em</dt><dd>{formatDate(record.snapshot.submittedAt)}</dd></div><div><dt>Decisão</dt><dd>{record.documentStatus}</dd></div><div><dt>Revisada em</dt><dd>{formatDate(record.snapshot.reviewedAt)}</dd></div><div><dt>Representação do responsável pela aprovação</dt><dd>{record.snapshot.signatureImage && (isDrawingRepresentation(record.snapshot.signatureImage) || isImageRepresentation(record.snapshot.signatureImage)) ? <div><img className={styles.signature} src={record.snapshot.signatureImage} alt={`Representação visual de ${record.snapshot.signatureRepresentation || 'engenheiro'}`} /><small>{record.snapshot.signatureRepresentation || 'Assinatura'} ({record.snapshot.signatureMethod === 'DRAWN' ? 'Desenho' : record.snapshot.signatureMethod === 'IMAGE' ? 'Rubrica digitalizada' : 'Representação visual'})</small></div> : (record.snapshot.signatureRepresentation || 'Não registrada')}</dd></div></dl>}{record.snapshot?.comment && <p className={styles.preserve}>{record.snapshot.comment}</p>}</section>
      <section><h2>Anexos de acompanhamento</h2>{attachments.isPending ? <p>Carregando anexos…</p> : attachments.isError ? <p>Relação de anexos indisponível.</p> : files.length ? <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Arquivo</th><th>Descrição</th><th>Registro</th></tr></thead><tbody>{files.map(file => <tr key={file.id}><td>{file.name}</td><td>{file.caption}</td><td>{formatDate(file.uploadedAt)}</td></tr>)}</tbody></table></div> : <p>Nenhum anexo nesta versão.</p>}</section>
      <section><h2>Histórico da versão</h2><ul className={styles.events}>{record.history.map(event => <li key={event.id}><strong>{permitEventLabels[event.action] || event.action.replaceAll('_', ' ')}</strong> · {event.actorName} · {formatDate(event.occurredAt)}{event.reason && <p>{event.reason}</p>}</li>)}</ul></section>
      <footer className={styles.documentFooter}>{permit.code} · versão {record.version} · {record.documentStatus}{API_MODE === 'demo' && ' · demonstração'}</footer>
    </article>
  </div>;
}

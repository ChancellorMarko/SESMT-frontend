import { useState } from 'react';
import { ApiError } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import { InvalidReadResponse, useVerifiedRead } from '../../shared/lib/verified-read';
import { Button, Feedback, Spinner } from '../../shared/ui';
import { checkedPinnedTemplates, checklistDraft, loadPinnedTemplates, type NativeTemplate } from './checklists';
import type { NativePermit } from './contracts';
import { NativeChecklistEditor } from './NativeChecklistEditor';
import { NativeChecklistFields } from './NativeChecklistFields';

export function NativePermitChecklists({ item, refreshing, onDone }: { item: NativePermit; refreshing: boolean; onDone: () => Promise<void> }) {
  const { sessionKey, can } = useSession();
  const [loaded, load] = useState(false), [closingView, setView] = useState(false);
  const [editing, edit] = useState<{ item: NativePermit; templates: NativeTemplate[]; closing: boolean }>();
  const models = useVerifiedRead({ queryKey: ['native-permit-templates', sessionKey, item.id, item.version, item.companyId, item.serviceCode, item.templateVersionIds], scope: ['native-permit-templates', sessionKey, item.id], enabled: loaded && !refreshing && Boolean(item.templateVersionIds.length),
    request: signal => loadPinnedTemplates(item, signal), validate: value => checkedPinnedTemplates(value, item) });
  let opening, closing, invalid = false;
  if (models.data) {
    try { opening = checklistDraft(models.data.flatMap(model => model.perguntas), item.checklistAnswers); closing = checklistDraft(models.data.flatMap(model => model.closingQuestions), item.closingAnswers ?? []); }
    catch { invalid = true; }
  }
  const closingAvailable = Boolean(models.data?.every(model => model.closingQuestions.length));
  const denied = models.error instanceof InvalidReadResponse || models.error instanceof ApiError && [401, 403, 404].includes(models.error.status);
  return <section className="panel stack" aria-label="Checklists da PT">
    <div className="actions"><h2>Checklists</h2><Button variant="secondary" disabled={refreshing || models.isFetching || !item.templateVersionIds.length} onClick={() => { load(true); if (loaded) void models.refetch(); }}>{loaded ? 'Atualizar checklists' : 'Carregar checklists'}</Button></div>
    {!item.templateVersionIds.length && <Feedback tone="warning">Esta PT não informa versões de modelos fixadas.</Feedback>}
    {models.isPending && <Spinner/>}{models.isError && <Feedback tone="danger">{models.error instanceof ApiError && models.error.status === 403 ? 'A API não autorizou a leitura dos modelos desta PT para esta conta. Os demais dados da PT continuam disponíveis.' : 'Não foi possível conferir as versões fixadas desta PT. Atualize os checklists.'}</Feedback>}
    {invalid && <Feedback tone="danger">As respostas não correspondem às perguntas fixadas. Atualize a PT antes de continuar.</Feedback>}
    {models.data && !invalid && <>
      <div className="actions" role="group" aria-label="Etapa do checklist"><Button variant={closingView ? 'ghost' : 'primary'} aria-pressed={!closingView} onClick={() => setView(false)}>Abertura</Button><Button variant={closingView ? 'primary' : 'ghost'} aria-pressed={closingView} onClick={() => setView(true)}>Encerramento</Button></div>
      {closingView && !closingAvailable ? <Feedback tone="warning">Há modelo sem verificações de encerramento. A conclusão depende dessas perguntas no backend.</Feedback> : <details><summary>Visualizar perguntas e respostas</summary><NativeChecklistFields templates={models.data} closing={closingView} draft={(closingView ? closing : opening)!}/></details>}
      <div className="actions">{item.status === 'EM_VERIFICACAO' && can('pt:editar') && <Button disabled={refreshing || models.isFetching} onClick={() => edit({ item, templates: models.data!, closing: false })}>Preencher checklist</Button>}{item.status === 'EM_EXECUCAO' && can('pt:concluir') && <Button disabled={!closingAvailable || refreshing || models.isFetching} onClick={() => edit({ item, templates: models.data!, closing: true })}>Encerrar serviço</Button>}</div>
    </>}
    {editing && !denied && <NativeChecklistEditor key={`${editing.item.id}:${editing.item.version}:${editing.closing}`} {...editing} onClose={() => edit(undefined)} onDone={async () => { edit(undefined); await onDone(); }}/ >}
  </section>;
}

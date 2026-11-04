import { useState } from 'react';
import { api } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import { InvalidReadResponse } from '../../shared/lib/verified-read';
import { Field, InfoButton } from '../../shared/ui';
import { NativeCommandDialog, NativeFormError } from '../native-operations/NativeCommandDialog';
import { checklistAnswers, checklistDraft, sameAnswers, type ChecklistDraft, type NativeTemplate } from './checklists';
import { checkedPermit, same, type NativePermit } from './contracts';
import { NativeChecklistFields } from './NativeChecklistFields';
import { checklistEndInstant } from './checklist-time';

export function NativeChecklistEditor({ item, templates, closing, onClose, onDone }: {
  item: NativePermit; templates: NativeTemplate[]; closing: boolean; onClose: () => void; onDone: () => Promise<void>;
}) {
  const { can } = useSession(), questions = templates.flatMap(template => closing ? template.closingQuestions : template.perguntas);
  const [initial] = useState(() => checklistDraft(questions, closing ? item.closingAnswers ?? [] : item.checklistAnswers));
  const [draft, setDraft] = useState<ChecklistDraft>(initial), [summary, setSummary] = useState(''), [actualEnd, setEnd] = useState(''), [confirmation, confirm] = useState(false);
  const dirty = JSON.stringify(initial) !== JSON.stringify(draft) || Boolean(summary || actualEnd || confirmation);
  function change(id: string, field: 'value' | 'justification', value: string) { setDraft(previous => ({ ...previous, [id]: { ...previous[id], [field]: value } })); }
  async function perform(signal: AbortSignal) {
    if (!can(closing ? 'pt:concluir' : 'pt:editar') || item.status !== (closing ? 'EM_EXECUCAO' : 'EM_VERIFICACAO')) throw new NativeFormError('Confira seus acessos e a situação da PT antes de salvar.');
    if (!same(templates.map(template => template.id), item.templateVersionIds) || closing && templates.some(template => !template.closingQuestions.length)) throw new NativeFormError('As verificações de encerramento precisam estar disponíveis em todos os modelos fixados.');
    const answers = checklistAnswers(questions, draft, closing), end = checklistEndInstant(actualEnd);
    if (closing && (!confirmation || !summary.trim() || summary.trim().length > 4000 || !end || !item.startedAt || Date.parse(end) < Date.parse(item.startedAt) || Date.parse(end) > Date.now())) throw new NativeFormError('Confirme o encerramento, informe o resumo e um término efetivo entre o início do serviço e agora, em Brasília.');
    const payload = closing ? { expectedVersion: item.version, summary: summary.trim(), actualEnd: end, closingAnswers: answers } : { expectedVersion: item.version, answers };
    const response = closing ? await api.post<unknown>(`/work-permits/${item.id}/complete`, payload, { signal }) : await api.patch<unknown>(`/work-permits/${item.id}/checklist`, payload, { signal });
    const updated = checkedPermit(response, item.id);
    if (updated.version !== item.version + 1 || updated.contentVersion !== item.contentVersion + (closing ? 0 : 1)
      || updated.companyId !== item.companyId || updated.appointmentId !== item.appointmentId || updated.title !== item.title || updated.serviceCode !== item.serviceCode
      || !same(updated.templateVersionIds, item.templateVersionIds) || !same(updated.participants.map(person => person.userId), item.participants.map(person => person.userId))
      || updated.status !== (closing ? 'CONCLUIDA' : item.status) || !sameAnswers(closing ? updated.closingAnswers ?? [] : updated.checklistAnswers, answers)
      || closing && (!updated.completedAt || updated.reviewStatus !== 'AGUARDANDO_REVISAO' || updated.completionSummary !== summary.trim() || Date.parse(updated.actualEnd ?? '') !== Date.parse(end!))) throw new InvalidReadResponse();
  }
  return <NativeCommandDialog title={closing ? 'Encerrar serviço' : 'Preencher checklist'} dirty={dirty} onClose={onClose} onDone={onDone} perform={perform} submitLabel={closing ? 'Confirmar encerramento' : 'Salvar respostas'}>{busy => <>
    <div className="actions"><span>{item.title} · versão {item.version}</span><InfoButton title="Preenchimento do checklist"><p>As perguntas pertencem às versões fixadas nesta PT. O preenchimento de abertura pode ser salvo parcialmente; isso não libera a operação. O encerramento exige as verificações obrigatórias e não aceita respostas impeditivas.</p></InfoButton></div>
    <NativeChecklistFields templates={templates} closing={closing} draft={draft} onChange={change} disabled={busy}/>
    {closing && <><Field label="Resumo do encerramento" required><textarea maxLength={4000} value={summary} disabled={busy} onChange={event => setSummary(event.target.value)}/></Field><Field label="Término efetivo (Brasília)" required><input type="datetime-local" step={1} value={actualEnd} disabled={busy} onChange={event => setEnd(event.target.value)}/></Field><label><input type="checkbox" checked={confirmation} disabled={busy} onChange={event => confirm(event.target.checked)}/> Confirmo as verificações e o encerramento do serviço.</label></>}
  </>}</NativeCommandDialog>;
}

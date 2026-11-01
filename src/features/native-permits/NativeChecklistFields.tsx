import { Badge, Field, InfoButton } from '../../shared/ui';
import { type ChecklistDraft, type NativeQuestion, type NativeTemplate } from './checklists';
import styles from './NativeChecklists.module.css';

export function NativeChecklistFields({ templates, closing, draft, onChange, disabled }: {
  templates: NativeTemplate[]; closing: boolean; draft: ChecklistDraft; onChange?: (id: string, field: 'value' | 'justification', value: string) => void; disabled?: boolean;
}) {
  return <div className={styles.groups}>{templates.map(template => <fieldset className={styles.group} key={template.id} disabled={disabled}>
    <legend>{template.nome} · versão {template.versao}</legend>
    <InfoButton title={`Modelo: ${template.nome}`}><p>{template.ilustrativo ? 'Modelo ilustrativo' : 'Modelo sem marcação de ilustrativo'} · versão fixada {template.versao}</p><p>{template.id}</p></InfoButton>
    {(closing ? template.closingQuestions : template.perguntas).map(question => <Question key={question.id} question={question} entry={draft[question.id]} onChange={onChange} disabled={disabled}/>)}
  </fieldset>)}</div>;
}
function Question({ question, entry, onChange, disabled }: { question: NativeQuestion; entry?: ChecklistDraft[string]; onChange?: (id: string, field: 'value' | 'justification', value: string) => void; disabled?: boolean }) {
  const value = entry?.value ?? '', justification = entry?.justification ?? '';
  return <div className={styles.question} data-question-id={question.id}>
    <div className={styles.caption}>{question.obrigatoria && <Badge>Obrigatória</Badge>}{question.impeditiva && <Badge tone="warning">Impeditiva</Badge>}</div>
    {!onChange ? <div><strong>{question.texto}</strong><p>{value === '' ? 'Sem resposta' : question.tipo === 'BOOLEAN' ? value === 'true' ? 'Sim' : 'Não' : value}</p>{justification && <p className={styles.note}>{justification}</p>}</div> : <>
      <Field label={question.texto} required={question.obrigatoria}>{question.tipo === 'BOOLEAN' ? <select value={value} disabled={disabled} onChange={event => onChange(question.id, 'value', event.target.value)}><option value="">Sem resposta</option><option value="true">Sim</option><option value="false">Não</option></select>
        : question.tipo === 'NUMBER' ? <input type="text" inputMode="decimal" value={value} disabled={disabled} onChange={event => onChange(question.id, 'value', event.target.value)}/>
        : <textarea value={value} disabled={disabled} onChange={event => onChange(question.id, 'value', event.target.value)}/>}</Field>
      {question.tipo === 'NUMBER' && <small>Use vírgula ou ponto decimal, sem separador de milhar.</small>}
      <details open={justification ? true : undefined}><summary>Justificativa</summary><textarea aria-label={`Justificativa: ${question.texto}`} value={justification} disabled={disabled} onChange={event => onChange(question.id, 'justification', event.target.value)}/></details>
    </>}
  </div>;
}

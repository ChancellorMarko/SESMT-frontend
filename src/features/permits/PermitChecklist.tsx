import { useId, useState, type FormEvent } from 'react';
import type { ChecklistItemDto } from '../../shared/contracts/work-permits';
import { Button, Field } from '../../shared/ui';
import { checklistIssues } from './validation';
import { issueMessage, issueTargetId, PermitFormFeedback, usePermitIssueFocus } from './PermitFormFeedback';
import styles from './permits.module.css';
import feedbackStyles from './PermitFormFeedback.module.css';

export function PermitChecklist({ items, editable, pending, dirty, stale, onChange, onSubmit }: {
  items: ChecklistItemDto[]; editable: boolean; pending: boolean; dirty: boolean; stale: boolean;
  onChange: (id: string, changes: Partial<ChecklistItemDto>) => void; onSubmit: (event: FormEvent) => void;
}) {
  const prefix = useId();
  const [attempt, setAttempt] = useState(0);
  const issues = editable && attempt > 0 ? checklistIssues(items) : [];
  usePermitIssueFocus(prefix, issues, attempt);
  const namedIssues = issues.map(issue => ({ ...issue, label: `${items.find(item => issue.path === `checklist.${item.id}.answer` || issue.path === `checklist.${item.id}.note`)?.label || 'Item do checklist'}${issue.path.endsWith('.note') ? ' · observação' : ''}` }));
  return <form className="stack" onSubmit={event => { setAttempt(value => value + 1); onSubmit(event); }}>
    <PermitFormFeedback issues={namedIssues} prefix={prefix} title="Pendências do checklist" />
    {items.map((item, index) => {
      const answerPath = `checklist.${item.id}.answer`, notePath = `checklist.${item.id}.note`;
      const answerError = issueMessage(issues, answerPath), noteError = issueMessage(issues, notePath);
      const answerId = issueTargetId(prefix, answerPath);
      return <fieldset key={item.id} id={answerId} tabIndex={-1} disabled={!editable || pending} aria-invalid={answerError ? true : undefined} aria-describedby={answerError ? `${answerId}-error` : undefined} className={`${styles.checklistItem} ${answerError || noteError ? feedbackStyles.invalid : ''} ${feedbackStyles.target}`}>
        <legend>{index + 1}. {item.label}{item.required && <span> (obrigatório)</span>}</legend>
        {item.serviceName && <p className="muted">{item.serviceName} · template v{item.templateVersion || 'não registrada'}</p>}
        <div className={styles.answerOptions}>{(['YES', 'NO'] as const).map(answer => <label key={answer}><input type="radio" name={`checklist-${prefix}-${item.id}`} checked={item.answer === answer} aria-invalid={answerError ? true : undefined} aria-describedby={answerError ? `${answerId}-error` : undefined} onChange={() => onChange(item.id, { answer })} />{answer === 'YES' ? 'Sim' : 'Não'}</label>)}</div>
        {answerError && <p id={`${answerId}-error`} className={feedbackStyles.error}>{answerError}</p>}
        {item.blockingAnswers && <small className="muted">{item.blockingAnswers.length ? `Respostas impeditivas deste template: ${item.blockingAnswers.map(answer => answer === 'YES' ? 'Sim' : 'Não').join(', ')}.` : 'Este item registra a condição, sem resposta impeditiva configurada.'}</small>}
        {(editable || item.note) && <Field label={`Observação do item ${index + 1}`} required={item.answer === 'NO'} error={noteError}><textarea id={issueTargetId(prefix, notePath)} aria-label={`Observação do item ${index + 1}`} value={item.note || ''} rows={2} maxLength={1000} placeholder={item.answer === 'NO' ? 'Explique a situação desta resposta.' : 'Observação, quando necessária.'} onChange={event => onChange(item.id, { note: event.target.value })} /></Field>}
      </fieldset>;
    })}
    {editable && <div className="actions"><Button variant="secondary" disabled={pending || stale} onClick={() => setAttempt(value => value + 1)}>Conferir checklist</Button><Button type="submit" disabled={pending || !dirty || stale}>Salvar checklist</Button><span className="muted" role="status">{dirty ? 'Há respostas ainda não salvas.' : 'Respostas sincronizadas com esta versão.'}</span></div>}
  </form>;
}

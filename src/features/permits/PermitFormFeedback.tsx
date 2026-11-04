import { useEffect, useId, useRef, useState } from 'react';
import type { PermitValidationIssue } from './validation-issues';
import styles from './PermitFormFeedback.module.css';

export type NamedPermitIssue = PermitValidationIssue & { label: string };
export const issueTargetId = (prefix: string, path: string) => `${prefix}-${encodeURIComponent(path)}`;
const requiredFieldMessages: Record<string, string> = {
  'preparation.identification.serviceProvider': 'Informe o fornecedor de serviço.',
  'preparation.identification.workFront': 'Informe a frente de serviço.',
  'preparation.identification.location': 'Informe o local de execução.',
  'preparation.identification.riskAnalysisReference': 'Informe a referência da análise de risco.',
};
function displayMessage(issue: PermitValidationIssue) {
  return issue.message === 'Informe fornecedor, frente, local e referência da análise de risco.'
    ? requiredFieldMessages[issue.path] ?? issue.message : issue.message;
}
export const issueMessage = (issues: PermitValidationIssue[], path: string) => {
  const issue = issues.find(issue => issue.path === path);
  return issue ? displayMessage(issue) : undefined;
};

export function focusPermitIssue(prefix: string, path: string) {
  const target = document.getElementById(issueTargetId(prefix, path));
  if (!target) return;
  for (let parent = target.parentElement; parent; parent = parent.parentElement) {
    if (parent instanceof HTMLDetailsElement) parent.open = true;
  }
  const control = path === 'preparation.model' || target.matches('input,textarea,select') ? target
    : target.querySelector<HTMLElement>('input:not(:disabled),textarea:not(:disabled),select:not(:disabled)') ?? target;
  control.focus({ preventScroll: true });
  control.scrollIntoView?.({ block: path === 'preparation.model' ? 'start' : 'center', behavior: 'instant' });
}

/** Validation requests move focus once; editing never steals focus back. */
export function usePermitIssueFocus(prefix: string, issues: PermitValidationIssue[], attempt: number) {
  const previousAttempt = useRef(attempt);
  useEffect(() => {
    if (previousAttempt.current === attempt) return;
    previousAttempt.current = attempt;
    if (issues[0]) focusPermitIssue(prefix, issues[0].path);
  }, [prefix, issues, attempt]);
}

export function PermitFormFeedback({ issues, prefix, title }: { issues: NamedPermitIssue[]; prefix: string; title: string }) {
  const heading = useId();
  const [expanded, setExpanded] = useState(false);
  const unique = issues.filter((issue, index) => issues.findIndex(other => other.path === issue.path) === index);
  if (!unique.length) return null;
  const visible = expanded ? unique : unique.slice(0, 5);
  return <section className={styles.summary} aria-labelledby={heading}>
    <h3 id={heading}>{title}</h3>
    <p>{unique.length} {unique.length === 1 ? 'campo precisa de atenção' : 'campos precisam de atenção'}. Selecione uma pendência para ir ao campo.</p>
    <ul>{visible.map(issue => <li key={issue.path}><button type="button" onClick={() => focusPermitIssue(prefix, issue.path)}><strong>{issue.label}</strong><span>{displayMessage(issue)}</span></button></li>)}</ul>
    {unique.length > 5 && <button type="button" className={styles.expand} onClick={() => setExpanded(value => !value)}>{expanded ? 'Mostrar menos pendências' : `Mostrar todas as ${unique.length} pendências`}</button>}
  </section>;
}

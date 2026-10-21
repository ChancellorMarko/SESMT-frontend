import { useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AppointmentDto, ChecklistItemDto, PermitPreparationDto } from '../../shared/contracts/work-permits';
import { PermitChecklist } from './PermitChecklist';
import { PermitFormFeedback, issueTargetId } from './PermitFormFeedback';
import { PermitPreparation } from './PermitPreparation';
import { createPermitPreparation, validatePreparation } from './templates/ri-s-36001';
import { validateChecklist } from './validation';

const initialPreparation = () => createPermitPreparation({ location: '', responsibleName: '' } as AppointmentDto);
function preparationWithCheck(answer: 'NO' | 'NA' = 'NO') {
  const value = initialPreparation();
  value.identification = { ...value.identification, activityDescription: 'Manutenção do equipamento demonstrativo.', serviceProvider: 'Fornecedor Demo', workFront: 'Frente Demo', location: 'Local Demo', riskAnalysisReference: 'APT-DEMO' };
  value.activities = ['electrical'];
  value.checks = [{ ...value.checks.find(item => item.section === 'electrical')!, answer }];
  return value;
}
const checklistItem = (changes: Partial<ChecklistItemDto> = {}): ChecklistItemDto => ({ id: 'item-1', label: 'Condição de demonstração', required: true, answer: null, ...changes });

function PreparationHarness({ initial = initialPreparation(), editable = true, pending = false, onAttempt, onSave }: {
  initial?: PermitPreparationDto; editable?: boolean; pending?: boolean;
  onAttempt?: (error: string | undefined) => void; onSave?: (value: PermitPreparationDto) => void;
}) {
  const [value, setValue] = useState(initial);
  return <PermitPreparation value={value} editable={editable} pending={pending} dirty onChange={setValue} onSubmit={event => {
    event.preventDefault();
    const error = validatePreparation(value);
    onAttempt?.(error);
    if (!error) onSave?.(value);
  }} />;
}

function ChecklistHarness({ initial = [checklistItem()], editable = true, onAttempt, onSave }: {
  initial?: ChecklistItemDto[]; editable?: boolean;
  onAttempt?: (error: string | undefined) => void; onSave?: (value: ChecklistItemDto[]) => void;
}) {
  const [items, setItems] = useState(initial);
  return <PermitChecklist items={items} editable={editable} pending={false} dirty stale={false} onChange={(id, changes) => setItems(current => current.map(item => item.id === id ? { ...item, ...changes } : item))} onSubmit={event => {
    event.preventDefault();
    const error = validateChecklist(items);
    onAttempt?.(error);
    if (!error) onSave?.(items);
  }} />;
}

describe('orientação de preenchimento da preparação e do checklist da PT', () => {
  it('confere a preparação inicial e relaciona o erro ao primeiro campo, com foco na atividade', async () => {
    const user = userEvent.setup();
    render(<PreparationHarness />);
    expect(screen.queryByRole('region', { name: 'Pendências da preparação' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Conferir preenchimento' }));
    const activity = screen.getByRole('textbox', { name: 'Atividade a ser realizada' });
    await waitFor(() => expect(activity).toHaveFocus());
    expect(activity).toHaveAttribute('aria-invalid', 'true');
    const errorId = activity.getAttribute('aria-describedby');
    expect(errorId).toBeTruthy();
    expect(document.getElementById(errorId!)).toHaveTextContent('Descreva a atividade com pelo menos 10 caracteres.');
    expect(screen.getByRole('region', { name: 'Pendências da preparação' })).toHaveTextContent('6 campos precisam de atenção');
  });

  it('atualiza pendências ao corrigir sem deslocar o foco e permite retornar pelo resumo', async () => {
    const user = userEvent.setup();
    render(<PreparationHarness />);
    await user.click(screen.getByRole('button', { name: 'Conferir preenchimento' }));
    const activity = screen.getByRole('textbox', { name: 'Atividade a ser realizada' });
    await user.type(activity, 'Manutenção do equipamento demonstrativo.');
    expect(activity).toHaveFocus();
    expect(activity).not.toHaveAttribute('aria-invalid', 'true');
    expect(activity).not.toHaveAttribute('aria-describedby');
    const summary = screen.getByRole('region', { name: 'Pendências da preparação' });
    expect(summary).toHaveTextContent('5 campos precisam de atenção');
    const provider = screen.getByRole('textbox', { name: 'Fornecedor de serviço' });
    await user.click(within(summary).getByRole('button', { name: /Fornecedor de serviço/ }));
    expect(provider).toHaveFocus();
  });

  it('continua permitindo salvar parcialmente após a conferência completa apontar pendências', async () => {
    const user = userEvent.setup(), onSave = vi.fn(), onAttempt = vi.fn();
    const initial = initialPreparation();
    expect(validatePreparation(initial, true)).toBeDefined();
    expect(validatePreparation(initial)).toBeUndefined();
    render(<PreparationHarness initial={initial} onSave={onSave} onAttempt={onAttempt} />);
    await user.click(screen.getByRole('button', { name: 'Conferir preenchimento' }));
    expect(screen.getByRole('region', { name: 'Pendências da preparação' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Salvar preparação da PT' }));
    expect(onAttempt).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(onSave).toHaveBeenCalledExactlyOnceWith(initial);
    expect(screen.queryByRole('region', { name: 'Pendências da preparação' })).not.toBeInTheDocument();
  });

  it.each(['NO', 'NA'] as const)('ao salvar resposta %s sem nota, abre os detalhes e leva à justificativa', async answer => {
    const user = userEvent.setup(), onSave = vi.fn(), onAttempt = vi.fn();
    const initial = preparationWithCheck(answer), label = `Justificativa: ${initial.checks[0].label}`;
    render(<PreparationHarness initial={initial} onSave={onSave} onAttempt={onAttempt} />);
    const note = screen.getByRole('textbox', { name: label });
    const details = note.closest('details')!;
    await user.click(within(details).getByText(/respondidos/));
    expect(details.open).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Salvar preparação da PT' }));
    await waitFor(() => expect(note).toHaveFocus());
    expect(details.open).toBe(true);
    expect(note).toHaveAttribute('aria-invalid', 'true');
    expect(onAttempt).toHaveBeenLastCalledWith('Justifique as respostas Não e Não aplicável em cada item.');
    expect(onSave).not.toHaveBeenCalled();
    await user.type(note, 'Situação e medidas registradas na análise de risco.');
    expect(note).toHaveFocus();
    expect(note).not.toHaveAttribute('aria-invalid', 'true');
    await user.click(screen.getByRole('button', { name: 'Salvar preparação da PT' }));
    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave.mock.calls[0][0].checks[0]).toMatchObject({ answer, note: 'Situação e medidas registradas na análise de risco.' });
  });

  it('leva à opção Sim quando um item obrigatório do checklist está sem resposta', async () => {
    const user = userEvent.setup();
    render(<ChecklistHarness />);
    await user.click(screen.getByRole('button', { name: 'Conferir checklist' }));
    const yes = screen.getByRole('radio', { name: 'Sim' });
    await waitFor(() => expect(yes).toHaveFocus());
    expect(yes).toHaveAttribute('aria-invalid', 'true');
    expect(document.getElementById(yes.getAttribute('aria-describedby')!)).toHaveTextContent('Responda todos os itens obrigatórios');
    await user.click(yes);
    expect(screen.queryByRole('region', { name: 'Pendências do checklist' })).not.toBeInTheDocument();
    expect(yes).toHaveFocus();
  });

  it('leva à observação de uma resposta Não e só aceita o salvamento após justificá-la', async () => {
    const user = userEvent.setup(), onSave = vi.fn(), onAttempt = vi.fn();
    render(<ChecklistHarness initial={[checklistItem({ answer: 'NO' })]} onSave={onSave} onAttempt={onAttempt} />);
    await user.click(screen.getByRole('button', { name: 'Salvar checklist' }));
    const note = screen.getByRole('textbox', { name: 'Observação do item 1' });
    await waitFor(() => expect(note).toHaveFocus());
    expect(note).toHaveAttribute('aria-invalid', 'true');
    expect(onAttempt).toHaveBeenLastCalledWith('Explique as respostas “Não” no campo de observação do item.');
    expect(onSave).not.toHaveBeenCalled();
    await user.type(note, 'Condição impeditiva registrada; atividade não liberada.');
    await user.click(screen.getByRole('button', { name: 'Salvar checklist' }));
    expect(onSave).toHaveBeenCalledOnce();
    expect(screen.queryByRole('region', { name: 'Pendências do checklist' })).not.toBeInTheDocument();
  });

  it('não trata uma resposta impeditiva justificada como erro de preenchimento', async () => {
    const user = userEvent.setup(), onSave = vi.fn();
    const initial = [checklistItem({ answer: 'NO', note: 'Condição impeditiva registrada.', blockingAnswers: ['NO'] })];
    render(<ChecklistHarness initial={initial} onSave={onSave} />);
    await user.click(screen.getByRole('button', { name: 'Conferir checklist' }));
    expect(screen.getByText('Respostas impeditivas deste template: Não.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Pendências do checklist' })).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Não' })).not.toHaveAttribute('aria-invalid', 'true');
    await user.click(screen.getByRole('button', { name: 'Salvar checklist' }));
    expect(onSave).toHaveBeenCalledExactlyOnceWith(initial);
  });

  it('preserva o modo de leitura sem ações de conferência nem erros de edição', () => {
    const { container } = render(<><PreparationHarness initial={preparationWithCheck()} editable={false} /><ChecklistHarness editable={false} /></>);
    expect(screen.queryByRole('button', { name: /Conferir|Salvar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /Pendências/ })).not.toBeInTheDocument();
    expect(container.querySelector('[aria-invalid="true"]')).not.toBeInTheDocument();
    expect(screen.getAllByRole('radio').every(control => control.matches(':disabled'))).toBe(true);
    expect(screen.getByRole('textbox', { name: 'Atividade a ser realizada' })).toBeDisabled();
  });

  it('abre e permite corrigir observação atmosférica preservada mesmo sem espaço confinado selecionado', async () => {
    const user = userEvent.setup(), onSave = vi.fn(), onAttempt = vi.fn();
    const initial = initialPreparation();
    initial.identification.atmosphereNotes = 'a'.repeat(2001);
    expect(initial.activities).not.toContain('confined-space');
    render(<PreparationHarness initial={initial} onSave={onSave} onAttempt={onAttempt} />);
    const details = screen.getByText('Avaliação atmosférica e responsáveis · registro documental').closest('details')!;
    expect(details.open).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Salvar preparação da PT' }));
    const notes = screen.getByRole('textbox', { name: 'Observações da avaliação atmosférica (opcional)' });
    await waitFor(() => expect(notes).toHaveFocus());
    expect(details.open).toBe(true);
    expect(notes).toHaveAttribute('aria-invalid', 'true');
    expect(onAttempt).toHaveBeenLastCalledWith('Confira o tamanho dos textos da preparação.');
    expect(onSave).not.toHaveBeenCalled();
    await user.keyboard('{Control>}a{/Control}');
    await user.paste('Registro documental preservado e corrigido.');
    expect(notes).toHaveValue('Registro documental preservado e corrigido.');
    expect(notes).toHaveFocus();
    expect(notes).not.toHaveAttribute('aria-invalid', 'true');
    expect(details).toBeInTheDocument();
    expect(details.open).toBe(true);
    expect(screen.queryByRole('region', { name: 'Pendências da preparação' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Salvar preparação da PT' }));
    expect(onSave).toHaveBeenCalledOnce();
  });

  it('remove erros ao entrar em modo de leitura sem anunciar conferência bem-sucedida', async () => {
    const user = userEvent.setup();
    const { container, rerender } = render(<PreparationHarness />);
    await user.click(screen.getByRole('button', { name: 'Conferir preenchimento' }));
    expect(screen.getByRole('region', { name: 'Pendências da preparação' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Atividade a ser realizada' })).toHaveAttribute('aria-invalid', 'true');
    rerender(<PreparationHarness editable={false} />);
    expect(screen.queryByText('Nenhuma pendência de preenchimento encontrada.')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Pendências da preparação' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Conferir preenchimento|Salvar preparação/ })).not.toBeInTheDocument();
    expect(container.querySelector('[aria-invalid="true"]')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Atividade a ser realizada' })).toBeDisabled();
  });

  it('mantém IDs e destinos distintos entre a preparação preservada e a atual', async () => {
    const user = userEvent.setup();
    const { container } = render(<><PreparationHarness editable={false} /><PreparationHarness /></>);
    const sections = screen.getAllByRole('region', { name: 'Preparação do modelo PT' });
    const historical = within(sections[0]).getByRole('textbox', { name: 'Atividade a ser realizada' });
    const current = within(sections[1]).getByRole('textbox', { name: 'Atividade a ser realizada' });
    expect(historical.id).not.toBe(current.id);
    const ids = Array.from(container.querySelectorAll('[id]'), element => element.id);
    expect(new Set(ids).size).toBe(ids.length);
    await user.click(within(sections[1]).getByRole('button', { name: 'Conferir preenchimento' }));
    expect(current).toHaveFocus();
    expect(historical).not.toHaveAttribute('aria-invalid', 'true');
    const summary = within(sections[1]).getByRole('region', { name: 'Pendências da preparação' });
    await user.click(within(summary).getByRole('button', { name: /Atividade a ser realizada/ }));
    expect(current).toHaveFocus();
  });

  it('resume cinco campos únicos, expande os restantes e permite focar um campo revelado', async () => {
    const user = userEvent.setup(), prefix = 'feedback-fixture';
    const issues = Array.from({ length: 7 }, (_, index) => ({ path: `field-${index}`, label: `Campo ${index + 1}`, message: 'Preencha este campo.' }));
    render(<><PermitFormFeedback issues={[...issues, issues[0]]} prefix={prefix} title="Pendências de teste" />{issues.map(issue => <input key={issue.path} id={issueTargetId(prefix, issue.path)} aria-label={issue.label} />)}</>);
    const summary = screen.getByRole('region', { name: 'Pendências de teste' });
    expect(summary).toHaveTextContent('7 campos precisam de atenção');
    expect(within(summary).getAllByRole('listitem')).toHaveLength(5);
    await user.click(within(summary).getByRole('button', { name: 'Mostrar todas as 7 pendências' }));
    expect(within(summary).getAllByRole('listitem')).toHaveLength(7);
    await user.click(within(summary).getByRole('button', { name: /Campo 7/ }));
    expect(screen.getByRole('textbox', { name: 'Campo 7' })).toHaveFocus();
    await user.click(within(summary).getByRole('button', { name: 'Mostrar menos pendências' }));
    expect(within(summary).getAllByRole('listitem')).toHaveLength(5);
  });

  it('bloqueia conferência e salvamento enquanto a preparação está sendo enviada', () => {
    render(<PreparationHarness pending />);
    expect(screen.getByRole('button', { name: 'Conferir preenchimento' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Salvar preparação da PT' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Atividade a ser realizada' })).toBeDisabled();
    expect(screen.queryByRole('region', { name: 'Pendências da preparação' })).not.toBeInTheDocument();
  });
});

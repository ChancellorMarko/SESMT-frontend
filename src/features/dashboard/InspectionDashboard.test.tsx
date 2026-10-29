import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InspectionDashboard } from './InspectionDashboard';
import { getInspectionSummary } from './inspection-scenario';

const mode = vi.hoisted(() => ({ value: 'demo' }));
vi.mock('../../shared/api/client', () => ({ get API_MODE() { return mode.value; } }));

function show(permissions = ['appointments.read', 'eligibility.read', 'documents.read']) {
  return render(<MemoryRouter><InspectionDashboard can={permission => permissions.includes(permission)} /></MemoryRouter>);
}

beforeEach(() => { mode.value = 'demo'; });

describe('painel dedicado de inspeções', () => {
  it('mantém a distribuição por área e os indicadores coerentes com os achados abertos', () => {
    const summary = getInspectionSummary();
    expect(summary.byArea.reduce((total, area) => total + area.count, 0)).toBe(summary.openFindings.length);
    expect(summary.openFindings).toHaveLength(5);
    expect(summary.inProgressCount).toBe(2);
    expect(summary.reinspections).toHaveLength(2);
    show();
    expect(screen.queryByText('Cenário ilustrativo de inspeções')).not.toBeInTheDocument();
    expect(screen.getByText('Achados em aberto').closest('article')).toHaveTextContent('5');
    expect(screen.getByRole('figure', { name: 'Achados em aberto por área' })).toHaveTextContent('Manutenção2 achados em aberto');
    expect(screen.getByRole('heading', { name: 'Plano de ação das inspeções' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ver achado: Organização do ponto de coleta' })).not.toBeInTheDocument();
  });

  it('filtra a fila de ações e permite retornar à visão completa', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Alta prioridade' }));
    expect(screen.getByRole('button', { name: 'Alta prioridade' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByRole('button', { name: /^Ver achado:/ })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Ver achado: Identificação de ferramentas' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Todas' }));
    expect(screen.getAllByRole('button', { name: /^Ver achado:/ })).toHaveLength(5);
  });

  it('acompanha um exemplo em memória e restaura o foco ao fechar o detalhe', async () => {
    const user = userEvent.setup();
    show();
    const trigger = screen.getByRole('button', { name: 'Ver achado: Proteção de transmissão' });
    await user.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Proteção de transmissão' });
    expect(dialog).toHaveFocus();
    await user.click(within(dialog).getByRole('button', { name: 'Acompanhar' }));
    expect(within(dialog).getByRole('status')).toHaveTextContent('Achado em acompanhamento.');
    expect(within(dialog).getByRole('button', { name: 'Em acompanhamento' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(screen.getByText('Em acompanhamento')).toBeInTheDocument();
    await user.click(trigger);
    expect(screen.getByRole('button', { name: 'Em acompanhamento' })).toBeDisabled();
  });

  it('separa a conclusão da vistoria das ações e identifica o detalhe como sintético', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Ver reinspeção: Logística' }));
    const dialog = screen.getByRole('dialog', { name: 'Circulação e armazenamento' });
    expect(within(dialog).getByText('Organização do ponto de coleta')).toBeInTheDocument();
    expect(within(dialog).getByText('Concluída')).toBeInTheDocument();
    expect(within(dialog).getByText('Em andamento')).toBeInTheDocument();
    expect(within(dialog).getByText(/Cada achado mantém seu próprio acompanhamento/)).toBeInTheDocument();
  });

  it('omite o cenário e as ações locais no modo API, respeitando as permissões dos destinos', () => {
    mode.value = 'api';
    show(['documents.read']);
    expect(screen.getByRole('heading', { name: 'Sem registros de inspeções' })).toBeInTheDocument();
    expect(screen.queryByText('Achados em aberto')).not.toBeInTheDocument();
    expect(screen.queryByRole('figure')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText('Proteção de transmissão')).not.toBeInTheDocument();
    expect(screen.queryByText('Cenário ilustrativo de inspeções')).not.toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link', { name: /Consultar documentos/ })).toHaveAttribute('href', '/app/documentos');
  });
});

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HealthDashboard } from './HealthDashboard';
import { asoPlanningQueue, asoRenewalWindows, asoReviewQueue, healthScenario, trainingMatrix, trainingPlanningQueue, trainingTopics } from './health-scenario';

const mode = vi.hoisted(() => ({ value: 'demo' }));
vi.mock('../../shared/api/client', () => ({ get API_MODE() { return mode.value; } }));
vi.mock('../../shared/motion/MotionPreferences', () => ({ useAppReducedMotion: () => true }));

function LocationControls() {
  const location = useLocation(), navigate = useNavigate();
  return <><output data-testid="location">{location.search}</output><button onClick={() => navigate(-1)}>Voltar no histórico</button><button onClick={() => navigate(1)}>Avançar no histórico</button></>;
}
function show(path = '/app/dashboard?area=saude', permissions = ['documents.read', 'eligibility.read']) {
  return render(<MemoryRouter initialEntries={[path]}><HealthDashboard can={permission => permissions.includes(permission)} /><LocationControls /></MemoryRouter>);
}

beforeEach(() => { mode.value = 'demo'; });

describe('HealthDashboard', () => {
  it('oferece uma leitura por equipe com tema, quantidade e lacuna explícitos', () => {
    show('/app/dashboard?area=saude&healthView=nrs');
    const teams = within(screen.getByRole('list', { name: 'Capacitações por equipe' }));
    const maintenance = within(teams.getByRole('article', { name: 'Manutenção' }));
    expect(maintenance.getByRole('heading', { name: 'Manutenção' })).toBeInTheDocument();
    const confinedSpace = maintenance.getByText('Espaço confinado').closest('div');
    expect(confinedSpace).toHaveTextContent('4 de 6 arquivos');
    expect(confinedSpace).toHaveTextContent('2 a reunir');
    const height = maintenance.getByText('Trabalho em altura').closest('div');
    expect(height).toHaveTextContent('6 de 6 arquivos');
    expect(height).toHaveTextContent('Arquivos disponíveis');
    expect(teams.getAllByRole('article')).toHaveLength(3);
    expect(teams.getAllByText('Eletricidade')).toHaveLength(3);
  });
  it('separa o acompanhamento administrativo de ASOs da matriz e do planejamento de capacitações', async () => {
    const user = userEvent.setup(); show();
    const asopanel = screen.getByRole('tabpanel', { name: 'Saúde ocupacional · atestados de saúde ocupacional (ASO)' });
    expect(screen.getByRole('heading', { name: 'Atestados de saúde ocupacional (ASO)' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Janelas de renovação' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Fila de conferência documental' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Matriz de evidências por equipe' })).not.toBeInTheDocument();
    expect(screen.queryByText('Cenário demonstrativo · dados sintéticos')).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Capacitações e normas regulamentadoras (NR)' }));
    expect(screen.getByRole('heading', { name: 'Capacitações por equipe' })).toBeInTheDocument();
    expect(screen.getByRole('table')).toHaveAccessibleName(/Arquivos disponíveis e posições previstas por equipe/);
    expect(screen.getByRole('columnheader', { name: 'Trabalho em altura' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Espaço confinado' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Eletricidade' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Planejamento de capacitações' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Janelas de renovação' })).not.toBeInTheDocument();
    expect(asopanel).toHaveAttribute('hidden');
    await user.click(screen.getByRole('tab', { name: 'Saúde ocupacional · atestados de saúde ocupacional (ASO)' }));
    expect(screen.getByRole('tabpanel', { name: 'Saúde ocupacional · atestados de saúde ocupacional (ASO)' })).toBe(asopanel);
  });

  it('mantém área e filtros na URL, navega por teclado e restaura a seleção com voltar e avançar', async () => {
    const user = userEvent.setup(); show('/app/dashboard?area=saude&unitId=exemplo&keep=1');
    const asos = screen.getByRole('tab', { name: 'Saúde ocupacional · atestados de saúde ocupacional (ASO)' }), nrs = screen.getByRole('tab', { name: 'Capacitações e normas regulamentadoras (NR)' });
    asos.focus(); await user.keyboard('{ArrowRight}');
    expect(nrs).toHaveFocus(); expect(nrs).toHaveAttribute('aria-selected', 'true'); expect(asos).toHaveAttribute('tabindex', '-1');
    const selectedParams = new URLSearchParams(screen.getByTestId('location').textContent ?? '');
    expect(Object.fromEntries(selectedParams)).toEqual({ area: 'saude', unitId: 'exemplo', keep: '1', healthView: 'nrs' });
    await user.keyboard('{Home}'); expect(asos).toHaveFocus(); expect(asos).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{End}'); expect(nrs).toHaveFocus(); expect(nrs).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowRight}'); expect(asos).toHaveFocus();
    await user.click(nrs);
    await user.click(screen.getByRole('button', { name: 'Voltar no histórico' }));
    expect(asos).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('button', { name: 'Avançar no histórico' }));
    expect(nrs).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('location')).toHaveTextContent('keep=1');
  });

  it('lê links diretos e usa ASOs como fallback para valor inválido', () => {
    const direct = show('/app/dashboard?area=saude&healthView=nrs');
    expect(screen.getByRole('tab', { name: 'Capacitações e normas regulamentadoras (NR)' })).toHaveAttribute('aria-selected', 'true');
    direct.unmount(); show('/app/dashboard?area=saude&healthView=desconhecido');
    expect(screen.getByRole('tab', { name: 'Saúde ocupacional · atestados de saúde ocupacional (ASO)' })).toHaveAttribute('aria-selected', 'true');
  });

  it('permite acompanhar e desfazer o acompanhamento de um exemplo sem concluir sua conferência', async () => {
    const user = userEvent.setup(); show();
    const opener = screen.getByRole('button', { name: 'Ver detalhe: Conferir identificação do documento' });
    await user.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Conferir identificação do documento' });
    expect(dialog).toHaveFocus();
    expect(within(dialog).getByText('Produção')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Acompanhar' }));
    expect(within(dialog).getByRole('status')).toHaveTextContent('Em acompanhamento');
    expect(within(dialog).getByText('A conferir')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Fechar detalhe' }));
    expect(opener).toHaveFocus();
    expect(screen.getByText('1 em acompanhamento')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Capacitações e normas regulamentadoras (NR)' }));
    await user.click(screen.getByRole('button', { name: 'Ver detalhe: Planejar orientação da manutenção' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Acompanhar' }));
    await user.keyboard('{Escape}');
    expect(screen.getByText('2 em acompanhamento')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Saúde ocupacional · atestados de saúde ocupacional (ASO)' }));
    await user.click(opener);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Retirar acompanhamento' }));
    expect(within(screen.getByRole('dialog')).getByRole('status')).toHaveTextContent('Acompanhamento pendente.');
    await user.keyboard('{Escape}');
    expect(screen.getByText('1 em acompanhamento')).toBeInTheDocument();
  });

  it('restringe consultas pelas permissões e usa filtros suportados pelas páginas existentes', async () => {
    const user = userEvent.setup();
    const restricted = show('/app/dashboard?area=saude', []);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    restricted.unmount();
    show('/app/dashboard?area=saude', ['documents.read']);
    expect(screen.getByRole('link', { name: 'Buscar documentos de ASO' })).toHaveAttribute('href', '/app/documentos?q=ASO');
    expect(screen.getByRole('link', { name: 'Consultar vencimentos de ASOs' })).toHaveAttribute('href', '/app/vencimentos?q=ASO');
    expect(screen.queryByRole('link', { name: 'Conferir requisitos documentais' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Capacitações e normas regulamentadoras (NR)' }));
    expect(screen.getByRole('link', { name: 'Buscar comprovantes de treinamento' })).toHaveAttribute('href', '/app/documentos?q=treinamento');
  });

  it('não apresenta indicadores sintéticos, filas ou ações locais no modo API', async () => {
    mode.value = 'api'; const user = userEvent.setup(); show('/app/dashboard?area=saude', ['eligibility.read']);
    expect(screen.getByRole('heading', { name: 'Sem dados de ASOs' })).toBeInTheDocument();
    expect(screen.queryByText(/dados sintéticos/)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'ASOs a renovar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ver detalhe/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Buscar documentos de ASO' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Conferir requisitos documentais' })).toHaveAttribute('href', '/app/pendencias');
    await user.click(screen.getByRole('tab', { name: 'Capacitações e normas regulamentadoras (NR)' }));
    expect(screen.getByRole('heading', { name: 'Sem dados de capacitações' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Capacitações por equipe' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Comprovantes disponíveis' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Acompanhar|Ver detalhe/ })).not.toBeInTheDocument();
  });
});

describe('coerência do cenário de saúde', () => {
  it('mantém contagens coerentes entre os indicadores, as janelas e a matriz de equipes fictícias', () => {
    expect(healthScenario.asoRenewals).toBe(asoRenewalWindows.reduce((sum, item) => sum + item.count, 0));
    expect(healthScenario.asoReviews).toBe(asoReviewQueue.reduce((sum, item) => sum + item.quantity, 0));
    expect(healthScenario.examsToOrganize).toBe(asoPlanningQueue[0].quantity);
    expect(healthScenario.appointmentsToConfirm).toBe(asoPlanningQueue[1].quantity);
    expect(healthScenario.trainingEvidence).toBe(32);
    expect(healthScenario.trainingExpected).toBe(39);
    expect(healthScenario.trainingExpected - healthScenario.trainingEvidence).toBe(7);
    expect(healthScenario.trainingGroups).toBe(trainingPlanningQueue.length);
    trainingMatrix.forEach(row => { expect(row.evidence).toHaveLength(trainingTopics.length); row.evidence.forEach(value => expect(value).toBeLessThanOrEqual(row.people)); });
  });
});

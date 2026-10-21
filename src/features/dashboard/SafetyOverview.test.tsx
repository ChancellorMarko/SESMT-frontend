import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SafetyOverview, getSafetyArea } from './SafetyOverview';

const mode = vi.hoisted(() => ({ value: 'demo' }));
vi.mock('../../shared/api/client', () => ({ get API_MODE() { return mode.value; } }));

function Location() { return <output data-testid="location">{useLocation().search}</output>; }
function show(query = '', documents = true) {
  render(<MemoryRouter initialEntries={[`/app/dashboard${query}`]}><SafetyOverview canReadDocuments={documents} /><Location /></MemoryRouter>);
}
beforeEach(() => { mode.value = 'demo'; });

describe('cenário visual de segurança', () => {
  it('identifica os números como ilustração e acompanha um exemplo somente em memória', () => {
    show();
    expect(screen.getByText('Cenário ilustrativo de SST')).toBeInTheDocument();
    expect(screen.getByText('Números sintéticos para explorar a interface')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '92');
    fireEvent.click(screen.getByRole('button', { name: 'Ver detalhes: Proteção de máquina a conferir' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Nenhum registro real, autorização ou condição de aptidão será alterado/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Acompanhar exemplo' }));
    expect(within(dialog).getByRole('status')).toHaveTextContent('Exemplo marcado para acompanhamento');
    expect(within(dialog).getByRole('button', { name: 'Em acompanhamento no exemplo' })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Fechar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Em acompanhamento · exemplo')).toBeInTheDocument();
  });

  it('filtra a área pela URL, preserva outros parâmetros e mantém a operação separada', () => {
    show('?area=epis&keep=1');
    expect(screen.getByRole('heading', { name: 'EPIs' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver detalhes: Conferência de entrega de EPIs' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ver detalhes: Proteção de máquina a conferir' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Inspeções' }));
    expect(screen.getByTestId('location')).toHaveTextContent('?area=inspecoes&keep=1');
    expect(screen.getByRole('button', { name: 'Inspeções' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Ver detalhes: Proteção de máquina a conferir' })).toBeInTheDocument();
    expect(screen.getByText(/Os exemplos acima não refletem a unidade selecionada/)).toBeInTheDocument();
  });

  it('não apresenta valores sintéticos, prioridades ou progresso como dados reais no modo API', () => {
    mode.value = 'api';
    show('?area=saude', false);
    expect(screen.getAllByText('Não conectado')).toHaveLength(4);
    expect(screen.getByRole('heading', { name: 'Módulo ainda não conectado' })).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByText('128')).not.toBeInTheDocument();
    expect(screen.queryByText('92%')).not.toBeInTheDocument();
    expect(screen.queryByText('Prioridade alta')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Consultar documentos/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sobre o indicador: Dias sem acidentes' }));
    expect(within(screen.getByRole('dialog')).getByText('Integração pendente')).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByText(/não equivale a zero ocorrências nem a uma situação segura/)).toBeInTheDocument();
  });

  it('mantém acesso aos documentos no estado sem conexão apenas quando permitido', () => {
    mode.value = 'api'; show();
    expect(screen.getByRole('link', { name: 'Consultar documentos' })).toHaveAttribute('href', '/app/documentos');
  });

  it.each([null, '', 'qualquer', 'relatorios'])('normaliza uma área desconhecida para visão geral: %s', value => {
    expect(getSafetyArea(value)).toBe('');
  });
});


import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { EligibilityItemDto, ParticipantEligibilityDto } from '../../shared/contracts/work-permits';
import { formatDate } from '../../shared/lib/format';
import { ReadinessAppointment, type ReadinessAppointmentProps } from './ReadinessAppointment';
import type { ReadinessGroup } from './readiness';

function requirement(overrides: Partial<EligibilityItemDto> = {}): EligibilityItemDto {
  return { requirementId: 'requirement', label: 'Orientação operacional', description: 'Descrição administrativa', status: 'PENDING', restricted: false, ...overrides };
}

function person(overrides: Partial<ParticipantEligibilityDto> = {}): ParticipantEligibilityDto {
  return { workerId: 'worker', name: 'Ana Teste', serviceFunction: 'Executante', eligible: false, items: [requirement()], ...overrides };
}

function group(people = [person()]): ReadinessGroup {
  return {
    row: {
      appointmentId: 'appointment:1', appointmentCode: 'AG-TESTE', teamId: 'team', teamName: 'Equipe de manutenção',
      serviceTypeId: 'service', serviceLabel: 'Manutenção em altura', location: 'Unidade de demonstração',
      startsAt: '2026-10-20T09:00:00-03:00', endsAt: '2026-10-20T10:00:00-03:00', permitId: 'permit:1',
      eligibility: { appointmentId: 'appointment:1', eligible: false, requirementVersion: 'MATRIZ-1', checkedAt: '2026-10-19T14:00:00-03:00', participants: people },
    },
    people,
  };
}

function Location() {
  const location = useLocation();
  return <><output aria-label="Destino">{location.pathname}</output><output aria-label="Origem preservada">{JSON.stringify(location.state)}</output></>;
}

function show(overrides: Partial<ReadinessAppointmentProps> = {}) {
  const props: ReadinessAppointmentProps = {
    group: group(), canReadAppointments: true, canManageEligibility: true, canReadPermits: true,
    renderIntegrationLink: vi.fn(() => null), ...overrides,
  };
  return { props, ...render(<MemoryRouter initialEntries={['/app/pendencias?status=all']}><ReadinessAppointment {...props} /><Location /></MemoryRouter>) };
}

describe('resumo do atendimento na central documental', () => {
  it('limita o requisito restrito a nome, situação e orientação de acesso', () => {
    const restricted = requirement({ requirementId: 'clinical', label: 'Conferência clínica', restricted: true, status: 'EXPIRED',
      description: 'Descrição clínica confidencial', reason: 'Razão clínica confidencial', fileName: 'laudo-confidencial.pdf',
      validFrom: '2037-02-03T00:00:00-03:00', validUntil: '2038-04-05T00:00:00-03:00',
    });
    const { container } = show({ group: group([person({ items: [restricted] })]) });
    expect(screen.getByText('Conferência clínica')).toBeVisible();
    expect(screen.getByText('Vencido')).toBeVisible();
    expect(screen.getByText('Conferência restrita por profissional autorizado.')).toBeVisible();
    for (const hidden of [restricted.description, restricted.reason!, restricted.fileName!, restricted.validFrom!, restricted.validUntil!, formatDate(restricted.validFrom!), formatDate(restricted.validUntil!)]) {
      expect(container).not.toHaveTextContent(hidden);
    }
    expect(container.innerHTML).not.toMatch(/2037|2038|confidencial/);
  });

  it('mostra a observação administrativa do item comum sem ampliar a exposição de evidências', () => {
    const { container } = show({ group: group([person({ items: [requirement({ reason: 'Aguardando conferência da orientação.', fileName: 'evidencia-interna.pdf', validUntil: '2036-01-01' })] })]) });
    expect(screen.getByText('Aguardando conferência da orientação.')).toBeVisible();
    expect(container).not.toHaveTextContent('Descrição administrativa');
    expect(container).not.toHaveTextContent('evidencia-interna.pdf');
    expect(container).not.toHaveTextContent('2036');
  });

  it('preserva a elegibilidade recebida mesmo quando o requisito visível está ausente', () => {
    show({ group: group([person({ eligible: true, items: [requirement({ status: 'MISSING' })] })]) });
    expect(screen.getByText('Documentação conferida')).toBeVisible();
    expect(screen.getByText('Ausente')).toBeVisible();
    expect(screen.queryByText('Pendência documental')).not.toBeInTheDocument();
  });

  it('mantém a pendência informada pela API mesmo com todos os itens visíveis aprovados', () => {
    show({ group: group([person({ eligible: false, items: [requirement({ status: 'APPROVED' })] })]) });
    expect(screen.getByText('Pendência documental')).toBeVisible();
    expect(screen.getByText('Conferido')).toBeVisible();
    expect(screen.queryByText('Documentação conferida')).not.toBeInTheDocument();
  });

  it('identifica serviço, pessoa e atendimento e mantém o contexto do período', () => {
    const data = group();
    show({ group: data });
    const section = screen.getByRole('region', { name: 'Pendências de AG-TESTE' });
    expect(within(section).getByRole('heading', { level: 2, name: 'Manutenção em altura' })).toBeVisible();
    expect(within(section).getByRole('heading', { level: 3, name: 'Ana Teste' })).toBeVisible();
    expect(within(section).getByText('Equipe de manutenção')).toBeVisible();
    expect(within(section).getByText('Unidade de demonstração')).toBeVisible();
    expect(within(section).getByText(/Horários de Brasília/)).toBeVisible();
    expect(within(section).getByText(formatDate(data.row.startsAt))).toHaveAttribute('dateTime', data.row.startsAt);
    expect(within(section).getByText(/Matriz MATRIZ-1/)).toBeVisible();
  });

  it.each([false, true])('oculta o atendimento sem permissão de leitura, mesmo com gestão=%s', canManageEligibility => {
    show({ canReadAppointments: false, canManageEligibility, canReadPermits: false });
    expect(screen.queryByRole('link', { name: /Abrir conferência|Consultar atendimento/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Acompanhar PT' })).not.toBeInTheDocument();
  });

  it('oferece consulta somente para leitura e aplica a permissão independente da PT', () => {
    show({ canManageEligibility: false, canReadPermits: true });
    expect(screen.getByRole('link', { name: 'Consultar atendimento de AG-TESTE' })).toHaveAttribute('href', '/app/agenda/appointment%3A1');
    expect(screen.queryByRole('link', { name: /Abrir conferência/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Acompanhar PT' })).toHaveAttribute('href', '/app/pts/permit%3A1');
  });

  it('preserva o estado da consulta ao abrir a conferência correta', async () => {
    const user = userEvent.setup();
    const appointmentState = { fromReadiness: '/app/pendencias?unitId=unit-a&status=all&q=Ana', marker: 'consulta-original' };
    show({ appointmentState });
    await user.click(screen.getByRole('link', { name: 'Abrir conferência de AG-TESTE' }));
    expect(screen.getByLabelText('Destino')).toHaveTextContent('/app/agenda/appointment%3A1');
    expect(JSON.parse(screen.getByLabelText('Origem preservada').textContent!)).toEqual(appointmentState);
  });

  it('não cria link para PT inexistente mesmo com permissão', () => {
    const data = group();
    delete data.row.permitId;
    show({ group: data, canReadPermits: true });
    expect(screen.queryByRole('link', { name: 'Acompanhar PT' })).not.toBeInTheDocument();
  });

  it('mantém o alerta de matriz vazia sem inferir liberação', () => {
    show({ group: group([person({ items: [] })]) });
    expect(within(screen.getByRole('region', { name: 'Pendências de AG-TESTE' })).getByRole('status')).toHaveTextContent('A matriz não definiu requisitos aplicáveis. Confira a configuração antes de liberar.');
    expect(screen.getByText('Pendência documental')).toBeVisible();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it.each([
    { source: 'WORKER_INTEGRATION' as const, requirementId: 'worker-integration' },
    { requirementId: 'integration:worker' },
  ])('oferece regularização da integração não restrita com fonte $requirementId', source => {
    const participant = person({ items: [requirement(source)] });
    const renderIntegrationLink = vi.fn((value: ParticipantEligibilityDto) => <a href={`/app/trabalhadores/${value.workerId}#integracao`}>Consultar integração de {value.name}</a>);
    show({ group: group([participant]), renderIntegrationLink });
    expect(renderIntegrationLink).toHaveBeenCalledExactlyOnceWith(participant);
    expect(screen.getByRole('link', { name: 'Consultar integração de Ana Teste' })).toHaveAttribute('href', '/app/trabalhadores/worker#integracao');
  });

  it('não solicita link de integração para item restrito ou para requisitos comuns', () => {
    const renderIntegrationLink = vi.fn(() => <a href="/nao-expor">Integração indevida</a>);
    show({ group: group([person({ items: [requirement(), requirement({ requirementId: 'integration:worker', source: 'WORKER_INTEGRATION', restricted: true })] })]), renderIntegrationLink });
    expect(renderIntegrationLink).not.toHaveBeenCalled();
    expect(screen.queryByRole('link', { name: 'Integração indevida' })).not.toBeInTheDocument();
  });
});

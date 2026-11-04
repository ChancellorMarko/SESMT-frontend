import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { NotificationDto } from '../../shared/contracts';
import { formatDate } from '../../shared/lib/format';
import { NotificationCard, type NotificationCardProps } from './NotificationCard';

const notice: NotificationDto = {
  id: 'notice-document',
  type: 'DOCUMENT_DUE',
  title: 'Documento próximo do vencimento',
  summary: 'Conferir os dados do registro antes da próxima atividade.',
  resourceType: 'DOCUMENT',
  resourceId: 'document',
  dueDate: '2026-10-20',
  createdAt: '2026-10-11T12:00:00Z',
};

function Destination() {
  const location = useLocation();
  return <output aria-label="Destino aberto">{JSON.stringify({ pathname: location.pathname, state: location.state })}</output>;
}

function show(overrides: Partial<NotificationCardProps> = {}) {
  const onMarkRead = vi.fn();
  render(<MemoryRouter initialEntries={['/app/notificacoes']}><NotificationCard item={notice} busy={false} refreshing={false} saving={false} onMarkRead={onMarkRead} {...overrides} /><Destination /></MemoryRouter>);
  return { onMarkRead };
}

describe('cartão de notificação', () => {
  it('apresenta o aviso não lido e registra a ação sem tratar leitura como resolução', () => {
    const { onMarkRead } = show();
    const article = screen.getByRole('article', { name: notice.title });
    expect(within(article).getByRole('heading', { level: 2, name: notice.title })).toBeInTheDocument();
    expect(within(article).getByText(notice.summary)).toBeInTheDocument();
    expect(within(article).getByText('Não lida')).toBeInTheDocument();
    expect(within(article).getByText(formatDate(notice.createdAt))).toBeInTheDocument();
    expect(within(article).getByText(formatDate(notice.dueDate))).toBeInTheDocument();
    fireEvent.click(within(article).getByRole('button', { name: `Marcar como lida: ${notice.title}` }));
    expect(onMarkRead).toHaveBeenCalledOnce();
    expect(screen.queryByText(/resolvida|regularizada|conforme/i)).not.toBeInTheDocument();
  });

  it('apresenta a leitura recebida e omite o botão de alteração', () => {
    const readAt = '2026-10-12T14:30:00Z';
    show({ item: { ...notice, readAt } });
    expect(screen.getByText('Lida')).toBeInTheDocument();
    expect(screen.getByText('Leitura registrada:')).toBeInTheDocument();
    expect(screen.getByText(formatDate(readAt))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Marcar como lida/ })).not.toBeInTheDocument();
  });

  it.each(['busy', 'refreshing', 'saving'] as const)('bloqueia a leitura durante %s', flag => {
    const { onMarkRead } = show({ [flag]: true });
    const button = screen.getByRole('button', { name: `Marcar como lida: ${notice.title}` });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onMarkRead).not.toHaveBeenCalled();
    expect(button).toHaveTextContent(flag === 'saving' ? 'Registrando leitura…' : 'Marcar como lida');
  });

  it('usa o destino e o estado de retorno fornecidos pela página', () => {
    const linkState = { notificationReturnTo: { unitId: 'unit', search: '?unitId=unit&read=false&page=2' } };
    show({ href: '/app/documentos/document', linkState });
    const link = screen.getByRole('link', { name: 'Abrir registro →' });
    expect(link).toHaveAttribute('href', '/app/documentos/document');
    fireEvent.click(link);
    expect(JSON.parse(screen.getByLabelText('Destino aberto').textContent!)).toEqual({ pathname: '/app/documentos/document', state: linkState });
  });

  it('não cria um destino quando a página não autoriza o link', () => {
    show();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('preserva texto extenso e não inventa prazo ou prioridade para um recurso desconhecido', () => {
    const title = `Aviso ${'CODIGO'.repeat(80)}`;
    const summary = `Contexto recebido ${'PROTOCOLO'.repeat(120)}\nSegunda linha mantida.`;
    show({ item: { ...notice, title, summary, resourceType: 'OTHER', dueDate: undefined } });
    expect(screen.getByRole('article', { name: title })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: title })).toHaveTextContent(title);
    expect(screen.getByText(/^Contexto recebido/).textContent).toBe(summary);
    expect(screen.queryByText('Prazo:')).not.toBeInTheDocument();
    expect(screen.queryByText(/crítico|urgente|prioridade|atrasado/i)).not.toBeInTheDocument();
  });
});

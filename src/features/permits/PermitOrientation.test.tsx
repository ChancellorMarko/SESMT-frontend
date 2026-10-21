import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { PermitOrientation, type PermitSection } from './PermitOrientation';
import type { PermitGuidance } from './permit-guidance';

const sections: PermitSection[] = [
  { id: 'preparacao', label: 'Preparação' },
  { id: 'conferencia', label: 'Checklist' },
  { id: 'designacao', label: 'Designação' },
  { id: 'historico', label: 'Histórico' },
];
const guidance: PermitGuidance = {
  title: 'Confira o rascunho antes de continuar',
  description: 'Há alterações locais ainda não enviadas.',
  target: 'preparacao',
  linkLabel: 'Ver preparação',
};

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="Localização da PT">{JSON.stringify(location)}</output>;
}

function Harness({ initialHash = '', legacy = false, noCoverageHeading = false, missingSection = false }: {
  initialHash?: string; legacy?: boolean; noCoverageHeading?: boolean; missingSection?: boolean;
}) {
  const [draft, setDraft] = useState('Rascunho ainda não enviado');
  return <MemoryRouter initialEntries={[{
    pathname: '/app/pts/PT-DEMO-001', search: '?origem=agenda', hash: '#origem-preservada',
    state: { permitAgendaReturnTo: { search: '?data=2026-10-20', appointmentId: 'AG-DEMO-221' } },
  }]}>
    <input aria-label="Campo inicial" autoFocus />
    <PermitOrientation guidance={guidance} sections={sections} initialHash={initialHash} />
    <LocationProbe />
    <details open aria-label="Versão anterior">
      <summary>Versão 1 preservada</summary>
      <section><h2>Preparação da PT</h2><textarea aria-label="Preparação preservada" readOnly value="Conteúdo da versão anterior" /></section>
    </details>
    {!missingSection && <div id="preparacao"><section aria-label="Preparação atual">
      <h2>Preparação da PT</h2>
      {legacy ? <p>Esta PT não contém preparação estruturada da planilha recebida.</p>
        : <textarea aria-label="Atividade atual" value={draft} onChange={event => setDraft(event.target.value)} />}
    </section></div>}
    <section id="conferencia"><h2>Conferência do atendimento</h2></section>
    <div id="designacao" aria-label="Designação operacional">
      {noCoverageHeading ? <p>Não foi possível verificar a cobertura.</p> : <h2>Cobertura por designações operacionais</h2>}
    </div>
    <section id="historico"><h2>Histórico do atendimento</h2></section>
  </MemoryRouter>;
}

const index = () => screen.getByText('Ir para uma seção da PT').closest('details')!;
async function openIndex(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByText('Ir para uma seção da PT'));
  return screen.getByRole('navigation', { name: 'Seções da PT' });
}

describe('orientação e navegação nas seções da PT', () => {
  it('foca a preparação atual, preservando rascunho, hash e estado de retorno da Agenda', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const draft = screen.getByRole('textbox', { name: 'Atividade atual' });
    await user.type(draft, ' com observações locais');
    const savedLocation = screen.getByLabelText('Localização da PT').textContent;
    const browserUrl = window.location.href;
    await user.click(screen.getByRole('link', { name: 'Ver preparação' }));
    const currentHeading = within(screen.getByRole('region', { name: 'Preparação atual' })).getByRole('heading', { level: 2 });
    const previousHeading = within(screen.getByLabelText('Versão anterior')).getByRole('heading', { level: 2 });
    expect(currentHeading).toHaveFocus();
    expect(currentHeading).toHaveAttribute('tabindex', '-1');
    expect(previousHeading).not.toHaveAttribute('tabindex');
    expect(draft).toHaveValue('Rascunho ainda não enviado com observações locais');
    expect(screen.getByLabelText('Localização da PT').textContent).toBe(savedLocation);
    expect(window.location.href).toBe(browserUrl);
    expect(screen.getByRole('textbox', { name: 'Preparação preservada' })).toHaveValue('Conteúdo da versão anterior');
  });

  it('mantém o índice recolhido e permite abrir suas seções', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(index()).not.toHaveAttribute('open');
    const navigation = await openIndex(user);
    expect(index()).toHaveAttribute('open');
    expect(within(navigation).getAllByRole('link')).toHaveLength(4);
    await user.click(screen.getByText('Ir para uma seção da PT'));
    expect(index()).not.toHaveAttribute('open');
  });

  it('marca somente o último destino acessado como localização atual', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const navigation = await openIndex(user);
    expect(within(navigation).getAllByRole('link').some(link => link.hasAttribute('aria-current'))).toBe(false);
    await user.click(within(navigation).getByRole('link', { name: 'Checklist' }));
    expect(screen.getByRole('heading', { name: 'Conferência do atendimento' })).toHaveFocus();
    expect(within(navigation).getByRole('link', { name: 'Checklist' })).toHaveAttribute('aria-current', 'location');
    await user.click(within(navigation).getByRole('link', { name: 'Histórico' }));
    expect(screen.getByRole('heading', { name: 'Histórico do atendimento' })).toHaveFocus();
    expect(within(navigation).getByRole('link', { name: 'Histórico' })).toHaveAttribute('aria-current', 'location');
    expect(within(navigation).getByRole('link', { name: 'Checklist' })).not.toHaveAttribute('aria-current');
    expect(within(navigation).getAllByRole('link').filter(link => link.hasAttribute('aria-current'))).toHaveLength(1);
  });

  it('permite ativar o salto por teclado sem criar navegação no router', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const before = screen.getByLabelText('Localização da PT').textContent;
    screen.getByRole('link', { name: 'Ver preparação' }).focus();
    await user.keyboard('{Enter}');
    expect(within(screen.getByRole('region', { name: 'Preparação atual' })).getByRole('heading')).toHaveFocus();
    expect(screen.getByLabelText('Localização da PT').textContent).toBe(before);
  });

  it.each([
    ['Ctrl', { ctrlKey: true }], ['Meta', { metaKey: true }],
    ['Shift', { shiftKey: true }], ['Alt', { altKey: true }],
    ['botão secundário', { button: 1 }],
  ])('preserva o comportamento nativo de link com %s', (_label, options) => {
    render(<Harness />);
    const link = screen.getByRole('link', { name: 'Ver preparação' });
    const originalFocus = screen.getByRole('textbox', { name: 'Campo inicial' });
    let preventedByComponent: boolean | undefined;
    // Observe the event after React, then prevent only JSDOM's deferred navigation.
    const observe = (event: MouseEvent) => {
      if (event.target !== link) return;
      preventedByComponent = event.defaultPrevented;
      event.preventDefault();
    };
    document.addEventListener('click', observe);
    try { fireEvent.click(link, options); }
    finally { document.removeEventListener('click', observe); }
    expect(preventedByComponent).toBe(false);
    expect(originalFocus).toHaveFocus();
    expect(document.getElementById('preparacao')!.querySelector('h2')).not.toHaveAttribute('tabindex');
  });

  it('mantém a preparação legada como destino consultável', async () => {
    const user = userEvent.setup();
    render(<Harness legacy />);
    await user.click(screen.getByRole('link', { name: 'Ver preparação' }));
    const current = screen.getByRole('region', { name: 'Preparação atual' });
    expect(within(current).getByRole('heading', { name: 'Preparação da PT' })).toHaveFocus();
    expect(current).toHaveTextContent('Esta PT não contém preparação estruturada');
  });

  it('aplica o hash inicial válido e identifica a seção alcançada no índice', async () => {
    const user = userEvent.setup();
    render(<Harness initialHash="#conferencia" />);
    expect(screen.getByRole('heading', { name: 'Conferência do atendimento' })).toHaveFocus();
    const navigation = await openIndex(user);
    expect(within(navigation).getByRole('link', { name: 'Checklist' })).toHaveAttribute('aria-current', 'location');
  });

  it.each(['#inexistente', '#%63onferencia', '#conferencia?extra=1'])('não desvia o foco por um hash inicial não listado: %s', hash => {
    render(<Harness initialHash={hash} />);
    expect(screen.getByRole('textbox', { name: 'Campo inicial' })).toHaveFocus();
    expect(screen.getByRole('heading', { name: 'Conferência do atendimento' })).not.toHaveAttribute('tabindex');
  });

  it('foca o wrapper da designação quando seu conteúdo ainda não possui heading', async () => {
    const user = userEvent.setup();
    render(<Harness noCoverageHeading />);
    const navigation = await openIndex(user);
    await user.click(within(navigation).getByRole('link', { name: 'Designação' }));
    expect(screen.getByLabelText('Designação operacional')).toHaveFocus();
    expect(screen.getByLabelText('Designação operacional')).toHaveAttribute('tabindex', '-1');
    expect(within(navigation).getByRole('link', { name: 'Designação' })).toHaveAttribute('aria-current', 'location');
  });

  it('não declara alcançado um destino ausente no conteúdo', () => {
    render(<Harness initialHash="#preparacao" missingSection />);
    expect(screen.getByRole('textbox', { name: 'Campo inicial' })).toHaveFocus();
    expect(index().querySelector('[aria-current]')).toBeNull();
  });
});

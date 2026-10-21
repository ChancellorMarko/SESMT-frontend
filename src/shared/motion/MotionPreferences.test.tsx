import { act, fireEvent, render, screen } from '@testing-library/react';
import { useContext, useState } from 'react';
import { MotionConfigContext } from 'framer-motion';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MOTION_PREFERENCE_KEY, MotionPreferencesContent, MotionProvider, useAppReducedMotion } from './MotionPreferences';

let deviceReduced = false;
const listeners = new Set<() => void>();
function setDeviceReduced(value: boolean) {
  act(() => { deviceReduced = value; for (const listener of listeners) listener(); });
}
function Probe() {
  const reduced = useAppReducedMotion();
  const config = useContext(MotionConfigContext);
  const [draft, setDraft] = useState('');
  return <><span data-testid="resolved">{reduced ? 'reduced' : 'full'}</span><span data-testid="framer">{config.reducedMotion}</span><label>Rascunho<input value={draft} onChange={event => setDraft(event.target.value)} /></label></>;
}
function show() { return render(<MotionProvider><MotionPreferencesContent /><Probe /></MotionProvider>); }

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-motion');
  document.documentElement.removeAttribute('data-motion-preference');
  listeners.clear(); deviceReduced = false;
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: deviceReduced, media: query, onchange: null,
    addEventListener: (_event: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_event: string, listener: () => void) => listeners.delete(listener),
    addListener: (listener: () => void) => listeners.add(listener), removeListener: (listener: () => void) => listeners.delete(listener),
    dispatchEvent: () => true,
  })));
});

describe('preferências de animação da interface', () => {
  it('segue o dispositivo por padrão e alinha CSS, hook e Framer quando ele reduz movimento', () => {
    deviceReduced = true; show();
    expect(screen.getByRole('radio', { name: /^Seguir dispositivo/ })).toBeChecked();
    expect(document.documentElement).toHaveAttribute('data-motion', 'reduced');
    expect(document.documentElement).toHaveAttribute('data-motion-preference', 'system');
    expect(screen.getByTestId('resolved')).toHaveTextContent('reduced');
    expect(screen.getByTestId('framer')).toHaveTextContent('always');
    expect(screen.getByRole('status')).toHaveTextContent('O dispositivo está solicitando movimento reduzido');
  });

  it('ativa animações completas com opção explícita mesmo quando o dispositivo reduz movimento', () => {
    deviceReduced = true; show();
    const input = screen.getByLabelText('Rascunho');
    fireEvent.change(input, { target: { value: 'Valor que deve permanecer' } });
    fireEvent.click(screen.getByRole('radio', { name: /^Completas/ }));
    expect(document.documentElement).toHaveAttribute('data-motion', 'full');
    expect(document.documentElement).toHaveAttribute('data-motion-preference', 'full');
    expect(screen.getByTestId('resolved')).toHaveTextContent('full');
    expect(screen.getByTestId('framer')).toHaveTextContent('never');
    expect(localStorage.getItem(MOTION_PREFERENCE_KEY)).toBe('full');
    expect(screen.getByLabelText('Rascunho')).toBe(input);
    expect(input).toHaveValue('Valor que deve permanecer');
  });

  it('permite reduzir animações em um dispositivo que normalmente as permite', () => {
    show(); fireEvent.click(screen.getByRole('radio', { name: /^Reduzidas/ }));
    expect(document.documentElement).toHaveAttribute('data-motion', 'reduced');
    expect(screen.getByTestId('resolved')).toHaveTextContent('reduced');
    expect(screen.getByTestId('framer')).toHaveTextContent('always');
    expect(localStorage.getItem(MOTION_PREFERENCE_KEY)).toBe('reduced');
  });

  it('acompanha alterações do dispositivo apenas no modo automático', () => {
    show(); expect(screen.getByTestId('resolved')).toHaveTextContent('full');
    setDeviceReduced(true);
    expect(screen.getByTestId('resolved')).toHaveTextContent('reduced');
    expect(document.documentElement).toHaveAttribute('data-motion', 'reduced');
    fireEvent.click(screen.getByRole('radio', { name: /^Completas/ }));
    setDeviceReduced(false); setDeviceReduced(true);
    expect(screen.getByTestId('resolved')).toHaveTextContent('full');
    fireEvent.click(screen.getByRole('radio', { name: /^Seguir dispositivo/ }));
    expect(screen.getByTestId('resolved')).toHaveTextContent('reduced');
  });

  it('restaura a preferência salva e desfaz apenas os atributos que aplicou ao desmontar', () => {
    localStorage.setItem(MOTION_PREFERENCE_KEY, 'full'); deviceReduced = true;
    document.documentElement.dataset.motion = 'reduced';
    const view = show();
    expect(screen.getByRole('radio', { name: /^Completas/ })).toBeChecked();
    expect(screen.getByTestId('resolved')).toHaveTextContent('full');
    view.unmount();
    expect(document.documentElement).toHaveAttribute('data-motion', 'reduced');
    expect(document.documentElement).not.toHaveAttribute('data-motion-preference');
    expect(listeners.size).toBe(0);
  });

  it('trata uma preferência inválida como automática', () => {
    localStorage.setItem(MOTION_PREFERENCE_KEY, 'unexpected-value'); deviceReduced = true;
    show();
    expect(screen.getByRole('radio', { name: /^Seguir dispositivo/ })).toBeChecked();
    expect(screen.getByTestId('resolved')).toHaveTextContent('reduced');
  });

  it('continua funcionando quando o navegador bloqueia a leitura e gravação da preferência', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError'); });
    deviceReduced = true; show();
    fireEvent.click(screen.getByRole('radio', { name: /^Completas/ }));
    expect(screen.getByTestId('resolved')).toHaveTextContent('full');
    expect(document.documentElement).toHaveAttribute('data-motion', 'full');
    expect(screen.getByRole('status')).toHaveTextContent('Animações completas neste navegador.');
  });

  it('sincroniza alterações de outra aba sem recriar os campos da tela', () => {
    show(); const input = screen.getByLabelText('Rascunho');
    fireEvent.change(input, { target: { value: 'Em edição' } });
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: MOTION_PREFERENCE_KEY, newValue: 'reduced' })));
    expect(screen.getByTestId('resolved')).toHaveTextContent('reduced');
    expect(screen.getByLabelText('Rascunho')).toBe(input);
    expect(input).toHaveValue('Em edição');
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: MOTION_PREFERENCE_KEY, newValue: 'invalid' })));
    expect(screen.getByRole('radio', { name: /^Seguir dispositivo/ })).toBeChecked();
    expect(screen.getByTestId('resolved')).toHaveTextContent('full');
  });

  it('mantém o padrão do dispositivo em componentes usados fora do provider', () => {
    deviceReduced = true; render(<Probe />);
    expect(screen.getByTestId('resolved')).toHaveTextContent('reduced');
    setDeviceReduced(false);
    expect(screen.getByTestId('resolved')).toHaveTextContent('full');
  });
});

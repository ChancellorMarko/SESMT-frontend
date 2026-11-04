import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SignaturePad } from './SignaturePad';

function surface() {
  const canvas = screen.getByLabelText('Área para desenhar a manifestação') as HTMLCanvasElement;
  const context = { beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), clearRect: vi.fn() };
  const serialize = vi.fn(() => 'data:image/png;base64,dGVzdA==');
  const capture = vi.fn(); const release = vi.fn();
  Object.defineProperties(canvas, {
    getContext: { value: () => context }, toDataURL: { value: serialize },
    setPointerCapture: { value: capture }, releasePointerCapture: { value: release }, hasPointerCapture: { value: () => true },
    getBoundingClientRect: { value: () => ({ left: 0, top: 0, width: 500, height: 180 }) },
  });
  return { canvas, context, serialize, capture, release };
}
function pointer(canvas: HTMLCanvasElement, type: string, x: number, y: number) {
  const event = new Event(type, { bubbles: true });
  Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'pen' }, clientX: { value: x }, clientY: { value: y }, button: { value: 0 } });
  fireEvent(canvas, event);
}

describe('Manifestação desenhada', () => {
  it('registra o desenho ao finalizar e permite limpar antes da confirmação', () => {
    const change = vi.fn(); render(<SignaturePad onChange={change} />);
    const { canvas, context, serialize } = surface();
    pointer(canvas, 'pointerdown', 10, 20); pointer(canvas, 'pointermove', 30, 40); pointer(canvas, 'pointerup', 30, 40);
    expect(context.stroke).toHaveBeenCalledOnce();
    expect(serialize).toHaveBeenCalledOnce();
    expect(change).toHaveBeenLastCalledWith('data:image/png;base64,dGVzdA==');
    fireEvent.click(screen.getByRole('button', { name: 'Limpar desenho' }));
    expect(context.clearRect).toHaveBeenCalledOnce();
    expect(change).toHaveBeenLastCalledWith('');
  });
  it('bloqueia o canvas e a limpeza durante o envio, mesmo ao receber eventos diretamente', () => {
    const change = vi.fn(); const view = render(<SignaturePad onChange={change} />);
    const { canvas, context, serialize } = surface();
    pointer(canvas, 'pointerdown', 10, 20); pointer(canvas, 'pointermove', 30, 40); pointer(canvas, 'pointerup', 30, 40);
    view.rerender(<SignaturePad onChange={change} disabled />);
    expect(canvas).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: 'Limpar desenho' })).toBeDisabled();
    pointer(canvas, 'pointerdown', 50, 60); pointer(canvas, 'pointermove', 70, 80); pointer(canvas, 'pointerup', 70, 80);
    fireEvent.click(screen.getByRole('button', { name: 'Limpar desenho' }));
    expect(context.stroke).toHaveBeenCalledOnce();
    expect(serialize).toHaveBeenCalledOnce();
    expect(change).toHaveBeenCalledOnce();
    expect(context.clearRect).not.toHaveBeenCalled();
  });
  it('libera a captura e impede salvar um traço que foi interrompido pelo bloqueio', () => {
    const change = vi.fn(); const view = render(<SignaturePad onChange={change} />);
    const { canvas, release, serialize } = surface();
    pointer(canvas, 'pointerdown', 10, 20); pointer(canvas, 'pointermove', 30, 40);
    view.rerender(<SignaturePad onChange={change} disabled />);
    expect(release).toHaveBeenCalledWith(1);
    pointer(canvas, 'pointerup', 30, 40);
    expect(serialize).not.toHaveBeenCalled();
    expect(change).not.toHaveBeenCalled();
  });
});

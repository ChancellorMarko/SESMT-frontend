import { useEffect, useId, useRef, useState, type PointerEvent } from 'react';
import { Button } from '../../shared/ui';
import styles from './permits.module.css';

/** Representação visual, sem inferir identidade ou assinatura criptográfica. */
export function SignaturePad({ onChange, disabled = false }: { onChange: (representation: string) => void; disabled?: boolean }) {
  const helpId = useId();
  const canvas = useRef<HTMLCanvasElement>(null);
  const activePointer = useRef<number | null>(null);
  const previous = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);
  const [hasDrawing, setHasDrawing] = useState(false);
  useEffect(() => {
    if (!disabled) return;
    if (activePointer.current !== null && canvas.current?.hasPointerCapture(activePointer.current)) canvas.current.releasePointerCapture(activePointer.current);
    activePointer.current = null; previous.current = null; moved.current = false;
  }, [disabled]);

  function point(event: PointerEvent<HTMLCanvasElement>) {
    const surface = event.currentTarget;
    const bounds = surface.getBoundingClientRect();
    return { x: (event.clientX - bounds.left) * surface.width / bounds.width, y: (event.clientY - bounds.top) * surface.height / bounds.height };
  }
  function begin(event: PointerEvent<HTMLCanvasElement>) {
    if (disabled || activePointer.current !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const context = event.currentTarget.getContext('2d');
    if (!context) return;
    activePointer.current = event.pointerId; previous.current = point(event); moved.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function draw(event: PointerEvent<HTMLCanvasElement>) {
    if (disabled || activePointer.current !== event.pointerId || !previous.current) return;
    const context = event.currentTarget.getContext('2d');
    if (!context) return;
    const next = point(event);
    if (Math.hypot(next.x - previous.current.x, next.y - previous.current.y) < 1) return;
    context.strokeStyle = '#243e3b'; context.lineWidth = 3; context.lineCap = 'round'; context.lineJoin = 'round';
    context.beginPath(); context.moveTo(previous.current.x, previous.current.y); context.lineTo(next.x, next.y); context.stroke();
    previous.current = next; moved.current = true;
  }
  function finish(event: PointerEvent<HTMLCanvasElement>) {
    if (disabled || activePointer.current !== event.pointerId) return;
    if (moved.current) { setHasDrawing(true); onChange(event.currentTarget.toDataURL('image/png')); }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    activePointer.current = null; previous.current = null;
  }
  function clear() {
    if (disabled) return;
    canvas.current?.getContext('2d')?.clearRect(0, 0, 1000, 360);
    activePointer.current = null; previous.current = null; moved.current = false;
    setHasDrawing(false); onChange('');
  }
  return <div className={styles.signaturePad}>
    <p className="muted" id={helpId}>Use o dedo, a caneta ou o mouse. Para usar o teclado, escolha “Nome digitado” acima.</p>
    <canvas ref={canvas} width={1000} height={360} aria-label="Área para desenhar a manifestação" aria-describedby={helpId} aria-disabled={disabled} className={styles.canvas} style={disabled ? { cursor: 'not-allowed' } : undefined} onPointerDown={begin} onPointerMove={draw} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={() => { activePointer.current = null; previous.current = null; }} />
    <div className="actions"><Button variant="secondary" onClick={clear} disabled={disabled || !hasDrawing}>Limpar desenho</Button><span className="muted" role="status">{hasDrawing ? 'Desenho registrado. Você pode refazer antes de confirmar.' : 'Nenhum desenho registrado.'}</span></div>
  </div>;
}

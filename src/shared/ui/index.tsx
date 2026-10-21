import { Children, cloneElement, isValidElement, useLayoutEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode, type ReactElement, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { X, LoaderCircle, Inbox } from 'lucide-react';
import motionStyles from './ui-motion.module.css';

export function Button({ variant = 'primary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' }) {
  return <button type="button" {...props} className={`button button--${variant} ${className}`} />;
}
export function PageHeader({ eyebrow = 'GESTÃO DOCUMENTAL', title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return <div className="page-header"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{description && <p className="muted page-description">{description}</p>}</div>{actions && <div className="actions">{actions}</div>}</div>;
}
export type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'info';
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) { return <span className={`badge badge--${tone}`}>{children}</span>; }
export function Field({ label, error, required, children }: { label: string; error?: string; required?: boolean; children: ReactNode }) {
  const generatedId = useId();
  const markedRequired = label.trimEnd().endsWith('*');
  let controlId: string | undefined;
  let isRequired = required ?? markedRequired;
  let needsRequiredDescription = false;
  type ControlProps = { id?: string; children?: ReactNode; type?: string; required?: boolean; 'aria-required'?: boolean | 'true' | 'false'; 'aria-invalid'?: boolean | 'true' | 'false' | 'grammar' | 'spelling'; 'aria-describedby'?: string };
  function connect(node: ReactNode): ReactNode {
    if (controlId || !isValidElement(node) || typeof node.type !== 'string') return node;
    const element = node as ReactElement<ControlProps>;
    if (['input', 'select', 'textarea'].includes(node.type)) {
      const type = (element.props.type || 'text').toLowerCase();
      if (node.type === 'input' && ['hidden', 'button', 'submit', 'reset', 'image'].includes(type)) return node;
      controlId = element.props.id || generatedId;
      const explicitRequired = element.props['aria-required'];
      isRequired = explicitRequired !== undefined ? explicitRequired === true || explicitRequired === 'true' : Boolean(element.props.required || isRequired);
      const supportsRequired = node.type !== 'input' || !['file', 'range', 'color', 'radio'].includes(type);
      needsRequiredDescription = isRequired && !supportsRequired;
      const descriptions = [element.props['aria-describedby'], needsRequiredDescription ? `${generatedId}-required` : undefined, error ? `${generatedId}-error` : undefined]
        .filter(Boolean).join(' ').split(/\s+/).filter(Boolean);
      // Describe existing requirements without adding native constraints to draft forms.
      return cloneElement(element, {
        id: controlId,
        'aria-required': explicitRequired ?? (isRequired && supportsRequired ? true : undefined),
        'aria-invalid': error ? true : element.props['aria-invalid'],
        'aria-describedby': [...new Set(descriptions)].join(' ') || undefined,
      });
    }
    return element.props.children ? cloneElement(element, { children: Children.map(element.props.children, connect) }) : element;
  }
  const content = Children.map(children, connect);
  const indicator = isRequired && !markedRequired && <span aria-hidden="true"> *</span>;
  const caption = <label htmlFor={controlId}>{label}</label>;
  const requirement = needsRequiredDescription && <small className="muted small" id={`${generatedId}-required`}>Campo obrigatório.</small>;
  const message = error && <span className="field-error" id={`${generatedId}-error`} role="alert">{error}</span>;
  return controlId ? <div className="field">{indicator ? <span>{caption}{indicator}</span> : caption}{content}{requirement}{message}</div> : <label className="field"><span>{label}</span>{content}{message}</label>;
}
export function Feedback({ tone = 'info', children }: { tone?: Tone; children: ReactNode }) { return <div className={`feedback feedback--${tone} ${motionStyles.feedback}`} role={tone === 'danger' ? 'alert' : 'status'}>{children}</div>; }
export function EmptyState({ title, description }: { title: string; description?: string }) { return <div className={`empty-state ${motionStyles.emptyState}`}><Inbox size={32} aria-hidden="true" /><h3>{title}</h3>{description && <p className="muted">{description}</p>}</div>; }
export function Spinner() { return <div className="loading" role="status"><LoaderCircle className="spin" size={22} aria-hidden="true" /> Carregando informações…</div>; }
type ModalLayer = { dialog: RefObject<HTMLDivElement|null>; previous: HTMLElement|null };
const modalLayers:ModalLayer[]=[];
let unlockedOverflow='';
export function Modal({ open, title, onClose, children, className = '' }: { open: boolean; title: string; onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null); const titleId = useId();
  const closeRef=useRef(onClose); closeRef.current=onClose;
  useLayoutEffect(() => {
    if (!open) return;
    const layer:ModalLayer={dialog:ref,previous:document.activeElement as HTMLElement|null};
    if(!modalLayers.length) unlockedOverflow=document.body.style.overflow;
    modalLayers.push(layer); document.body.style.overflow = 'hidden';
    const focusables = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('button,a[href],input,select,textarea,[tabindex]') || []).filter(node => {
      if(node.tabIndex<0 || node.matches(':disabled,input[type="hidden"]') || node.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
      for(let element:HTMLElement|null=node;element&&element!==ref.current;element=element.parentElement) {
        const style=window.getComputedStyle(element);
        if(style.display==='none'||style.visibility==='hidden') return false;
      }
      return true;
    });
    // Focus the dialog itself; closing or destructive actions never receive automatic focus.
    ref.current?.focus();
    const handler = (event: KeyboardEvent) => {
      if(modalLayers.at(-1)!==layer || event.defaultPrevented) return;
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); }
      if (event.key === 'Tab') {
        const nodes = focusables(); const first = nodes[0]; const last = nodes.at(-1);
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === ref.current)) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
      const index=modalLayers.indexOf(layer),wasTop=modalLayers.at(-1)===layer;
      const next=modalLayers[index+1];
      // Keep a usable return target if a parent dialog is closed first.
      if(next && next.previous && (!next.previous.isConnected || ref.current?.contains(next.previous))) next.previous=layer.previous;
      if(index>=0) modalLayers.splice(index,1);
      if(!modalLayers.length) document.body.style.overflow=unlockedOverflow;
      if(wasTop) {
        const top=modalLayers.at(-1);
        if(layer.previous?.isConnected && (!top || top.dialog.current?.contains(layer.previous))) layer.previous.focus({ preventScroll: true });
        else top?.dialog.current?.focus({ preventScroll: true });
      }
    };
  }, [open]);
  if (!open) return null;
  return createPortal(<div className={`modal-backdrop ${motionStyles.backdrop}`} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div className={`modal ${className || motionStyles.dialog}`} ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}><div className="modal-header"><h2 id={titleId}>{title}</h2><Button variant="ghost" aria-label="Fechar janela" onClick={onClose}><X size={20} /></Button></div>{children}</div></div>, document.body);
}

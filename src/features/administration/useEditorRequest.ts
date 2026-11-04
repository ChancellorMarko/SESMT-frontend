import { useEffect, useRef } from 'react';

/** Cancels editor requests on removal and suppresses callbacks from an old context. */
export function useEditorRequest() {
  const active = useRef(true);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; pending.current?.abort(); };
  }, []);
  return {
    isActive: () => active.current,
    isPending: () => pending.current !== null,
    async run<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
      if (!active.current || pending.current) throw new DOMException('Operação indisponível.', 'AbortError');
      const controller = new AbortController();
      pending.current = controller;
      try {
        const result = await operation(controller.signal);
        if (controller.signal.aborted || !active.current) throw new DOMException('Operação cancelada.', 'AbortError');
        return result;
      } finally { if (pending.current === controller) pending.current = null; }
    },
  };
}

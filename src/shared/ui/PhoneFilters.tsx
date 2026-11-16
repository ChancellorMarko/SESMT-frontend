import { useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { SlidersHorizontal } from 'lucide-react';

const PHONE = '(max-width: 599px)';
// Address parameters that select context or a record, not a filter the person typed.
const NOT_FILTERS = new Set(['page', 'unitId', 'workerId', 'registro', 'tab']);

function usePhone() {
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(PHONE).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(PHONE), update = () => setPhone(query.matches);
    update(); query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return phone;
}

/** On phones, filters fold behind one control so results come first; they start open when a filter is applied. */
export function PhoneFilters({ children, label = 'Filtros' }: { children: ReactNode; label?: string }) {
  const phone = usePhone(), { search } = useLocation();
  const active = [...new URLSearchParams(search).keys()].filter(key => !NOT_FILTERS.has(key)).length;
  if (!phone) return <>{children}</>;
  return <details className="phone-filters" open={active > 0 || undefined}>
    <summary><SlidersHorizontal size={16} aria-hidden="true"/>{label}{active > 0 && <span className="phone-filters__count">{active}</span>}</summary>
    {children}
  </details>;
}

import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { createSearchParams, useLocation, useNavigate, useSearchParams, type NavigateFunction, type SetURLSearchParams } from 'react-router';

const AppQueryNavigation = createContext<NavigateFunction | null>(null);

/** Capture the data route's public navigator before rendering descendant <Routes>. */
export function AppQueryNavigationProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  return <AppQueryNavigation.Provider value={navigate}>{children}</AppQueryNavigation.Provider>;
}

export function useAppQueryParams(): ReturnType<typeof useSearchParams> {
  const navigate = useContext(AppQueryNavigation);
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const setAppParams = useCallback<SetURLSearchParams>((next, options) => {
    if (!navigate) { setParams(next, options); return; }
    const search = createSearchParams(typeof next === 'function' ? next(params) : next);
    // Descendant Routes' navigator drops flushSync; use the owning data navigator.
    // Omitting hash matches useSearchParams, which clears an existing fragment.
    void navigate({ pathname: location.pathname, search: `?${search}` }, options);
  }, [navigate, location.pathname, params, setParams]);
  return [params, setAppParams];
}

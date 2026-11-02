import { API_MODE } from './client';
import { AUTH_CONTRACT } from './auth-contract';

/** Explicit native module contract; never infer it from a role or a response shape. */
export const NATIVE_MODULES = API_MODE === 'api' && AUTH_CONTRACT.kind === 'native';

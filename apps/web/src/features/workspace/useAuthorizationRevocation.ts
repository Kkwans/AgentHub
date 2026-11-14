import { useEffect, useRef } from 'react';
import { authSession } from '../../lib/auth-api';

/** Keep transport/auth subscription outside presentation components. */
export function useAuthorizationRevocation(onRevoked: () => void) {
  const callback = useRef(onRevoked);
  callback.current = onRevoked;
  useEffect(() => authSession.onAuthorizationRequired(() => callback.current()), []);
}

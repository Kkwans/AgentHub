import { useCallback, useState } from 'react';

const STORAGE_PREFIX = 'phf:tool-detail:';

export function useToolDetailState(toolId: string) {
  const storageKey = `${STORAGE_PREFIX}${toolId}`;
  const [expanded, setExpandedState] = useState(() => {
    if (typeof sessionStorage === 'undefined') return false;
    return sessionStorage.getItem(storageKey) === '1';
  });

  const setExpanded = useCallback(
    (value: boolean | ((current: boolean) => boolean)) => {
      setExpandedState((current) => {
        const next = typeof value === 'function' ? value(current) : value;
        sessionStorage.setItem(storageKey, next ? '1' : '0');
        return next;
      });
    },
    [storageKey],
  );

  return [expanded, setExpanded] as const;
}

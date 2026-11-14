import { useLayoutEffect, useRef } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AgentCenterPage } from './AgentCenterPage';

export interface AgentDiscoveryOutletContext {
  closeDiscovery: () => void;
}
/** Only the directory and its discovery dialog share this shell, not Agent details. */
export function AgentDiscoveryLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const root = useRef<HTMLDivElement>(null);
  const previousPath = useRef(location.pathname);
  const opener = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const returned =
      previousPath.current === '/agents/agents/discover' && location.pathname === '/agents';
    previousPath.current = location.pathname;
    // The old dialog has been removed. Never override an already focused newer control.
    const active = document.activeElement;
    if (returned && (active === document.body || !active?.isConnected)) {
      const target = opener.current?.isConnected
        ? opener.current
        : root.current?.querySelector<HTMLElement>('[data-discovery-trigger="primary"]');
      target?.focus();
    }
    // Keep a connected opener across browser Forward; only a new explicit entry replaces it.
  }, [location.key, location.pathname]);
  const closeDiscovery = () => {
    if (location.pathname !== '/agents/agents/discover') return;
    if (location.state?.fromAgentDirectory === true) navigate(-1);
    else navigate('/agents', { replace: true });
  };
  return (
    <div
      ref={root}
      className="h-full min-h-0"
      onClickCapture={(event) => {
        const target =
          event.target instanceof Element
            ? event.target.closest<HTMLElement>('a[href="/agents/agents/discover"]')
            : null;
        if (
          target &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.shiftKey &&
          !event.altKey &&
          event.button === 0
        )
          opener.current = target;
      }}
    >
      <AgentCenterPage />
      <Outlet context={{ closeDiscovery } satisfies AgentDiscoveryOutletContext} />
    </div>
  );
}

/* global fetch, window */

(() => {
  const target = window;
  const headers = { accept: 'application/json' };
  if (target.__agenthubAuthStatusPromise) return;

  const readData = async (response) => {
    const body = await response.json();
    if (!response.ok || !body || typeof body !== 'object' || !body.data || body.error) {
      throw new Error('AgentHub API data unavailable');
    }
    return body.data;
  };

  const authStatusPromise = fetch('/api/v1/auth/status', {
    credentials: 'same-origin',
    headers,
  }).then(readData);
  target.__agenthubAuthStatusPromise = authStatusPromise;
  const shouldPrefetchHome =
    target.location.pathname === '/' || target.location.pathname === '/home';
  if (shouldPrefetchHome) {
    target.__agenthubHomeDataPromise = authStatusPromise
      .then((status) => {
        if (!(
          status?.mode === 'local_trusted' ||
          (status?.mode === 'token' && status.authenticated)
        )) {
          return undefined;
        }
        return Promise.all(
          ['dashboard', 'projects', 'sessions', 'agents'].map((resource) =>
            fetch(`/api/v1/${resource}`, { credentials: 'same-origin', headers }).then(readData),
          ),
        ).then(([dashboard, projects, sessions, agents]) => ({
          dashboard,
          projects,
          sessions,
          agents,
        }));
      })
      .catch(() => undefined);
  }
})();

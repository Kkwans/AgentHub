/* global fetch, window */

(() => {
  const target = window;
  if (target.__agenthubAuthStatusPromise) return;

  target.__agenthubAuthStatusPromise = fetch('/api/v1/auth/status', {
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
  }).then(async (response) => {
    const body = await response.json();
    if (!response.ok || !body || typeof body !== 'object' || !body.data || body.error) {
      throw new Error('AgentHub auth status unavailable');
    }
    return body.data;
  });
})();

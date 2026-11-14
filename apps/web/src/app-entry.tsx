import React from 'react';
import ReactDOM from 'react-dom/client';
import { AgentHubProvider } from '@agenthub/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource-variable/geist';
// Self-hosted Unicode-range subsets load only for glyphs present in the UI.
import '@fontsource-variable/noto-sans-sc';

import { App } from './App';
import '@agenthub/ui/styles.css';
import '@agenthub/ui/pinharness.css';
import './app/codex-theme.css';

export function mountApp(root: HTMLElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        staleTime: 5_000,
        refetchOnWindowFocus: false,
      },
    },
  });

  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <AgentHubProvider initialPreference="light">
        <QueryClientProvider client={queryClient}>
          {/* Client-only routes have no loader transition to coordinate; commit navigation immediately. */}
          <BrowserRouter useTransitions={false}>
            <App />
          </BrowserRouter>
        </QueryClientProvider>
      </AgentHubProvider>
    </React.StrictMode>,
  );
}

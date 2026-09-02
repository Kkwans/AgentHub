import React from 'react';
import ReactDOM from 'react-dom/client';
import { AgentHubProvider } from '@agenthub/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';

import { App } from './App';
import '@agenthub/ui/styles.css';

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
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </QueryClientProvider>
      </AgentHubProvider>
    </React.StrictMode>,
  );
}

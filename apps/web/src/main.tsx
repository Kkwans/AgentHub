import React from 'react';
import ReactDOM from 'react-dom/client';
import { AgentHubProvider } from '@agenthub/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';

import { App } from './App';
import '@agenthub/ui/styles.css';
import './styles.css';
import './styles/design-system.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5_000,
      refetchOnWindowFocus: false,
    },
  },
});

const root = document.getElementById('root');
if (!root) throw new Error('缺少应用根节点');

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

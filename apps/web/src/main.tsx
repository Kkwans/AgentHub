import React from 'react';
import ReactDOM from 'react-dom/client';
import { AgentHubProvider, Theme } from '@agenthub/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';

import { App } from './App';
import '@agenthub/ui/styles.css';
import './styles.css';
import './styles/design-system.css';
import './styles/v3-foundation.css';
import './styles/v3-controls.css';
import './styles/v06-discovery.css';

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
      <Theme
        accentColor="orange"
        appearance="light"
        grayColor="slate"
        panelBackground="solid"
        radius="large"
        scaling="95%"
      >
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </QueryClientProvider>
      </Theme>
    </AgentHubProvider>
  </React.StrictMode>,
);

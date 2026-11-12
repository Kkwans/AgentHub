// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentCenterPage } from './AgentCenterPage';
import { capabilitiesFor, executionTargetKindLabel } from '../agent-presentation';

afterEach(cleanup);
const labels = (capabilitiesJson: Record<string, unknown>) => capabilitiesFor({ capabilitiesJson });
describe('Agent capability truthfulness', () => {
  it.each([
    ['LOCAL_HOST', '本机'],
    ['DOCKER_CONTAINER', 'Docker'],
    ['REMOTE_NODE', '远程节点'],
    ['FUTURE_TARGET', '类型待确认'],
    [undefined, '类型待确认'],
  ])('labels target kind %s without assuming Local', (kind, label) => {
    expect(executionTargetKindLabel(kind)).toBe(label);
  });

  it('does not invent capabilities for empty or unknown reports', () => {
    expect(labels({})).toEqual([]);
    expect(labels({ futureCapability: true, sessions: {}, run: 'true' })).toEqual([]);
  });
  it('does not treat false flags or nested objects as supported', () => {
    expect(
      labels({
        session: false,
        runs: false,
        approvals: false,
        sessions: { create: false, load: false },
        workspace: { files: false, terminal: false },
      }),
    ).toEqual([]);
  });
  it('normalizes plural aliases and deduplicates confirmed legacy flags', () => {
    expect(
      labels({
        session: true,
        sessions: true,
        run: true,
        runs: true,
        approval: true,
        approvals: true,
      }),
    ).toEqual(['Session', 'Run', 'Approval']);
  });
  it('reads the actual nested adapter contract without guessing Run', () => {
    expect(
      labels({
        sessions: { create: true },
        prompts: { text: true },
        interaction: { approvals: true },
        workspace: { files: true, terminal: false },
      }),
    ).toEqual(['Session', '文本输入', 'Approval', '文件']);
  });
  it('keeps cards informational and exposes an honest host diagnostics link', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    client.setQueryData(
      ['agents'],
      [
        {
          id: 'a1',
          name: '待核对 Agent',
          agentKind: 'CUSTOM_ACP',
          adapterKind: 'ACP_STDIO',
          enabled: true,
          status: 'UNVERIFIED',
          capabilitiesJson: {},
          targetId: 't1',
        },
      ],
    );
    client.setQueryData(['discovery-agents'], []);
    client.setQueryData(['execution-targets'], []);
    function Route() {
      return <output data-testid="route">{useLocation().pathname}</output>;
    }
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <AgentCenterPage />
          <Route />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const card = await screen.findByRole('group', { name: /待核对 Agent/ });
    expect(within(card).getByText('能力待确认')).toBeInTheDocument();
    expect(within(card).getByText('运行环境待确认 · 类型待确认')).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: '管理 Agent' })).toHaveAttribute(
      'href',
      '/agents/a1',
    );
    expect(card).not.toHaveAttribute('tabindex');
    fireEvent.click(card);
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(screen.getByTestId('route')).toHaveTextContent(/^\/$/);
    const link = within(card).getByRole('link', { name: '服务器诊断' });
    expect(link).toHaveAttribute('href', '/agents/diagnostics');
    expect(link).toHaveAccessibleDescription('当前 AgentHub 服务器，不是此 Agent 专属诊断');
    fireEvent.click(link);
    expect(screen.getByTestId('route')).toHaveTextContent('/agents/diagnostics');
    client.clear();
  });
});

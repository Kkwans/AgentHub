// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeCandidateRecord } from '../../../lib/api';
import { api } from '../../../lib/api';
import { InfrastructurePage } from './InfrastructurePage';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function mount(rows: RuntimeCandidateRecord[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['discovery-runtimes'], rows);
  vi.spyOn(api, 'get').mockResolvedValue(rows);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <InfrastructurePage kind="runtimes" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const runtime = (
  state: RuntimeCandidateRecord['state'],
  statusText?: string,
): RuntimeCandidateRecord => ({
  candidateId: state,
  displayName: `环境 ${state}`,
  kind: 'LOCAL_HOST',
  state,
  ...(statusText !== undefined ? { statusText } : {}),
  targetId: 'target',
  workspaceMappings: [],
  adoptable: false,
});
describe('Runtime page status consistency', () => {
  it('keeps one Runtime heading and the original explicit rescan action without an infrastructure badge', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({});
    mount([runtime('READY')]);
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Runtime', level: 1 })).toBeVisible(),
    );
    expect(screen.queryByText('Agent Infrastructure')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '重新扫描' })).toHaveLength(1);
    expect(post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '重新扫描' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/discovery/runtimes/rescan'));
    expect(post).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Local Host · 就绪')).toBeVisible();
  });
  it('renders known state instead of contradictory unknown detail', () => {
    mount([runtime('READY'), runtime('UNAVAILABLE'), runtime('BROKEN'), runtime('UNSUPPORTED')]);
    for (const label of ['就绪', '不可用', '异常', '不支持']) {
      expect(screen.getByText(`Local Host · ${label}`)).toBeVisible();
      expect(screen.getByText(label, { exact: true })).toBeVisible();
    }
    expect(screen.queryByText(/状态待确认/)).not.toBeInTheDocument();
  });
  it('does not upgrade an unknown future runtime state to ready', () => {
    const unknown = { ...runtime('READY'), state: 'UNKNOWN' } as unknown as RuntimeCandidateRecord;
    mount([unknown]);
    expect(screen.getByText('Local Host · 状态待确认')).toBeVisible();
    expect(screen.getByText('未知', { exact: true })).toBeVisible();
    expect(screen.queryByText('就绪', { exact: true })).not.toBeInTheDocument();
  });
  it('keeps provided diagnostic details and stopped visibility/action behavior', () => {
    mount([runtime('READY', 'Up 2 minutes (health: starting)'), runtime('STOPPED')]);
    expect(screen.getByText('Local Host · Up 2 minutes (health: starting)')).toBeVisible();
    expect(screen.queryByText('Local Host · 已停止')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '显示已停止（1）' }));
    expect(screen.getByText('Local Host · 已停止')).toBeVisible();
    expect(screen.getByRole('button', { name: '启动' })).toBeVisible();
  });
});

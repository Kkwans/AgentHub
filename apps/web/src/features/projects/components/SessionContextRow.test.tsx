// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { AgentHubProvider } from '@agenthub/ui';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it } from 'vitest';
import type { SessionRecord } from '../../../lib/api';
import { SessionContextRow, sessionDirectoryLabel } from './SessionContextRow';

afterEach(cleanup);
const base: SessionRecord = {
  id: 'session-1',
  projectId: 'project-1',
  agentId: 'agent-1',
  taskId: null,
  title: '检查会话上下文与工作目录',
  cwd: '/repo/worktrees/client-web',
  branch: 'feature/session',
  status: 'READY',
  model: 'model-long-context',
  mode: null,
  reasoningEffort: null,
  lastActiveAt: '2026-11-15T01:00:00.000Z',
};
function mount(session = base, agentName: string | undefined = 'Codex') {
  return render(
    <AgentHubProvider>
      <MemoryRouter>
        <SessionContextRow session={session} agentName={agentName} />
      </MemoryRouter>
    </AgentHubProvider>,
  );
}
it('preserves primary navigation, status and timestamp with sibling native disclosure', () => {
  const { container } = mount();
  const link = screen.getByRole('link');
  expect(link).toHaveAttribute('href', '/workspace/session-1');
  expect(link).toHaveTextContent(base.title);
  expect(link.querySelector('[role="status"]')).toHaveTextContent('就绪');
  expect(link.querySelector('time')).toHaveAttribute('datetime', base.lastActiveAt);
  expect(link.querySelector('summary,details,button,a,input,[tabindex]')).toBeNull();
  const summary = container.querySelector('summary')!;
  expect(summary).toHaveAccessibleName(`查看会话上下文：${base.title}`);
  expect(summary.parentElement?.parentElement).toBe(link.parentElement);
  expect(summary.parentElement?.tagName).toBe('DETAILS');
  expect(container.querySelector('details')).not.toHaveAttribute('open');
  fireEvent.click(summary);
  expect(container.querySelector('details')).toHaveAttribute('open');
  expect(link).toHaveAttribute('href', '/workspace/session-1');
});
it('keeps full long context in disclosure while default summary uses directory basename', () => {
  const title = '长标题'.repeat(30);
  const agent = '审查 Agent '.repeat(10);
  const session = {
    ...base,
    title,
    branch: 'feature/' + '长分支'.repeat(30),
    model: 'model-'.repeat(25),
    cwd: '/repo/' + '目录/'.repeat(25) + 'client-web',
  };
  const { container } = mount(session, agent);
  const link = screen.getByRole('link');
  expect(link).toHaveTextContent('client-web');
  expect(link).not.toHaveTextContent(session.cwd);
  expect(link).not.toHaveTextContent(session.model);
  expect([...container.querySelectorAll('dd')].map((n) => n.textContent)).toEqual([
    title,
    agent,
    session.model,
    session.branch,
    session.cwd,
  ]);
});
it('does not confuse identical basenames with identical workspace paths', () => {
  const { container } = render(
    <AgentHubProvider>
      <MemoryRouter>
        <SessionContextRow session={base} agentName="Codex" />
        <SessionContextRow
          session={{ ...base, id: 'session-2', cwd: '/other/client-web' }}
          agentName="Codex"
        />
      </MemoryRouter>
    </AgentHubProvider>,
  );
  expect(
    [...container.querySelectorAll('details dd:last-child')].map((n) => n.textContent),
  ).toEqual([base.cwd, '/other/client-web']);
  expect(screen.getAllByRole('link').map((n) => n.getAttribute('href'))).toEqual([
    '/workspace/session-1',
    '/workspace/session-2',
  ]);
});
it('reports unknown context and invalid activity without fabricating details', () => {
  const { container } = mount(
    { ...base, model: null, branch: null, cwd: '', lastActiveAt: 'invalid' },
    '',
  );
  expect(screen.getByRole('link')).toHaveTextContent('Agent 信息未知');
  expect(screen.getByRole('link')).toHaveTextContent('暂无活动时间');
  expect(container.querySelector('time')).toBeNull();
  expect([...container.querySelectorAll('dd')].map((n) => n.textContent)).toEqual([
    base.title,
    'Agent 信息未知',
    '模型未记录',
    '分支未记录',
    '目录未记录',
  ]);
});
it.each([
  ['/a/client-web/', 'client-web'],
  ['C:\\Users\\dev\\client-web\\', 'client-web'],
  ['/', '/'],
  ['C:\\', 'C:/'],
  [null, '目录未记录'],
  [undefined, '目录未记录'],
  ['', '目录未记录'],
  ['/a/space name', 'space name'],
  ['\\\\server\\share\\client-web', 'client-web'],
])('directory display handles %s without changing original path', (path, expected) => {
  expect(sessionDirectoryLabel(path)).toBe(expected);
});

// @vitest-environment jsdom
import type * as AgentHubUi from '@agenthub/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectsPage } from './ProjectsPage';

// Exercise ProjectsPage's filter state independently of the shared select popup.
vi.mock('@agenthub/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof AgentHubUi>()),
  AhSelect: ({
    'aria-label': label,
    value,
    onChange,
    data,
  }: {
    'aria-label': string;
    value: string;
    onChange: (value: string) => void;
    data: { value: string; label: string }[];
  }) => (
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
      {data.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));
vi.mock('../../../lib/api', () => ({ api: { get: vi.fn(async () => []) } }));
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.forEach((client) => client.clear());
  clients.length = 0;
  vi.restoreAllMocks();
});
const projects = [
  {
    id: 'p1',
    name: '正式项目',
    status: 'ACTIVE',
    kind: 'STANDARD',
    rootPath: '/project',
    realRootPath: '/project',
    repoKind: 'GIT',
  },
  {
    id: 'p2',
    name: '测试仓库',
    status: 'ARCHIVED',
    kind: 'TEST',
    rootPath: '/test',
    realRootPath: '/test',
    repoKind: 'GIT',
  },
];
function mount(mobile: boolean, records = projects) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    matches: mobile,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: () => false,
  }));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  clients.push(client);
  client.setQueryData(['projects'], records);
  for (const key of ['tasks', 'sessions', 'agents']) client.setQueryData([key], []);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ProjectsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
describe('项目渐进筛选', () => {
  it('手机默认折叠次级筛选，键盘语义明确，展开后可筛选', async () => {
    mount(true);
    const toggle = await screen.findByRole('button', { name: '筛选和排序' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', 'project-filter-options');
    expect(screen.queryByRole('combobox', { name: '项目状态' })).not.toBeInTheDocument();
    fireEvent.click(toggle);
    fireEvent.change(screen.getByRole('combobox', { name: '项目状态' }), {
      target: { value: 'ARCHIVED' },
    });
    fireEvent.click(toggle);
    expect(toggle).toHaveTextContent('1');
    expect(screen.getByText('1 个项目')).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByRole('combobox', { name: '项目状态' })).toHaveValue('ARCHIVED');
  });
  it('清除搜索、筛选和非默认排序，但保留视图选择', async () => {
    mount(true);
    fireEvent.click(await screen.findByRole('button', { name: '筛选和排序' }));
    fireEvent.change(screen.getByRole('combobox', { name: '项目排序' }), {
      target: { value: 'name' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: '搜索项目' }), {
      target: { value: '不存在' },
    });
    expect(screen.getByText('没有匹配的项目')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '卡片' }));
    fireEvent.click(screen.getByRole('button', { name: '清除条件' }));
    expect(screen.getByRole('combobox', { name: '项目排序' })).toHaveValue('updated');
    expect(screen.getByRole('textbox', { name: '搜索项目' })).toHaveValue('');
    expect(screen.getByRole('button', { name: '卡片' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('2 个项目')).toBeInTheDocument();
  });
  it('桌面条件常显，测试项目仍保持单独折叠', () => {
    mount(false);
    expect(screen.getByRole('combobox', { name: '项目状态' })).toBeVisible();
    expect(screen.getByRole('combobox', { name: '项目类型' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '筛选和排序' })).not.toBeInTheDocument();
    expect(screen.getByText('测试 Project（1）').closest('details')).not.toHaveAttribute('open');
  });
});

describe('测试项目可见性', () => {
  const group = () => screen.getByText(/测试 Project（\d+）/).closest('details')!;
  const search = (value: string) =>
    fireEvent.change(screen.getByRole('textbox', { name: '搜索项目' }), { target: { value } });

  it.each([true, false])('只有测试项目时默认展开并提供可访问项目链接（手机=%s）', (mobile) => {
    mount(mobile, [projects[1]!]);
    expect(group()).toHaveAttribute('open');
    expect(screen.getByRole('link', { name: /^(?!编辑).*测试仓库/ })).toBeVisible();
    expect(screen.getByText('1 个项目')).toBeVisible();
  });

  it('没有用户选择时，搜索只剩测试项目自动展开，恢复混合列表自动折叠', () => {
    mount(false);
    expect(group()).not.toHaveAttribute('open');
    fireEvent(group(), new Event('toggle'));
    search('测试仓库');
    expect(group()).toHaveAttribute('open');
    fireEvent(group(), new Event('toggle'));
    expect(screen.getByRole('link', { name: /^(?!编辑).*测试仓库/ })).toBeVisible();
    search('');
    expect(group()).not.toHaveAttribute('open');
  });

  it('主动折叠跨搜索空结果、类型筛选和卡片视图保留，仍可再次展开', () => {
    mount(false);
    search('测试仓库');
    fireEvent.click(screen.getByText('测试 Project（1）'));
    expect(group()).not.toHaveAttribute('open');
    search('不存在');
    expect(screen.getByText('没有匹配的项目')).toBeVisible();
    search('');
    fireEvent.change(screen.getByRole('combobox', { name: '项目类型' }), {
      target: { value: 'TEST' },
    });
    expect(screen.getByRole('link', { name: /^(?!编辑).*测试仓库/ })).toBeVisible();
    fireEvent.change(screen.getByRole('combobox', { name: '项目类型' }), {
      target: { value: 'all' },
    });
    fireEvent.click(screen.getByRole('button', { name: '卡片' }));
    fireEvent.click(screen.getByRole('button', { name: '列表' }));
    search('测试仓库');
    expect(group()).not.toHaveAttribute('open');
    // Keyboard activation uses the same native click path (detail=0); no extra
    // key handler may double-toggle it. Real Enter/Space is covered by browser QA.
    fireEvent.click(screen.getByText('测试 Project（1）'), { detail: 0 });
    expect(group()).toHaveAttribute('open');
    search('');
    expect(group()).toHaveAttribute('open');
  });

  it('分页仅剩测试项目自动展开，主动选择跨分页保留', () => {
    const records = Array.from({ length: 10 }, (_, index) => ({
      ...projects[0]!,
      id: `p-${index}`,
      name: `A正式项目${index}`,
    })).concat([{ ...projects[1]!, name: 'Z测试仓库' }]);
    mount(false, records);
    fireEvent.change(screen.getByRole('combobox', { name: '项目排序' }), {
      target: { value: 'name' },
    });
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    expect(group()).toHaveAttribute('open');
    fireEvent.click(screen.getByText('测试 Project（1）'));
    expect(group()).not.toHaveAttribute('open');
    fireEvent.click(screen.getByRole('button', { name: '上一页' }));
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    expect(group()).not.toHaveAttribute('open');
  });
});

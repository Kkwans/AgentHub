// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../../../lib/api';
import { PromptLibraryPage } from './PromptLibraryPage';

vi.mock('../../../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
let client: QueryClient;
afterEach(() => {
  cleanup();
  client?.clear();
  vi.resetAllMocks();
});
function mount(content: Record<string, unknown> | undefined, description?: string, type = 'TEXT') {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.mocked(api.get).mockImplementation(async <T,>(path: string) => {
    if (path === '/prompts')
      return [
        { id: 'p1', key: 'test/body', name: '正文测试', kind: 'TASK', type, description },
      ] as T;
    if (path === '/prompts/p1/versions')
      return (
        content === undefined
          ? []
          : [
              {
                id: 'v1',
                promptId: 'p1',
                version: 1,
                contentJson: content,
                variablesJson: {},
                createdAt: '2026-11-12T00:00:00Z',
              },
            ]
      ) as T;
    return [] as T;
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PromptLibraryPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
it.each([undefined, '这是资产说明，不是可执行正文'])(
  'no version never copies metadata or a placeholder: %s',
  async (description) => {
    mount(undefined, description);
    const create = await screen.findByRole('button', { name: '创建第一个版本' });
    expect(screen.queryByText('9 字符')).not.toBeInTheDocument();
    expect(screen.queryByText('尚未创建版本内容。')).not.toBeInTheDocument();
    fireEvent.click(create);
    const dialog = screen.getByRole('dialog', { name: '创建新版本' });
    expect(within(dialog).getByRole('textbox', { name: 'Prompt 内容' })).toHaveValue('');
    expect(within(dialog).getByRole('button', { name: '创建版本' })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    expect(api.post).not.toHaveBeenCalled();
  },
);
it.each([{}, { text: '' }])(
  'an existing empty body stays empty instead of using description: %j',
  async (body) => {
    mount(body, '资产说明不得替换正文');
    await screen.findByText('此版本的正文为空');
    expect(screen.getByText('0 字符')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '创建第一个版本' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '新建版本' }));
    expect(screen.getByRole('textbox', { name: 'Prompt 内容' })).toHaveValue('');
  },
);
it('retains real text including whitespace and does not overwrite an open draft on refetch', async () => {
  mount({ text: '实际 {{name}} 正文\n' }, '资产说明');
  await screen.findByText('实际 {{name}} 正文');
  fireEvent.click(screen.getByRole('button', { name: '新建版本' }));
  const textbox = screen.getByRole('textbox', { name: 'Prompt 内容' });
  expect(textbox).toHaveValue('实际 {{name}} 正文\n');
  fireEvent.change(textbox, { target: { value: '尚未提交的编辑' } });
  await act(async () => {
    await client.refetchQueries({ queryKey: ['prompt-versions', 'p1'] });
  });
  expect(textbox).toHaveValue('尚未提交的编辑');
  expect(api.post).not.toHaveBeenCalled();
});
it.each([undefined, 'metadata', ''])(
  'copies actual CHAT JSON including extra text: %s',
  async (text) => {
    const body = {
      messages: [{ role: 'user', content: '实际消息' }],
      ...(text === undefined ? {} : { text }),
    };
    mount(body, '不是正文', 'CHAT');
    await screen.findByRole('heading', { name: '正文测试' });
    await screen.findByText(/实际消息/);
    fireEvent.click(screen.getByRole('button', { name: '新建版本' }));
    expect(screen.getByRole('textbox', { name: 'CHAT 内容 JSON' })).toHaveValue(
      JSON.stringify(body, null, 2),
    );
  },
);

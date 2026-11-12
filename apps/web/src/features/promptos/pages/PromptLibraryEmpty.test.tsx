// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../../lib/api';
import { PromptLibraryPage } from './PromptLibraryPage';

vi.mock('../../../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.forEach((client) => client.clear());
  clients.length = 0;
  vi.resetAllMocks();
});
const asset = { id: 'p1', name: '真实模板', key: 'test/template', kind: 'TASK', type: 'TEXT' };
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PromptLibraryPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
describe('Prompt library empty state', () => {
  it('has one create action and no nested empty directory/editor, preserves cancel and create', async () => {
    let assets: (typeof asset)[] = [];
    vi.mocked(api.get).mockImplementation(
      async <T,>(path: string) => (path === '/prompts' ? assets : []) as T,
    );
    vi.mocked(api.post).mockImplementation(async <T,>() => {
      assets = [asset];
      return asset as T;
    });
    mount();
    await screen.findByText('还没有 Prompt');
    expect(screen.getAllByRole('button', { name: '新建 Prompt' })).toHaveLength(1);
    expect(screen.queryByRole('complementary', { name: 'Prompt 目录' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Prompt 编辑器' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '新建 Prompt' }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(api.post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '新建 Prompt' }));
    const dialog = screen.getByRole('dialog', { name: '新建 Prompt' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: '名称' }), {
      target: { value: '真实模板' },
    });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Key' }), {
      target: { value: 'test/template' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '创建' }));
    expect(await screen.findByRole('heading', { name: '真实模板' })).toBeInTheDocument();
    expect(screen.queryByText('还没有 Prompt')).not.toBeInTheDocument();
    expect(api.post).toHaveBeenCalledTimes(1);
  });
  it('filtered no-results retains the selected editor and can return to the directory', async () => {
    vi.mocked(api.get).mockImplementation(
      async <T,>(path: string) => (path === '/prompts' ? [asset] : []) as T,
    );
    mount();
    await screen.findByRole('heading', { name: '真实模板' });
    const search = screen.getByRole('textbox', { name: '搜索 Prompt' });
    fireEvent.change(search, { target: { value: 'not-matching' } });
    expect(screen.getByText('没有匹配的 Prompt')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Prompt 编辑器' })).toHaveTextContent('真实模板');
    expect(screen.queryByText('还没有 Prompt')).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: '' } });
    expect(screen.queryByText('没有匹配的 Prompt')).not.toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Prompt 目录' })).toHaveTextContent(
      '真实模板',
    );
  });
  it('does not misrepresent loading as an empty library', () => {
    vi.mocked(api.get).mockImplementation(() => new Promise(() => {}));
    mount();
    expect(screen.queryByText('还没有 Prompt')).not.toBeInTheDocument();
  });
  it('does not misrepresent API failure as an empty library', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('资产暂时无法读取'));
    mount();
    expect(await screen.findByText('资产暂时无法读取')).toBeInTheDocument();
    expect(screen.queryByText('还没有 Prompt')).not.toBeInTheDocument();
  });
});

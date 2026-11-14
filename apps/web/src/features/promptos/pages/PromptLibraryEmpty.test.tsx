import { PromptBindingOperationProvider } from '../components/PromptBindingOperationProvider';
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
  vi.restoreAllMocks();
});
const asset = { id: 'p1', name: '真实模板', key: 'test/template', kind: 'TASK', type: 'TEXT' };
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PromptBindingOperationProvider>
          <PromptLibraryPage />
        </PromptBindingOperationProvider>
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
    const intro = screen.getByRole('region', { name: 'Prompt 库入门' });
    expect(within(intro).getByRole('heading', { name: '还没有 Prompt', level: 2 })).toBeVisible();
    expect(screen.queryByText('PROMPT ASSETS')).not.toBeInTheDocument();
    expect(intro).not.toHaveClass('ah-card');
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

it('keeps mobile directory filters mounted while prioritizing the selected editor', async () => {
  let compact = true;
  let mediaChanged: (() => void) | undefined;
  vi.spyOn(window, 'matchMedia').mockImplementation((media) => ({
    media,
    get matches() {
      return media === '(max-width: 767px)' && compact;
    },
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: (_event: string, listener: EventListenerOrEventListenerObject) => {
      if (media === '(max-width: 767px)') mediaChanged = listener as () => void;
    },
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  const second = { ...asset, id: 'p2', name: '真实模板二', key: 'test/second' };
  vi.mocked(api.get).mockImplementation(
    async <T,>(path: string) => (path === '/prompts' ? [asset, second] : []) as T,
  );
  mount();
  await screen.findByRole('heading', { name: '真实模板' });
  const editor = screen.getByRole('region', { name: 'Prompt 编辑器' });
  const directory = screen.getByRole('complementary', { name: 'Prompt 目录' });
  const toggle = within(directory).getByRole('button', { name: '展开目录' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('textbox', { name: '搜索 Prompt' })).not.toBeInTheDocument();
  fireEvent.click(toggle);
  const search = screen.getByRole('textbox', { name: '搜索 Prompt' });
  fireEvent.change(search, { target: { value: '真实' } });
  fireEvent.keyDown(search, { key: 'Escape' });
  expect(toggle).toHaveFocus();
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByRole('region', { name: 'Prompt 编辑器' })).toBe(editor);
  fireEvent.click(toggle);
  expect(screen.getByRole('textbox', { name: '搜索 Prompt' })).toHaveValue('真实');
  fireEvent.click(within(directory).getByRole('button', { name: /真实模板二/ }));
  await screen.findByRole('heading', { name: '真实模板二' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(toggle).toHaveFocus();
  expect(screen.getByRole('region', { name: 'Prompt 编辑器' })).toBe(editor);
  act(() => {
    compact = false;
    mediaChanged?.();
  });
  expect(screen.getByRole('textbox', { name: '搜索 Prompt' })).toHaveValue('真实');
  expect(screen.queryByRole('button', { name: '展开目录' })).not.toBeInTheDocument();
  screen.getByRole('textbox', { name: '搜索 Prompt' }).focus();
  act(() => {
    compact = true;
    mediaChanged?.();
  });
  expect(screen.getByRole('button', { name: '展开目录' })).toHaveFocus();
  expect(screen.queryByRole('textbox', { name: '搜索 Prompt' })).not.toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Prompt 编辑器' })).toBe(editor);
  act(() => {
    compact = false;
    mediaChanged?.();
  });
  const editorAction = within(editor).getByRole('button', { name: '刷新' });
  editorAction.focus();
  act(() => {
    compact = true;
    mediaChanged?.();
  });
  expect(editorAction).toHaveFocus();
  expect(api.post).not.toHaveBeenCalled();
});

vi.mock('../../../components/AccessGate', () => ({
  useAuthMode: () => 'local_trusted',
  useAuthUser: () => null,
}));

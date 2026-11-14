// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ThreeColumnSplit } from './three-column-split.js';
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it.each(['wide', 'medium'] as const)(
  'temporary %s review expansion retains original content nodes and preferences',
  (mode) => {
    const write = vi.spyOn(Storage.prototype, 'setItem');
    const props = {
      left: <button>会话</button>,
      middle: <textarea aria-label="对话草稿" />,
      right: (
        <>
          <textarea aria-label="提交草稿" />
          <button disabled>提交进行中</button>
        </>
      ),
      leftCollapsed: false,
      rightCollapsed: false,
      onOpenLeft: vi.fn(),
      onOpenRight: vi.fn(),
      leftLabel: '会话',
      leftRatioKey: 'focus-left',
      rightRatioKey: 'focus-right',
      layoutMode: mode,
      compactPanel: 'right' as const,
      mediumPresentation: 'drawer' as const,
    };
    const view = render(<ThreeColumnSplit {...props} />);
    const right = screen.getByRole('textbox', { name: '提交草稿' });
    const middle = view.container.querySelector('[aria-label="对话草稿"]');
    const busy = screen.getByRole('button', { name: '提交进行中' });
    fireEvent.change(right, { target: { value: 'pending draft' } });
    const host = view.container.querySelector('.three-column-split') as HTMLElement;
    const initialColumns = host.style.gridTemplateColumns;
    if (mode === 'wide') {
      const divider = screen.getByRole('separator', { name: '调整右栏宽度' });
      expect(divider).toHaveAttribute(
        'title',
        '拖动调整右栏宽度；聚焦后使用左右方向键，Home 最窄，End 最宽',
      );
      expect(divider.querySelector('[data-resize-grip="right"]')).toHaveAttribute(
        'aria-hidden',
        'true',
      );
      expect(divider).toHaveAttribute('tabindex', '0');
    }

    const dialog = mode === 'medium' ? screen.getByRole('dialog') : null;
    view.rerender(<ThreeColumnSplit {...props} rightFocused />);
    expect(host).toHaveAttribute('data-right-focused', 'true');
    expect(screen.getByRole('textbox', { name: '提交草稿' })).toBe(right);
    expect(screen.getByRole('button', { name: '提交进行中' })).toBe(busy);
    expect(view.container.querySelector('[aria-label="对话草稿"]')).toBe(middle);
    if (mode === 'wide') {
      expect(middle?.closest('[hidden][inert]')).not.toBeNull();
      expect(screen.queryByRole('separator')).not.toBeInTheDocument();
      expect(host.style.gridTemplateColumns).toBe('0px 0px 0px 0px minmax(0, 1fr)');
    } else {
      expect(screen.getByRole('dialog')).toBe(dialog);
      expect(dialog).toHaveStyle({ width: 'calc(100% - 32px)' });
    }
    view.rerender(<ThreeColumnSplit {...props} />);
    expect(host).not.toHaveAttribute('data-right-focused');
    expect(host.style.gridTemplateColumns).toBe(initialColumns);
    expect(screen.getByRole('textbox', { name: '提交草稿' })).toBe(right);
    expect(right).toHaveValue('pending draft');
    expect(write).not.toHaveBeenCalled();
    // A stale opt-in cannot hide the conversation after the right side is closed.
    view.rerender(
      <ThreeColumnSplit {...props} rightCollapsed compactPanel="middle" rightFocused />,
    );
    expect(host).not.toHaveAttribute('data-right-focused');
    expect(screen.getByRole('textbox', { name: '对话草稿' })).toBeInTheDocument();
  },
);

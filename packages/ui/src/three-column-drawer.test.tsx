// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { ThreeColumnSplit, type CompactPanel } from './three-column-split.js';

afterEach(cleanup);
function Harness({ drawer = true }: { drawer?: boolean }) {
  const [panel, setPanel] = useState<CompactPanel>('middle');
  return (
    <>
      <button onClick={() => setPanel('right')}>打开</button>
      <ThreeColumnSplit
        left={<button>会话内容</button>}
        middle={<textarea aria-label="会话草稿" />}
        right={
          <>
            <textarea aria-label="提交草稿" />
            <details>
              <summary>Git 详情</summary>hash
            </details>
          </>
        }
        leftCollapsed={false}
        rightCollapsed={true}
        onOpenLeft={vi.fn()}
        onOpenRight={vi.fn()}
        leftLabel="会话"
        rightLabel="检查器"
        leftRatioKey="test-left"
        rightRatioKey="test-right"
        layoutMode="medium"
        compactPanel={panel}
        onCompactPanelChange={setPanel}
        mediumPresentation={drawer ? 'drawer' : 'inline'}
      />
    </>
  );
}
it('drawer opt-in keeps both drafts mounted across close and isolates conversation only while open', () => {
  render(<Harness />);
  const chat = screen.getByRole('textbox', { name: '会话草稿' });
  fireEvent.change(chat, { target: { value: 'conversation' } });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '打开' }));
  const dialog = screen.getByRole('dialog', { name: '工作区辅助栏' });
  expect(dialog).toHaveAttribute('aria-modal', 'true');
  expect(chat.closest('[inert]')).not.toBeNull();
  const draft = screen.getByRole('textbox', { name: '提交草稿' });
  fireEvent.change(draft, { target: { value: 'commit' } });
  fireEvent.click(screen.getByRole('button', { name: '关闭辅助栏遮罩' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(chat.closest('[inert]')).toBeNull();
  expect(chat).toHaveValue('conversation');
  fireEvent.click(screen.getByRole('button', { name: '打开' }));
  expect(screen.getByRole('textbox', { name: '提交草稿' })).toBe(draft);
  expect(draft).toHaveValue('commit');
});
it('default inline consumers do not receive modal or inert semantics', () => {
  render(<Harness drawer={false} />);
  fireEvent.click(screen.getByRole('button', { name: '打开' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: '会话草稿' }).closest('[inert]')).toBeNull();
  expect(screen.queryByRole('button', { name: '关闭辅助栏遮罩' })).not.toBeInTheDocument();
});

// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { FormDialog, FormTextField } from '@agenthub/ui';

function DialogHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        打开表单
      </button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="创建 Project"
        footer={
          <button type="button" onClick={() => setOpen(false)}>
            保存
          </button>
        }
      >
        <FormTextField
          id="project-name"
          label="Project 名称"
          required
          error="请输入 Project 名称。"
        />
      </FormDialog>
    </>
  );
}

describe('FormDialog 焦点管理', () => {
  it('打开时聚焦首个错误控件，关闭后恢复到触发按钮', async () => {
    render(<DialogHarness />);
    const trigger = screen.getByRole('button', { name: '打开表单' });

    trigger.focus();
    fireEvent.click(trigger);
    const field = await screen.findByLabelText('Project 名称');
    await waitFor(() => expect(field).toHaveFocus());

    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});

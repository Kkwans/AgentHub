// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { ComposerToolbar } from './ComposerToolbar';

afterEach(cleanup);

it.each([0, 1, 2])('keeps passive progress semantics and the exact count (%s/2)', (completed) => {
  render(
    <ComposerToolbar
      contextOpen={false}
      contextStatus={{ label: '未绑定', kind: 'empty' }}
      planSummary={{ completed, total: 2 }}
      onToggleContext={() => undefined}
      configuration={undefined}
      configurationLoading={false}
      model=""
      mode=""
      reasoningEffort=""
      updatingModel={false}
      updatingMode={false}
      updatingReasoningEffort={false}
      onChangeConfiguration={() => undefined}
      activeRun={false}
      sessionStatus="READY"
      sendPending={false}
      stopPending={false}
      sendingBlocked={false}
      onSend={() => undefined}
      onStop={() => undefined}
    />,
  );
  const progress = screen.getByRole('progressbar', { name: `执行计划 ${completed}/2 完成` });
  expect(progress).toHaveTextContent(`${completed}/2`);
  expect(progress).toHaveAttribute('aria-valuemin', '0');
  expect(progress).toHaveAttribute('aria-valuemax', '2');
  expect(progress).toHaveAttribute('aria-valuenow', String(completed));
  expect(progress).not.toHaveAttribute('tabindex');
  expect(progress.tagName).toBe('SPAN');
  expect(progress.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  expect(progress.querySelector('.composer-plan-track')).toHaveAttribute('aria-hidden', 'true');
  expect(progress.querySelector('.composer-plan-track-fill')).toHaveStyle({
    transform: `scaleX(${completed / 2})`,
  });
  if (completed === 2) expect(progress).toHaveAttribute('data-complete', 'true');
  else expect(progress).not.toHaveAttribute('data-complete');
  expect(screen.getByRole('button', { name: '发送' })).toBeEnabled();
  expect(screen.getByRole('button', { name: '配置模型、访问策略和推理强度' })).toBeEnabled();
});

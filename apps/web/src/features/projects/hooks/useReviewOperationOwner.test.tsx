// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { createReviewOperationOwner } from '../lib/review-operation-owner';
import { useReviewOperationOwner } from './useReviewOperationOwner';
afterEach(cleanup);
it('route subscriber remount retains owner result, auth change clears it and rejects prior callbacks', () => {
  const owner = createReviewOperationOwner();
  owner.setScope('account:a');
  const contract = owner.bind({ projectId: 'p', taskId: 't' });
  function RouteContent() {
    const records = useReviewOperationOwner(owner);
    return (
      <>
        {records.map((record) => (
          <p key={record.operationId}>
            {record.phase}
            {record.resultHref ? <a href={record.resultHref}>结果</a> : null}
          </p>
        ))}
      </>
    );
  }
  const first = render(<RouteContent />);
  act(() =>
    contract.onOperationChange({
      projectId: 'p',
      taskId: 't',
      operationId: 'op',
      phase: 'pending',
      message: 'waiting',
    }),
  );
  expect(screen.getByText('pending')).toBeVisible();
  first.unmount();
  act(() =>
    contract.onOperationChange({
      projectId: 'p',
      taskId: 't',
      operationId: 'op',
      phase: 'resolved',
      message: 'done',
      resultHref: '/workspace/result',
    }),
  );
  render(<RouteContent />);
  expect(screen.getByRole('link', { name: '结果' })).toHaveAttribute('href', '/workspace/result');
  act(() => owner.setScope('account:b'));
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  act(() =>
    contract.onOperationChange({
      projectId: 'p',
      taskId: 't',
      operationId: 'other',
      phase: 'pending',
      message: 'late old user',
    }),
  );
  expect(owner.getSnapshot()).toEqual([]);
});

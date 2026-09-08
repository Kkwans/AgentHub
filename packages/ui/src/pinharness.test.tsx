// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Badge, Button, Card, Input, Skeleton, Textarea } from './pinharness/index.js';

afterEach(cleanup);

describe('PinHarness primitives exposed by @agenthub/ui', () => {
  it('keeps the copied controls and surfaces accessible and composable', () => {
    render(
      <Card aria-label="工作摘要">
        <Badge variant="success" dot>
          已完成
        </Badge>
        <Input aria-label="项目名称" placeholder="AgentHub" />
        <Textarea aria-label="工作说明" />
        <Button>打开 Workspace</Button>
        <Skeleton className="h-3 w-24" />
      </Card>,
    );

    expect(screen.getByRole('button', { name: '打开 Workspace' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: '项目名称' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: '工作说明' })).toBeVisible();
    expect(screen.getByText('已完成').closest('.ui-badge')).toBeInTheDocument();
    expect(screen.getByLabelText('工作摘要')).toHaveClass('rounded-[var(--radius-xl)]');
  });
});

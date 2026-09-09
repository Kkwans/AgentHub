// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  Badge,
  Button,
  Card,
  Input,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from './pinharness/index.js';

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

  it('preserves PinHarness Slot semantics for link-like actions', () => {
    render(
      <Button asChild variant="outline">
        <a href="/workspace/demo">打开 Workspace</a>
      </Button>,
    );

    const link = screen.getByRole('link', { name: '打开 Workspace' });
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', '/workspace/demo');
    expect(link).toHaveAttribute('aria-disabled', 'false');
  });

  it('keeps Radix tab focus/state semantics from the source kit', () => {
    render(
      <Tabs defaultValue="conversation">
        <TabsList aria-label="工作区视图">
          <TabsTrigger value="conversation">对话</TabsTrigger>
          <TabsTrigger value="files">文件</TabsTrigger>
        </TabsList>
        <TabsContent value="conversation">对话内容</TabsContent>
        <TabsContent value="files">文件内容</TabsContent>
      </Tabs>,
    );

    const conversation = screen.getByRole('tab', { name: '对话' });
    expect(conversation).toHaveAttribute('data-state', 'active');
    expect(conversation).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: '对话' })).toBeVisible();
    expect(screen.getByRole('tab', { name: '文件' })).toHaveAttribute('data-state', 'inactive');
  });
});

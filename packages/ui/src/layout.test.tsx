// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  ContextHeader,
  EntityList,
  EntityRow,
  InspectorPanel,
  PageFrame,
  ScreenHeader,
  SettingsLayout,
} from './layout.js';

describe('v0.8 layout contracts', () => {
  it('keeps ordinary screens on one shared page grid', () => {
    render(
      <PageFrame>
        <ScreenHeader
          title="项目"
          description="工程上下文与工作入口"
          actions={<button>新建项目</button>}
        />
        <EntityList label="项目列表" header={<span>项目</span>}>
          <EntityRow selected>AgentHub</EntityRow>
        </EntityList>
      </PageFrame>,
    );

    expect(screen.getByRole('heading', { name: '项目' })).toBeTruthy();
    expect(screen.getByRole('region', { name: '项目列表' })).toBeTruthy();
    expect(screen.getByText('AgentHub').getAttribute('aria-current')).toBe('true');
  });

  it('provides semantic context, inspector and settings structures', () => {
    render(
      <>
        <ContextHeader identity="AgentHub" tabs={<a href="/overview">概览</a>} />
        <InspectorPanel title="Changes" footer={<button>提交</button>}>
          Diff
        </InspectorPanel>
        <SettingsLayout navigation={<nav aria-label="设置导航">外观</nav>}>主题</SettingsLayout>
      </>,
    );

    expect(screen.getByRole('navigation', { name: '项目上下文' })).toBeTruthy();
    expect(screen.getByRole('complementary', { name: 'Changes' }).textContent).toContain('Diff');
    expect(screen.getByRole('navigation', { name: '设置导航' })).toBeTruthy();
  });
});

// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ContextHeader,
  EntityList,
  EntityRow,
  AhLocalNav,
  AhPanelHeader,
  AhSettingRow,
  AhToolbar,
  InspectorPanel,
  PageFrame,
  ScreenHeader,
  SettingsLayout,
} from './layout.js';

afterEach(cleanup);

describe('layout contracts', () => {
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

  it('provides v1 toolbar, local navigation and setting row contracts', () => {
    render(
      <>
        <AhToolbar label="项目筛选">
          <button type="button">搜索</button>
        </AhToolbar>
        <AhLocalNav
          label="设置分区"
          items={[{ href: '/settings/appearance', label: '外观', active: true, count: 2 }]}
        />
        <AhSettingRow label="主题" description="控制界面明暗" control={<button>深色</button>} />
        <AhPanelHeader title="Changes" description="工作区变更" actions={<button>刷新</button>} />
      </>,
    );

    expect(screen.getByRole('toolbar', { name: '项目筛选' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /外观/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('主题')).toBeInTheDocument();
    expect(screen.getByText('Changes')).toBeInTheDocument();
  });
});

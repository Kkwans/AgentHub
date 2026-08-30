import { describe, expect, it } from 'vitest';

import {
  readWorkspaceLayout,
  WORKSPACE_LAYOUT_STORAGE_KEYS,
  writeWorkspacePanel,
} from './layoutPreferences';

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    values,
  };
}

describe('Workspace layout preferences', () => {
  it('uses v0.8 defaults and clamps stale widths', () => {
    expect(readWorkspaceLayout(memoryStorage())).toEqual({
      leftWidth: 280,
      leftCollapsed: false,
      rightWidth: 500,
      rightCollapsed: true,
    });
    expect(
      readWorkspaceLayout(
        memoryStorage({
          [WORKSPACE_LAYOUT_STORAGE_KEYS.leftWidth]: '9999',
          [WORKSPACE_LAYOUT_STORAGE_KEYS.rightWidth]: '20',
          [WORKSPACE_LAYOUT_STORAGE_KEYS.leftCollapsed]: 'true',
        }),
      ),
    ).toEqual({
      leftWidth: 380,
      leftCollapsed: true,
      rightWidth: 360,
      rightCollapsed: true,
    });
  });

  it('stores width and collapsed state independently', () => {
    const storage = memoryStorage();
    writeWorkspacePanel('left', { width: 318, collapsed: true }, storage);
    writeWorkspacePanel('right', { width: 512, collapsed: false }, storage);
    expect(readWorkspaceLayout(storage)).toEqual({
      leftWidth: 318,
      leftCollapsed: true,
      rightWidth: 512,
      rightCollapsed: false,
    });
  });
});

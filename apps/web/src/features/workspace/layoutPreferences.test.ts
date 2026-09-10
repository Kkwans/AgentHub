import { describe, expect, it } from 'vitest';

import {
  LEGACY_WORKSPACE_LAYOUT_STORAGE_KEYS,
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
  it('uses v2 defaults and clamps stale widths', () => {
    expect(readWorkspaceLayout(memoryStorage())).toEqual({
      leftWidth: 256,
      leftCollapsed: false,
      rightWidth: 380,
      rightCollapsed: false,
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
      rightWidth: 320,
      rightCollapsed: false,
    });
  });

  it('保留旧 key 的宽度和折叠偏好，并让 medium 首次使用显示共享 Rail', () => {
    const storage = memoryStorage({
      [LEGACY_WORKSPACE_LAYOUT_STORAGE_KEYS.leftWidth]: '380',
      [LEGACY_WORKSPACE_LAYOUT_STORAGE_KEYS.rightWidth]: '720',
    });
    expect(readWorkspaceLayout(storage, 1024)).toEqual({
      leftWidth: 380,
      leftCollapsed: false,
      rightWidth: 520,
      rightCollapsed: false,
    });
    expect(storage.values.get(WORKSPACE_LAYOUT_STORAGE_KEYS.leftWidth)).toBe('380');
    expect(storage.values.get(WORKSPACE_LAYOUT_STORAGE_KEYS.rightWidth)).toBe('520');
    expect(
      readWorkspaceLayout(
        memoryStorage({
          [LEGACY_WORKSPACE_LAYOUT_STORAGE_KEYS.leftCollapsed]: 'false',
        }),
        1024,
      ).leftCollapsed,
    ).toBe(false);
    expect(readWorkspaceLayout(memoryStorage(), 1_439).leftCollapsed).toBe(false);
    expect(readWorkspaceLayout(memoryStorage(), 1_440).leftCollapsed).toBe(false);
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

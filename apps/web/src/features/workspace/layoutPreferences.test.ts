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
  it('uses v1 defaults and clamps stale widths', () => {
    expect(readWorkspaceLayout(memoryStorage())).toEqual({
      leftWidth: 256,
      leftCollapsed: false,
      rightWidth: 440,
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
      leftWidth: 336,
      leftCollapsed: true,
      rightWidth: 360,
      rightCollapsed: false,
    });
  });

  it('保留旧 key 的宽度和折叠偏好，并在窄屏无显式偏好时折叠 Rail', () => {
    expect(
      readWorkspaceLayout(
        memoryStorage({
          [LEGACY_WORKSPACE_LAYOUT_STORAGE_KEYS.leftWidth]: '380',
          [LEGACY_WORKSPACE_LAYOUT_STORAGE_KEYS.rightWidth]: '720',
        }),
        1024,
      ),
    ).toEqual({
      leftWidth: 336,
      leftCollapsed: true,
      rightWidth: 720,
      rightCollapsed: false,
    });
    expect(
      readWorkspaceLayout(
        memoryStorage({
          [LEGACY_WORKSPACE_LAYOUT_STORAGE_KEYS.leftCollapsed]: 'false',
        }),
        1024,
      ).leftCollapsed,
    ).toBe(false);
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

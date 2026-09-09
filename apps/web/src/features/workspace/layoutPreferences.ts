import type { WorkspaceLayoutV2 } from '@agenthub/ui';

export const WORKSPACE_LAYOUT_STORAGE_KEYS = {
  leftWidth: 'agenthub.workspace.layout-v2.left.width',
  leftCollapsed: 'agenthub.workspace.layout-v2.left.collapsed',
  rightWidth: 'agenthub.workspace.layout-v2.right.width',
  rightCollapsed: 'agenthub.workspace.layout-v2.right.collapsed',
} as const;

export const LEGACY_WORKSPACE_LAYOUT_STORAGE_KEYS = {
  leftWidth: 'agenthub.workspace.stage-v1.left.width',
  leftCollapsed: 'agenthub.workspace.stage-v1.left.collapsed',
  rightWidth: 'agenthub.workspace.stage-v1.right.width',
  rightCollapsed: 'agenthub.workspace.stage-v1.right.collapsed',
} as const;

export const HISTORIC_WORKSPACE_LAYOUT_STORAGE_KEYS = {
  leftWidth: 'agenthub.workspace.left.width',
  leftCollapsed: 'agenthub.workspace.left.collapsed',
  rightWidth: 'agenthub.workspace.right.width',
  rightCollapsed: 'agenthub.workspace.right.collapsed',
} as const;

export const WORKSPACE_PANEL_LIMITS = {
  left: { defaultSize: 256, min: 216, max: 380 },
  right: { defaultSize: 380, min: 320, max: 520 },
} as const;

/** Backwards-compatible feature name for the shared persisted layout contract. */
export type WorkspaceLayoutPreference = WorkspaceLayoutV2;

type LayoutStorage = Pick<Storage, 'getItem' | 'setItem'>;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function readWidth(
  storage: LayoutStorage,
  keys: readonly string[],
  fallback: number,
  min: number,
  max: number,
) {
  const stored = keys.map((key) => storage.getItem(key)).find((value) => value !== null);
  const value = Number(stored);
  return Number.isFinite(value) && value > 0 ? clamp(value, min, max) : fallback;
}

function firstStoredValue(storage: LayoutStorage, keys: readonly string[]): string | null {
  return keys.map((key) => storage.getItem(key)).find((value) => value !== null) ?? null;
}

function readCollapsed(storage: LayoutStorage, keys: readonly string[], fallback = false): boolean {
  const value = keys.map((key) => storage.getItem(key)).find((item) => item !== null);
  return value === null || value === undefined ? fallback : value === 'true';
}

export function readWorkspaceLayout(
  storage: LayoutStorage | undefined = typeof window === 'undefined'
    ? undefined
    : window.localStorage,
  viewportWidth?: number,
): WorkspaceLayoutPreference {
  if (!storage) {
    return {
      leftWidth: WORKSPACE_PANEL_LIMITS.left.defaultSize,
      leftCollapsed: false,
      rightWidth: WORKSPACE_PANEL_LIMITS.right.defaultSize,
      rightCollapsed: false,
    };
  }
  const leftWidthValue = firstStoredValue(storage, [
    WORKSPACE_LAYOUT_STORAGE_KEYS.leftWidth,
    LEGACY_WORKSPACE_LAYOUT_STORAGE_KEYS.leftWidth,
    HISTORIC_WORKSPACE_LAYOUT_STORAGE_KEYS.leftWidth,
  ]);
  const leftCollapsedValue = firstStoredValue(storage, [
    WORKSPACE_LAYOUT_STORAGE_KEYS.leftCollapsed,
    LEGACY_WORKSPACE_LAYOUT_STORAGE_KEYS.leftCollapsed,
    HISTORIC_WORKSPACE_LAYOUT_STORAGE_KEYS.leftCollapsed,
  ]);
  const rightWidthValue = firstStoredValue(storage, [
    WORKSPACE_LAYOUT_STORAGE_KEYS.rightWidth,
    LEGACY_WORKSPACE_LAYOUT_STORAGE_KEYS.rightWidth,
    HISTORIC_WORKSPACE_LAYOUT_STORAGE_KEYS.rightWidth,
  ]);
  const rightCollapsedValue = firstStoredValue(storage, [
    WORKSPACE_LAYOUT_STORAGE_KEYS.rightCollapsed,
    LEGACY_WORKSPACE_LAYOUT_STORAGE_KEYS.rightCollapsed,
    HISTORIC_WORKSPACE_LAYOUT_STORAGE_KEYS.rightCollapsed,
  ]);
  const defaultLeftCollapsed =
    viewportWidth !== undefined
      ? viewportWidth < 1_440
      : typeof window !== 'undefined' &&
        storage === window.localStorage &&
        window.innerWidth < 1_440;
  const layout = {
    leftWidth: readWidth(
      storage,
      [
        WORKSPACE_LAYOUT_STORAGE_KEYS.leftWidth,
        LEGACY_WORKSPACE_LAYOUT_STORAGE_KEYS.leftWidth,
        HISTORIC_WORKSPACE_LAYOUT_STORAGE_KEYS.leftWidth,
      ],
      WORKSPACE_PANEL_LIMITS.left.defaultSize,
      WORKSPACE_PANEL_LIMITS.left.min,
      WORKSPACE_PANEL_LIMITS.left.max,
    ),
    leftCollapsed: readCollapsed(
      storage,
      [
        WORKSPACE_LAYOUT_STORAGE_KEYS.leftCollapsed,
        LEGACY_WORKSPACE_LAYOUT_STORAGE_KEYS.leftCollapsed,
        HISTORIC_WORKSPACE_LAYOUT_STORAGE_KEYS.leftCollapsed,
      ],
      defaultLeftCollapsed,
    ),
    rightWidth: readWidth(
      storage,
      [
        WORKSPACE_LAYOUT_STORAGE_KEYS.rightWidth,
        LEGACY_WORKSPACE_LAYOUT_STORAGE_KEYS.rightWidth,
        HISTORIC_WORKSPACE_LAYOUT_STORAGE_KEYS.rightWidth,
      ],
      WORKSPACE_PANEL_LIMITS.right.defaultSize,
      WORKSPACE_PANEL_LIMITS.right.min,
      WORKSPACE_PANEL_LIMITS.right.max,
    ),
    rightCollapsed: readCollapsed(
      storage,
      [
        WORKSPACE_LAYOUT_STORAGE_KEYS.rightCollapsed,
        LEGACY_WORKSPACE_LAYOUT_STORAGE_KEYS.rightCollapsed,
        HISTORIC_WORKSPACE_LAYOUT_STORAGE_KEYS.rightCollapsed,
      ],
      false,
    ),
  };
  const hasLegacyValue =
    leftWidthValue !== storage.getItem(WORKSPACE_LAYOUT_STORAGE_KEYS.leftWidth) ||
    leftCollapsedValue !== storage.getItem(WORKSPACE_LAYOUT_STORAGE_KEYS.leftCollapsed) ||
    rightWidthValue !== storage.getItem(WORKSPACE_LAYOUT_STORAGE_KEYS.rightWidth) ||
    rightCollapsedValue !== storage.getItem(WORKSPACE_LAYOUT_STORAGE_KEYS.rightCollapsed);
  if (hasLegacyValue) {
    storage.setItem(WORKSPACE_LAYOUT_STORAGE_KEYS.leftWidth, String(layout.leftWidth));
    storage.setItem(WORKSPACE_LAYOUT_STORAGE_KEYS.leftCollapsed, String(layout.leftCollapsed));
    storage.setItem(WORKSPACE_LAYOUT_STORAGE_KEYS.rightWidth, String(layout.rightWidth));
    storage.setItem(WORKSPACE_LAYOUT_STORAGE_KEYS.rightCollapsed, String(layout.rightCollapsed));
  }
  return layout;
}

export function writeWorkspacePanel(
  side: 'left' | 'right',
  value: { width?: number; collapsed?: boolean },
  storage: LayoutStorage | undefined = typeof window === 'undefined'
    ? undefined
    : window.localStorage,
): void {
  if (!storage) return;
  const limits = WORKSPACE_PANEL_LIMITS[side];
  const widthKey =
    side === 'left'
      ? WORKSPACE_LAYOUT_STORAGE_KEYS.leftWidth
      : WORKSPACE_LAYOUT_STORAGE_KEYS.rightWidth;
  const collapsedKey =
    side === 'left'
      ? WORKSPACE_LAYOUT_STORAGE_KEYS.leftCollapsed
      : WORKSPACE_LAYOUT_STORAGE_KEYS.rightCollapsed;
  if (value.width !== undefined && Number.isFinite(value.width)) {
    storage.setItem(widthKey, String(clamp(value.width, limits.min, limits.max)));
  }
  if (value.collapsed !== undefined) storage.setItem(collapsedKey, String(value.collapsed));
}

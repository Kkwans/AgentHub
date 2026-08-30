export const WORKSPACE_LAYOUT_STORAGE_KEYS = {
  leftWidth: 'agenthub.workspace.stage-v1.left.width',
  leftCollapsed: 'agenthub.workspace.stage-v1.left.collapsed',
  rightWidth: 'agenthub.workspace.stage-v1.right.width',
  rightCollapsed: 'agenthub.workspace.stage-v1.right.collapsed',
} as const;

export const WORKSPACE_PANEL_LIMITS = {
  left: { defaultSize: 280, min: 220, max: 380 },
  right: { defaultSize: 500, min: 360, max: 720 },
} as const;

export interface WorkspaceLayoutPreference {
  leftWidth: number;
  leftCollapsed: boolean;
  rightWidth: number;
  rightCollapsed: boolean;
}

type LayoutStorage = Pick<Storage, 'getItem' | 'setItem'>;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function readWidth(
  storage: LayoutStorage,
  key: string,
  fallback: number,
  min: number,
  max: number,
) {
  const value = Number(storage.getItem(key));
  return Number.isFinite(value) && value > 0 ? clamp(value, min, max) : fallback;
}

function readCollapsed(storage: LayoutStorage, key: string, fallback = false): boolean {
  const value = storage.getItem(key);
  return value === null ? fallback : value === 'true';
}

export function readWorkspaceLayout(
  storage: LayoutStorage | undefined = typeof window === 'undefined'
    ? undefined
    : window.localStorage,
): WorkspaceLayoutPreference {
  if (!storage) {
    return {
      leftWidth: WORKSPACE_PANEL_LIMITS.left.defaultSize,
      leftCollapsed: false,
      rightWidth: WORKSPACE_PANEL_LIMITS.right.defaultSize,
      rightCollapsed: true,
    };
  }
  return {
    leftWidth: readWidth(
      storage,
      WORKSPACE_LAYOUT_STORAGE_KEYS.leftWidth,
      WORKSPACE_PANEL_LIMITS.left.defaultSize,
      WORKSPACE_PANEL_LIMITS.left.min,
      WORKSPACE_PANEL_LIMITS.left.max,
    ),
    leftCollapsed: readCollapsed(storage, WORKSPACE_LAYOUT_STORAGE_KEYS.leftCollapsed),
    rightWidth: readWidth(
      storage,
      WORKSPACE_LAYOUT_STORAGE_KEYS.rightWidth,
      WORKSPACE_PANEL_LIMITS.right.defaultSize,
      WORKSPACE_PANEL_LIMITS.right.min,
      WORKSPACE_PANEL_LIMITS.right.max,
    ),
    rightCollapsed: readCollapsed(storage, WORKSPACE_LAYOUT_STORAGE_KEYS.rightCollapsed, true),
  };
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

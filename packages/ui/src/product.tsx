import {
  Alert,
  Anchor,
  Button,
  Divider,
  Group,
  Loader,
  Modal,
  Paper,
  Select,
  Skeleton,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Drawer,
  type PaperProps,
} from '@mantine/core';
import { motion, useReducedMotion } from 'motion/react';
import { CheckCircleIcon } from '@phosphor-icons/react/CheckCircle';
import { InfoIcon } from '@phosphor-icons/react/Info';
import { WarningCircleIcon } from '@phosphor-icons/react/WarningCircle';
import { type ComponentProps, type TextareaHTMLAttributes, type ReactNode } from 'react';

import { useAgentHubTheme } from './provider.js';

const statusLabels: Record<string, string> = {
  READY: '就绪',
  RUNNING: '执行中',
  COMPLETED: '已完成',
  DONE: '已完成',
  ACTIVE: '使用中',
  IN_PROGRESS: '进行中',
  WAITING_REVIEW: '待审阅',
  AWAITING_INPUT: '等待输入',
  REVIEW: '待审阅',
  BLOCKED: '已阻塞',
  FAILED: '失败',
  BROKEN: '异常',
  STOPPED: '已停止',
  OFFLINE: '离线',
  ONLINE: '在线',
  REVOKED: '已撤销',
  PENDING: '等待处理',
  CANCELED: '已取消',
  DISCONNECTED: '已断开',
  UNAVAILABLE: '不可用',
  AUTH_REQUIRED: '需要授权',
  MISSING_DEPENDENCY: '缺少依赖',
  UNSUPPORTED: '不支持',
  UNKNOWN: '未知',
};

function statusColor(status: string): string {
  if (['READY', 'COMPLETED', 'DONE', 'ACTIVE', 'ONLINE'].includes(status)) return 'green';
  if (['RUNNING', 'IN_PROGRESS', 'REVIEW', 'WAITING_REVIEW', 'PENDING'].includes(status))
    return 'aurora';
  if (['BLOCKED', 'FAILED', 'BROKEN', 'REVOKED', 'AUTH_REQUIRED'].includes(status)) return 'red';
  if (['STOPPED', 'OFFLINE', 'DISCONNECTED', 'CANCELED'].includes(status)) return 'gray';
  return 'yellow';
}

export function humanizeStatus(status: string): string {
  return statusLabels[status] ?? '状态';
}

export function AhStatusPill({ status, label }: { status: string; label?: string }) {
  return (
    <span role="status">
      <BadgeLike color={statusColor(status)}>{label ?? humanizeStatus(status)}</BadgeLike>
    </span>
  );
}

function BadgeLike({ color, children }: { color: string; children: ReactNode }) {
  const palette: Record<string, { background: string; color: string }> = {
    green: { background: 'var(--ah-success-soft, #e8f8f1)', color: 'var(--ah-success, #0f9f6e)' },
    aurora: {
      background: 'var(--ah-accent-soft, #f0edff)',
      color: 'var(--ah-accent-primary, #6246f5)',
    },
    red: { background: 'var(--ah-danger-soft, #fdecee)', color: 'var(--ah-danger, #dc4850)' },
    gray: {
      background: 'var(--ah-surface-subtle, #f6f7fb)',
      color: 'var(--ah-text-secondary, #59647a)',
    },
    yellow: { background: 'var(--ah-warning-soft, #fff4dd)', color: 'var(--ah-warning, #c87911)' },
  };
  const colors = palette[color] ?? palette.gray ?? { background: 'transparent', color: 'inherit' };
  return (
    <span
      className="ah-status-pill"
      data-tone={color}
      style={{ background: colors.background, color: colors.color }}
    >
      {children}
    </span>
  );
}

export function AhStatusDot({ status, label }: { status: string; label?: string }) {
  const tone = statusColor(status);
  return (
    <span className="ah-status-dot" data-tone={tone} role="status">
      <span aria-hidden="true" />
      {label ?? humanizeStatus(status)}
    </span>
  );
}

export function AhEmptyState({
  title,
  description,
  action,
  icon,
  compact = false,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
  compact?: boolean;
}) {
  return (
    <Stack align="center" gap={compact ? 6 : 'sm'} py={compact ? 'lg' : 48} px="md" ta="center">
      <ThemeIcon size={compact ? 34 : 42} radius="xl" variant="light" color="aurora">
        {icon ?? <InfoIcon size={compact ? 17 : 20} />}
      </ThemeIcon>
      <Text fw={650} size={compact ? 'sm' : 'md'}>
        {title}
      </Text>
      {description ? (
        <Text c="dimmed" size="sm" maw={480}>
          {description}
        </Text>
      ) : null}
      {action ? (
        <Group justify="center" mt={4}>
          {action}
        </Group>
      ) : null}
    </Stack>
  );
}

export function AhErrorState({
  title = '加载失败',
  description,
  retry,
}: {
  title?: string;
  description?: string;
  retry?: () => void;
}) {
  return (
    <Alert
      color="red"
      variant="light"
      icon={<WarningCircleIcon size={19} />}
      title={title}
      maw={720}
    >
      <Group justify="space-between" align="center" gap="md">
        <Text size="sm">{description ?? '请检查连接后重试。'}</Text>
        {retry ? (
          <Button size="xs" variant="light" color="red" onClick={retry}>
            重试
          </Button>
        ) : null}
      </Group>
    </Alert>
  );
}

export function AhLoadingState({
  label = '正在加载',
  rows = 3,
}: {
  label?: string;
  rows?: number;
}) {
  return (
    <Stack gap="md" aria-busy="true" aria-label={label}>
      <Group gap="sm">
        <Loader size="sm" color="aurora" />
        <Text c="dimmed" size="sm">
          {label}
        </Text>
      </Group>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} height={index === 0 ? 42 : 32} radius="md" />
      ))}
    </Stack>
  );
}

export function AhProjectContext({
  project,
  tabs,
}: {
  project: { id: string; name: string; rootPath: string; status?: string };
  tabs: Array<{ to: string; label: string; count?: number }>;
}) {
  return (
    <Stack gap={0}>
      <Group justify="space-between" align="flex-start" gap="md" wrap="wrap">
        <Stack gap={3}>
          <Text size="xs" fw={700} c="aurora.7" tt="uppercase" lts="0.08em">
            当前项目
          </Text>
          <Text size="xl" fw={700}>
            {project.name}
          </Text>
          <Text size="sm" c="dimmed" ff="monospace" truncate="end" maw={760}>
            {project.rootPath}
          </Text>
        </Stack>
        {project.status ? <AhStatusPill status={project.status} /> : null}
      </Group>
      <nav
        aria-label="项目上下文"
        style={{ display: 'flex', gap: 4, overflowX: 'auto', marginTop: 24 }}
      >
        {tabs.map((tab) => (
          <Anchor
            key={tab.to}
            href={tab.to}
            style={{
              whiteSpace: 'nowrap',
              padding: '9px 12px',
              borderRadius: 8,
              color: 'var(--ah-text-secondary)',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {tab.label}
            {typeof tab.count === 'number' ? ` ${tab.count}` : ''}
          </Anchor>
        ))}
      </nav>
      <Divider mt={6} />
    </Stack>
  );
}

export function AhMetric({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: 'neutral' | 'accent' | 'success' | 'warning';
}) {
  const colors = {
    neutral: 'var(--ah-text-primary)',
    accent: 'var(--ah-accent-primary)',
    success: 'var(--ah-success)',
    warning: 'var(--ah-warning)',
  };
  return (
    <Stack gap={3}>
      <Text size="xs" c="dimmed" fw={650}>
        {label}
      </Text>
      <Text size="xl" fw={750} style={{ color: colors[tone] }}>
        {value}
      </Text>
      {hint ? (
        <Text size="xs" c="dimmed">
          {hint}
        </Text>
      ) : null}
    </Stack>
  );
}

export function AhSurface({
  children,
  withBorder = true,
  ...props
}: PaperProps & { children: ReactNode; withBorder?: boolean }) {
  return (
    <Paper
      {...props}
      withBorder={withBorder}
      radius="md"
      shadow="none"
      style={{
        background: 'var(--ah-surface)',
        borderColor: 'var(--ah-border-default)',
        ...props.style,
      }}
    >
      {children}
    </Paper>
  );
}

export function AhThemeSelect() {
  const { preference, setPreference } = useAgentHubTheme();
  return (
    <Select
      aria-label="主题"
      label="主题"
      value={preference}
      onChange={(value) => {
        if (value === 'light' || value === 'dark' || value === 'system') setPreference(value);
      }}
      data={[
        { value: 'light', label: '浅色' },
        { value: 'dark', label: '深色' },
        { value: 'system', label: '跟随系统' },
      ]}
      allowDeselect={false}
      radius="sm"
      size="md"
    />
  );
}

export function AhInput({
  label,
  ...props
}: ComponentProps<typeof TextInput> & { label?: string }) {
  return <TextInput {...props} label={label} radius="sm" size="md" />;
}

export type AhTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: string;
  description?: string;
  minRows?: number;
  autosize?: boolean;
};

export function AhTextarea({
  label,
  description,
  minRows = 4,
  autosize: _autosize,
  ...props
}: AhTextareaProps) {
  return (
    <label className="ah-textarea-field">
      {label ? (
        <span className="ah-textarea-label">
          {label}
          {props.required ? <span aria-hidden="true"> *</span> : null}
        </span>
      ) : null}
      <textarea
        {...props}
        rows={minRows}
        className={`ah-textarea${props.className ? ` ${props.className}` : ''}`}
      />
      {description ? <span className="ah-textarea-description">{description}</span> : null}
    </label>
  );
}

export function AhDialog({
  open,
  title,
  description,
  onClose,
  children,
  actions,
  size = 560,
  fullScreen = false,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
  size?: number | string;
  fullScreen?: boolean;
}) {
  return (
    <Modal
      opened={open}
      onClose={onClose}
      title={title}
      size={size}
      fullScreen={fullScreen}
      centered
      closeButtonProps={{ 'aria-label': '关闭' }}
    >
      {description ? (
        <Text c="dimmed" size="sm" mb="md">
          {description}
        </Text>
      ) : null}
      {children}
      {actions ? (
        <Group justify="flex-end" mt="xl">
          {actions}
        </Group>
      ) : null}
    </Modal>
  );
}

export function AhDrawer({
  open,
  title,
  onClose,
  children,
  position = 'left',
  size,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  position?: 'left' | 'right' | 'top' | 'bottom';
  size?: number | string;
}) {
  return (
    <Drawer
      opened={open}
      onClose={onClose}
      title={title}
      position={position}
      {...(size === undefined ? {} : { size })}
    >
      {children}
    </Drawer>
  );
}

export function AhReveal({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      {...(reduced ? {} : { initial: { opacity: 0, y: 8 } })}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, delay: delay / 1000, ease: [0.2, 0.8, 0.2, 1] }}
    >
      {children}
    </motion.div>
  );
}

export function AhToastNotice({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose?: () => void;
}) {
  return (
    <Alert
      icon={<CheckCircleIcon size={18} />}
      color="green"
      variant="light"
      {...(onClose ? { withCloseButton: true, onClose } : {})}
    >
      {children}
    </Alert>
  );
}

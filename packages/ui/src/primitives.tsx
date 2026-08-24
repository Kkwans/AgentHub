import {
  Badge,
  Button,
  Group,
  Select,
  Stack,
  Switch,
  Text,
  Title,
  type ButtonProps,
  type SelectProps,
} from '@mantine/core';
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from 'react';

export type AhButtonProps = ButtonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'color' | 'style' | 'size'> & {
    children: ReactNode;
  };

export function AhButton({ children, ...props }: AhButtonProps) {
  return (
    <Button radius="md" {...props}>
      {children}
    </Button>
  );
}

export function AhSelect({ label, description, ...props }: SelectProps) {
  return (
    <Select label={label} description={description} searchable clearable radius="md" {...props} />
  );
}

export function AhSwitch({ label, description, ...props }: ComponentProps<typeof Switch>) {
  return <Switch label={label} description={description} color="aurora" {...props} />;
}

export interface AhChoiceOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export function AhChoiceSelect({
  options,
  onValueChange,
  ...props
}: Omit<SelectProps, 'data' | 'onChange'> & {
  label: string;
  options: AhChoiceOption[];
  onValueChange?: (value: string) => void;
}) {
  return (
    <AhSelect
      {...props}
      data={options.map((option) => ({
        value: option.value,
        label: option.description ? `${option.label} · ${option.description}` : option.label,
        ...(option.disabled === undefined ? {} : { disabled: option.disabled }),
      }))}
      onChange={(value) => {
        if (value !== null) onValueChange?.(value);
      }}
    />
  );
}

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
  UNKNOWN: '未知',
};

function statusColor(status: string): string {
  if (['READY', 'COMPLETED', 'DONE', 'ACTIVE', 'ONLINE'].includes(status)) return 'green';
  if (['RUNNING', 'IN_PROGRESS', 'REVIEW', 'WAITING_REVIEW', 'PENDING'].includes(status))
    return 'aurora';
  if (['BLOCKED', 'FAILED', 'BROKEN', 'REVOKED'].includes(status)) return 'red';
  if (['STOPPED', 'OFFLINE', 'DISCONNECTED', 'CANCELED'].includes(status)) return 'gray';
  return 'yellow';
}

export function AhStatusBadge({ status, label }: { status: string; label?: string }) {
  return (
    <Badge color={statusColor(status)} variant="light" radius="sm">
      {label ?? statusLabels[status] ?? '状态'}
    </Badge>
  );
}

export function AhPageHeader({
  title,
  description,
  eyebrow,
  actions,
}: {
  title: string;
  description?: string;
  eyebrow?: string;
  actions?: ReactNode;
}) {
  return (
    <Group align="flex-end" justify="space-between" gap="lg" wrap="wrap" className="ah-page-header">
      <Stack gap={4} maw={760}>
        {eyebrow ? (
          <Text size="xs" fw={700} tt="uppercase" c="dimmed" className="ah-page-eyebrow">
            {eyebrow}
          </Text>
        ) : null}
        <Title order={1}>{title}</Title>
        {description ? (
          <Text c="dimmed" size="md" maw={680}>
            {description}
          </Text>
        ) : null}
      </Stack>
      {actions ? <Group gap="sm">{actions}</Group> : null}
    </Group>
  );
}

import type { ReactNode } from 'react';
import {
  AlertTriangle,
  Badge,
  Box,
  Button,
  Callout,
  Flex,
  Heading,
  Inbox,
  RefreshCw,
  Skeleton,
  Text,
} from '@agenthub/ui';

const statusLabels: Record<string, string> = {
  READY: '就绪',
  RUNNING: '运行中',
  WAITING_APPROVAL: '等待批准',
  WAITING_REVIEW: '待审阅',
  STOPPED: '已停止',
  MISSING: '未安装',
  BROKEN: '异常',
  AUTH_REQUIRED: '需要授权',
  WORKSPACE_UNMAPPED: '工作区未映射',
  DISCONNECTED: '已断开',
  COMPLETED: '已完成',
  FAILED: '失败',
  CANCELED: '已取消',
  ACTIVE: '使用中',
  UNVERIFIED: '未验证',
  CLOSED: '已关闭',
  DRAFT: '草稿',
  ACHIEVED: '已达成',
  BACKLOG: '待规划',
  IN_PROGRESS: '进行中',
  DONE: '完成',
  BLOCKED: '受阻',
  QUEUED: '排队中',
  SETTING_UP: '创建工作区',
  AWAITING_INPUT: '等待输入',
  REVIEW: '待合并审阅',
  MERGING: '合并中',
  ONLINE: '在线',
  OFFLINE: '离线',
  REVOKED: '已撤销',
  AVAILABLE: '可用',
};

export function StatusBadge({ status }: { status: string }) {
  const color = /READY|COMPLETED|ACTIVE|DONE|ACHIEVED|ONLINE|AVAILABLE/.test(status)
    ? 'green'
    : /RUNNING|STARTING|SETTING_UP|MERGING/.test(status)
      ? 'blue'
      : /WAITING|AWAITING|REVIEW|QUEUED|AUTH_REQUIRED|UNVERIFIED|UNMAPPED/.test(status)
        ? 'orange'
        : /FAILED|BROKEN|MISSING|DISCONNECTED|BLOCKED|OFFLINE|REVOKED/.test(status)
          ? 'red'
          : 'gray';
  return (
    <Badge color={color} variant="soft">
      {statusLabels[status] ?? status}
    </Badge>
  );
}

export function PageIntro({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-intro">
      <Box>
        <Heading as="h2" size="7">
          {title}
        </Heading>
        <Text as="p" color="gray" size="3">
          {description}
        </Text>
      </Box>
      {action}
    </div>
  );
}

export function LoadingState({ label = '正在加载真实状态' }: { label?: string }) {
  return (
    <Flex className="state-panel compact" align="center" gap="3" role="status">
      <Skeleton height="18px" width="18px" />
      <Skeleton height="18px" width="168px">
        {label}
      </Skeleton>
    </Flex>
  );
}

export function ErrorState({ error, retry }: { error: Error; retry?: () => void }) {
  return (
    <Callout.Root className="state-panel" color="red" role="alert" size="2">
      <Callout.Icon>
        <AlertTriangle size={19} />
      </Callout.Icon>
      <Callout.Text>
        <strong>数据加载失败</strong>
        <span>{error.message || '服务暂时不可用，请稍后重试。'}</span>
      </Callout.Text>
      {retry && (
        <Button color="red" size="1" variant="soft" onClick={retry}>
          <RefreshCw size={15} /> 重试
        </Button>
      )}
    </Callout.Root>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-state-icon">
        <Inbox size={22} />
      </span>
      <Heading as="h3" size="3">
        {title}
      </Heading>
      <Text as="p" color="gray" size="2">
        {description}
      </Text>
      {action}
    </div>
  );
}

export function formatTime(value?: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

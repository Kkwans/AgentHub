/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  AhButton,
  AhDialog,
  AhEmptyState,
  AhErrorState,
  AhInput,
  AhLoadingState,
  AhMetric,
  AhReveal,
  AhSelect,
  AhStatusPill,
  AhSurface,
  AhSwitch,
  AhTextarea,
  AlertTriangle,
  ArrowRight,
  Bot,
  ChevronLeft,
  ChevronRight,
  CircleStop,
  Copy,
  Eye,
  FolderKanban,
  GitBranch,
  Link2,
  Network,
  Play,
  Plus,
  RefreshCw,
  Search,
  ScanSearch,
  Server,
  SquareTerminal,
  Tag,
  Wrench,
  useAgentHubTheme,
} from '@agenthub/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels';
import { useEffect, useMemo, useState } from 'react';
import {
  Link,
  NavLink,
  Outlet,
  useNavigate,
  useOutletContext,
  useParams,
  useSearchParams,
} from 'react-router-dom';

import type {
  AgentCandidateRecord,
  AgentRecord,
  ApiTokenRecord,
  ApprovalRecord,
  DashboardSnapshot,
  EventRecord,
  ExecutionTargetRecord,
  GoalRecord,
  MessageRecord,
  PromptBindingRecord,
  PromptLabelRecord,
  PromptRecord,
  PromptVersionRecord,
  ProjectRecord,
  ResolvedPromptContextRecord,
  RemoteNodeDiagnostics,
  RemoteNodeRecord,
  RemoteNodeRegistration,
  RuntimeCandidateRecord,
  RunRecord,
  SessionConfigurationRecord,
  SessionRecord,
  TaskRecord,
  WorktreeExecutionRecord,
} from '../../../lib/api';
import { api } from '../../../lib/api';
import { realtime } from '../../../lib/realtime';
import {
  labelPromptBindingTarget,
  labelPromptKind,
  labelPromptSelector,
  labelPromptType,
  labelPromptVersionSource,
} from '../../../presentation/domain-labels';
import layout from '../../shared/layout.module.css';
import {
  Screen,
  QueryMessage,
  displayDate,
  useCompactViewport,
  projectLanguage,
  projectTimestamp,
  domainStatusLabel,
  taskStateClass,
  sessionGroupKey,
} from '../../shared/page-primitives';
import projectsStyles from '../projects.module.css';
import { ProjectsPage } from './ProjectsPage';

export function CreateProjectPage() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const compact = useCompactViewport();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<'STANDARD' | 'TEST'>('STANDARD');
  const [targetId, setTargetId] = useState('');
  const [rootPath, setRootPath] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const targets = useQuery({
    queryKey: ['targets'],
    queryFn: () => api.get<ExecutionTargetRecord[]>('/execution-targets'),
  });
  const roots = useQuery({
    queryKey: ['filesystem-roots', targetId],
    queryFn: () =>
      api.get<Array<{ rootId: string; label: string; path: string }>>(
        `/execution-targets/${targetId}/filesystem/roots`,
      ),
    enabled: Boolean(targetId),
  });
  useEffect(() => {
    if (!targetId && targets.data?.[0]) setTargetId(targets.data[0].id);
  }, [targetId, targets.data]);
  useEffect(() => {
    if (roots.data?.[0] && !rootPath) setRootPath(roots.data[0].path);
  }, [rootPath, roots.data]);
  const preflight = useQuery({
    queryKey: ['project-preflight', targetId, rootPath],
    queryFn: () =>
      api.post<{
        status: 'READY' | 'BROKEN';
        checks: Array<{ id: string; status: string; message: string }>;
      }>('/projects/preflight', { targetId, rootPath }),
    enabled: Boolean(targetId && rootPath),
    staleTime: 2_000,
  });
  const create = useMutation({
    mutationFn: () =>
      api.post<ProjectRecord>('/projects', {
        name: name.trim(),
        description: description.trim() || undefined,
        targetId,
        rootPath,
        kind,
      }),
    onSuccess: (project) => {
      void client.invalidateQueries({ queryKey: ['projects'] });
      navigate(`/projects/${project.id}/overview`);
    },
  });
  const close = () => navigate('/projects');
  return (
    <>
      <ProjectsPage />
      <AhDialog
        open
        onClose={close}
        title="创建项目"
        description="从 AgentHub 已授权的目录中选择工程。路径来自运行环境，不接受越权手工输入。"
        size={820}
        fullScreen={compact}
        actions={
          <>
            <AhButton variant="default" onClick={close}>
              取消
            </AhButton>
            <AhButton
              onClick={() => create.mutate()}
              loading={create.isPending}
              disabled={
                !name.trim() || !targetId || !rootPath || preflight.data?.status !== 'READY'
              }
            >
              预检并创建
            </AhButton>
          </>
        }
      >
        <div className={layout.dialogBody} data-testid="create-project-dialog">
          <div className={layout.dialogIntro}>
            <span className={layout.dialogStep}>1</span>
            <div>
              <strong>选择 Project 目录</strong>
              <p>先确认运行环境和可访问根目录，AgentHub 会自动识别 Git 与工作区信息。</p>
            </div>
          </div>
          <div className={layout.fieldGrid}>
            <AhSelect
              label="运行环境"
              value={targetId}
              onChange={(value) => {
                setTargetId(value ?? '');
                setRootPath('');
              }}
              data={(targets.data ?? []).map((target) => ({
                value: target.id,
                label: `${target.name} · ${target.os}/${target.arch}`,
              }))}
              placeholder="选择运行环境"
            />
            <AhSelect
              label="允许目录"
              value={rootPath}
              onChange={(value) => {
                setRootPath(value ?? '');
                if (!name && value) setName(value.split('/').filter(Boolean).at(-1) ?? '');
              }}
              data={(roots.data ?? []).map((root) => ({
                value: root.path,
                label: `${root.label} · ${root.path}`,
              }))}
              placeholder={roots.isLoading ? '正在读取目录' : '选择目录'}
              disabled={!targetId || roots.isLoading}
            />
          </div>
          <div className={layout.dialogSection}>
            <div className={layout.dialogIntro}>
              <span className={layout.dialogStep}>2</span>
              <div>
                <strong>确认 Project 身份</strong>
                <p>名称默认取目录名，可按团队习惯调整。</p>
              </div>
            </div>
            <div className={layout.fieldGrid}>
              <AhInput
                label="项目名称"
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
                placeholder="例如 AgentHub"
                required
              />
              <AhTextarea
                label="项目说明（可选）"
                value={description}
                onChange={(event) => setDescription(event.currentTarget.value)}
                placeholder="描述这个工程的用途"
                minRows={3}
              />
              <AhSelect
                label="项目类型"
                value={kind}
                onChange={(value) => setKind((value ?? 'STANDARD') as 'STANDARD' | 'TEST')}
                data={[
                  { value: 'STANDARD', label: '正式 Project' },
                  { value: 'TEST', label: '测试 Project（不进入 Home 主流）' },
                ]}
              />
            </div>
          </div>
          <div className={layout.mutedBox}>
            <strong>
              {preflight.isFetching
                ? '正在运行 Project preflight…'
                : preflight.data?.status === 'READY'
                  ? '目录可以使用'
                  : preflight.data
                    ? '目录需要处理'
                    : '选择目录后会自动运行 Project preflight'}
            </strong>
            {preflight.data ? (
              <div className={layout.checkList}>
                {preflight.data.checks.map((check) => (
                  <div key={check.id}>
                    <span aria-hidden="true">{check.status === 'PASS' ? '✓' : '·'}</span>
                    {check.message}
                  </div>
                ))}
              </div>
            ) : null}
            {preflight.error ? (
              <div className={layout.dialogError}>{preflight.error.message}</div>
            ) : null}
          </div>
          <details
            open={advancedOpen}
            onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
            className={layout.dialogDetails}
          >
            <summary>高级设置</summary>
            <p>
              Runtime、mount、worktree 和 Git 行为沿用当前执行环境的安全默认值。需要修改时请先完成
              Project 创建，再从项目设置进入。
            </p>
          </details>
          {create.error ? <AhErrorState description={create.error.message} /> : null}
        </div>
      </AhDialog>
    </>
  );
}

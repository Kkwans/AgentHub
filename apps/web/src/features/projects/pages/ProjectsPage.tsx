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

export function ProjectsPage() {
  const projects = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<ProjectRecord[]>('/projects'),
  });
  const tasks = useQuery({ queryKey: ['tasks'], queryFn: () => api.get<TaskRecord[]>('/tasks') });
  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api.get<SessionRecord[]>('/sessions'),
  });
  const agents = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.get<AgentRecord[]>('/agents'),
  });
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [language, setLanguage] = useState('all');
  const [kind, setKind] = useState<'all' | 'STANDARD' | 'TEST'>('all');
  const [sort, setSort] = useState('updated');
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const allProjects = projects.data ?? [];
  const statusOptions = useMemo(
    () => Array.from(new Set(allProjects.map((project) => project.status))).filter(Boolean),
    [allProjects],
  );
  const languageOptions = useMemo(
    () =>
      Array.from(
        new Set(
          allProjects.map(projectLanguage).filter((value): value is string => Boolean(value)),
        ),
      ),
    [allProjects],
  );
  const kindOptions = [
    { value: 'all', label: '全部类型' },
    { value: 'STANDARD', label: '正式 Project' },
    { value: 'TEST', label: '测试 Project' },
  ];
  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase();
    const result = allProjects.filter((project) => {
      const languageValue = projectLanguage(project);
      const searchable =
        `${project.name} ${project.description ?? ''} ${project.rootPath} ${project.realRootPath}`.toLowerCase();
      return (
        (!value || searchable.includes(value)) &&
        (status === 'all' || project.status === status) &&
        (language === 'all' || languageValue === language) &&
        (kind === 'all' || (project.kind ?? 'STANDARD') === kind)
      );
    });
    return [...result].sort((left, right) => {
      if (sort === 'name') return left.name.localeCompare(right.name, 'zh-CN');
      if (sort === 'status')
        return domainStatusLabel(left.status).localeCompare(
          domainStatusLabel(right.status),
          'zh-CN',
        );
      const leftTime = Date.parse(projectTimestamp(left) ?? '');
      const rightTime = Date.parse(projectTimestamp(right) ?? '');
      if (!Number.isNaN(leftTime) || !Number.isNaN(rightTime))
        return (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime);
      return left.name.localeCompare(right.name, 'zh-CN');
    });
  }, [allProjects, kind, language, query, sort, status]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  useEffect(() => {
    setPage(1);
  }, [kind, language, pageSize, query, sort, status, view]);
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);
  const visibleProjects = filtered.slice((page - 1) * pageSize, page * pageSize);
  const projectInitial = (project: ProjectRecord) =>
    project.name.trim().slice(0, 1).toUpperCase() || 'P';
  const readyAgentCount = agents.data
    ? agents.data.filter((agent) => agent.enabled && agent.status === 'READY').length
    : null;
  const projectRows = visibleProjects.map((project, index) => {
    const languageValue = projectLanguage(project);
    const timestamp = projectTimestamp(project);
    const repoLabel = project.repoKind === 'GIT' ? 'Git' : project.repoKind ? '目录' : undefined;
    const activeWorkCount = tasks.data
      ? tasks.data.filter(
          (task) => task.projectId === project.id && !['DONE', 'CANCELED'].includes(task.status),
        ).length
      : null;
    const latestSession = (sessions.data ?? [])
      .filter((session) => session.projectId === project.id)
      .sort((left, right) => Date.parse(right.lastActiveAt) - Date.parse(left.lastActiveAt))[0];
    return (
      <div className={projectsStyles.projectRow} key={project.id}>
        <Link className={projectsStyles.projectIdentity} to={`/projects/${project.id}/overview`}>
          <span
            className={`${projectsStyles.entityLogo} ${index % 3 === 1 ? projectsStyles.entityLogoAlt : index % 3 === 2 ? projectsStyles.entityLogoNeutral : ''}`}
            aria-hidden="true"
          >
            {projectInitial(project)}
          </span>
          <span className={projectsStyles.projectMain}>
            <strong className={projectsStyles.projectTitle}>{project.name}</strong>
            {project.description ? (
              <span className={projectsStyles.projectDescription}>{project.description}</span>
            ) : null}
            <span className={projectsStyles.projectMeta}>
              {repoLabel ? <span>{repoLabel}</span> : null}
              {languageValue ? <span>{languageValue}</span> : null}
              {project.rootPath ? <span title={project.rootPath}>{project.rootPath}</span> : null}
            </span>
          </span>
        </Link>
        <span className={projectsStyles.projectBranch} title={latestSession?.branch ?? undefined}>
          {latestSession?.branch ?? (sessions.data && project.repoKind === 'GIT' ? 'main' : '—')}
        </span>
        <span className={projectsStyles.projectMetric}>
          <strong>{activeWorkCount ?? '—'}</strong>
          <small>进行中</small>
        </span>
        <span className={projectsStyles.projectMetric}>
          <strong>{readyAgentCount ?? '—'}</strong>
          <small>可用</small>
        </span>
        <span className={projectsStyles.projectActivity}>
          <strong>{displayDate(latestSession?.lastActiveAt ?? timestamp)}</strong>
          <small>最近活动</small>
        </span>
        <Link
          className={projectsStyles.projectEdit}
          to={`/projects/${project.id}/overview?edit=kind`}
          aria-label={`编辑 ${project.name} 类型`}
        >
          编辑类型
        </Link>
      </div>
    );
  });
  const projectCards = visibleProjects.map((project, index) => {
    const languageValue = projectLanguage(project);
    const timestamp = projectTimestamp(project);
    return (
      <Link
        className={projectsStyles.projectCard}
        key={project.id}
        to={`/projects/${project.id}/overview`}
      >
        <span className={projectsStyles.projectCardHeader}>
          <span
            className={`${projectsStyles.entityLogo} ${index % 3 === 1 ? projectsStyles.entityLogoAlt : index % 3 === 2 ? projectsStyles.entityLogoNeutral : ''}`}
            aria-hidden="true"
          >
            {projectInitial(project)}
          </span>
          <span className={projectsStyles.rowMain}>
            <strong className={projectsStyles.projectTitle}>{project.name}</strong>
            <span className={projectsStyles.projectMeta}>
              {project.repoKind === 'GIT' ? 'Git' : project.repoKind ? '目录' : null}
              {languageValue ? ` · ${languageValue}` : ''}
            </span>
          </span>
          <AhStatusPill status={project.status} />
        </span>
        <span className={projectsStyles.projectDescription}>
          {project.description ?? '暂无项目说明。'}
        </span>
        <span className={projectsStyles.projectCardFooter}>
          <span title={project.rootPath}>{project.rootPath}</span>
          {timestamp ? <span>{displayDate(timestamp)}</span> : null}
        </span>
      </Link>
    );
  });
  return (
    <Screen
      eyebrow="Projects"
      title="项目"
      description="管理你的代码项目，在隔离的工作区中与 Agent 一起开发。"
      actions={
        <Link to="/projects/new">
          <AhButton leftSection={<Plus size={16} />}>新建项目</AhButton>
        </Link>
      }
    >
      <div className={projectsStyles.projectsPage}>
        <QueryMessage
          loading={projects.isLoading}
          error={projects.error}
          retry={() => void projects.refetch()}
          label="正在加载项目"
        />
        {!projects.isLoading && !projects.error ? (
          <>
            <div className={projectsStyles.projectsToolbar} aria-label="项目筛选">
              <div className={projectsStyles.toolbarSearch}>
                <AhInput
                  label=""
                  aria-label="搜索项目"
                  placeholder="搜索项目名称、说明或路径"
                  value={query}
                  onChange={(event) => setQuery(event.currentTarget.value)}
                  leftSection={<Search size={16} />}
                />
              </div>
              <div className={projectsStyles.toolbarSelect}>
                <AhSelect
                  aria-label="项目状态"
                  label=""
                  value={status}
                  onChange={(value) => setStatus(value ?? 'all')}
                  data={[
                    { value: 'all', label: '全部状态' },
                    ...statusOptions.map((value) => ({ value, label: domainStatusLabel(value) })),
                  ]}
                />
              </div>
              {languageOptions.length ? (
                <div className={projectsStyles.toolbarSelect}>
                  <AhSelect
                    aria-label="项目语言"
                    label=""
                    value={language}
                    onChange={(value) => setLanguage(value ?? 'all')}
                    data={[
                      { value: 'all', label: '全部语言' },
                      ...languageOptions.map((value) => ({ value, label: value })),
                    ]}
                  />
                </div>
              ) : null}
              <div className={projectsStyles.toolbarSelect}>
                <AhSelect
                  aria-label="项目类型"
                  label=""
                  value={kind}
                  onChange={(value) => setKind((value ?? 'all') as 'all' | 'STANDARD' | 'TEST')}
                  data={kindOptions}
                />
              </div>
              <div className={projectsStyles.toolbarSelect}>
                <AhSelect
                  aria-label="项目排序"
                  label=""
                  value={sort}
                  onChange={(value) => setSort(value ?? 'updated')}
                  data={[
                    { value: 'updated', label: '最新更新' },
                    { value: 'name', label: '名称 A-Z' },
                    { value: 'status', label: '状态' },
                  ]}
                />
              </div>
              <span className={projectsStyles.toolbarSpacer} />
              <div className={projectsStyles.segmented} role="group" aria-label="项目视图">
                <button
                  type="button"
                  className={`${projectsStyles.segmentedButton} ${view === 'grid' ? projectsStyles.segmentedButtonActive : ''}`}
                  aria-pressed={view === 'grid'}
                  onClick={() => setView('grid')}
                >
                  卡片
                </button>
                <button
                  type="button"
                  className={`${projectsStyles.segmentedButton} ${view === 'list' ? projectsStyles.segmentedButtonActive : ''}`}
                  aria-pressed={view === 'list'}
                  onClick={() => setView('list')}
                >
                  列表
                </button>
              </div>
              <span className={projectsStyles.toolbarCount}>{filtered.length} 个项目</span>
            </div>
            {filtered.length ? (
              view === 'list' ? (
                <section className={projectsStyles.projectList} aria-label="项目列表">
                  <div className={projectsStyles.projectListHeader} aria-hidden="true">
                    <span>项目</span>
                    <span>分支</span>
                    <span>工作</span>
                    <span>Agent</span>
                    <span>最近活动</span>
                    <span>操作</span>
                  </div>
                  {projectRows}
                </section>
              ) : (
                <div className={projectsStyles.projectCardGrid}>{projectCards}</div>
              )
            ) : (
              <AhSurface className={projectsStyles.emptyPanel}>
                <AhEmptyState
                  title={
                    query || status !== 'all' || language !== 'all' || kind !== 'all'
                      ? '没有匹配的项目'
                      : '还没有项目'
                  }
                  description={
                    query || status !== 'all' || language !== 'all' || kind !== 'all'
                      ? '尝试调整筛选条件。'
                      : '从允许访问的目录创建第一个 Project。'
                  }
                  action={
                    !query && status === 'all' && language === 'all' && kind === 'all' ? (
                      <Link to="/projects/new">
                        <AhButton>创建项目</AhButton>
                      </Link>
                    ) : undefined
                  }
                />
              </AhSurface>
            )}
            {filtered.length && pageCount > 1 ? (
              <footer className={projectsStyles.listFooter}>
                <span>
                  第 {page} / {pageCount} 页 · 共 {filtered.length} 个项目
                </span>
                <span className={projectsStyles.pagination}>
                  <button
                    type="button"
                    className={projectsStyles.paginationButton}
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    disabled={page === 1}
                    aria-label="上一页"
                  >
                    ‹
                  </button>
                  {Array.from({ length: pageCount }, (_, index) => index + 1).map((value) => (
                    <button
                      type="button"
                      className={`${projectsStyles.paginationButton} ${value === page ? projectsStyles.paginationButtonActive : ''}`}
                      key={value}
                      onClick={() => setPage(value)}
                      aria-label={`第 ${value} 页`}
                      aria-current={value === page ? 'page' : undefined}
                    >
                      {value}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={projectsStyles.paginationButton}
                    onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
                    disabled={page === pageCount}
                    aria-label="下一页"
                  >
                    ›
                  </button>
                  <AhSelect
                    aria-label="每页数量"
                    label=""
                    value={String(pageSize)}
                    onChange={(value) => setPageSize(Number(value ?? 10))}
                    data={[
                      { value: '10', label: '10 条/页' },
                      { value: '20', label: '20 条/页' },
                    ]}
                  />
                </span>
              </footer>
            ) : null}
          </>
        ) : null}
      </div>
    </Screen>
  );
}

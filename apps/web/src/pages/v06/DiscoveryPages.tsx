import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import {
  AdvancedSection,
  Archive,
  ArrowRight,
  Button,
  ChevronLeft,
  CheckCircle2,
  FormDialog,
  ConfirmDialog,
  FormTextArea,
  FormTextField,
  FolderGit2,
  Play,
  Plus,
  Pencil,
  RefreshCw,
  SelectField,
  SectionHeader,
  Settings,
  Badge,
  Bot,
} from '@agenthub/ui';

import type {
  AgentCandidateRecord,
  AgentRecord,
  DirectoryListingRecord,
  ExecutionTargetRecord,
  ProjectCandidateRecord,
  ProjectRecord,
  RuntimeCandidateRecord,
  WorkspaceRootRecord,
} from '../../lib/api';
import { api } from '../../lib/api';
import {
  labelAgentKind,
  labelAdapterKind,
  labelDiscoveryStatus,
  labelExecutionTargetKind,
  labelProjectStatus,
  labelRuntimeStatus,
} from '../../presentation/domain-labels';
import {
  EmptyState as LegacyEmptyState,
  ErrorState,
  InlineError,
  LoadingState,
} from '../../components/Common';

interface ProjectFormValues {
  name: string;
  description: string;
  targetId: string;
}

interface ProjectPreflightRecord {
  status: 'READY' | 'BROKEN';
  checks: Array<{ id: string; status: 'PASS' | 'WARN' | 'FAIL'; message: string }>;
}

export function ProjectsDiscoveryPage() {
  const client = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<ProjectRecord | null>(null);
  const [archiveProject, setArchiveProject] = useState<ProjectRecord | null>(null);
  const projects = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<ProjectRecord[]>('/projects'),
  });
  const targets = useQuery({
    queryKey: ['targets'],
    queryFn: () => api.get<ExecutionTargetRecord[]>('/execution-targets'),
  });
  const form = useForm<ProjectFormValues>({
    defaultValues: { name: '', description: '', targetId: '' },
  });
  const targetId = form.watch('targetId');
  const [selectedRoot, setSelectedRoot] = useState<WorkspaceRootRecord | undefined>();
  const [selectedPath, setSelectedPath] = useState('');
  const roots = useQuery({
    queryKey: ['filesystem-roots', targetId],
    queryFn: () =>
      api.get<WorkspaceRootRecord[]>(`/execution-targets/${targetId}/filesystem/roots`),
    enabled: dialogOpen && Boolean(targetId),
  });
  const listing = useQuery({
    queryKey: ['filesystem-directories', targetId, selectedRoot?.rootId, selectedPath],
    queryFn: () =>
      api.get<DirectoryListingRecord>(
        `/execution-targets/${targetId}/filesystem/directories?root=${encodeURIComponent(selectedRoot?.rootId ?? '')}&path=${encodeURIComponent(selectedPath)}`,
      ),
    enabled: dialogOpen && Boolean(targetId && selectedRoot),
  });
  const candidates = useQuery({
    queryKey: ['project-candidates', targetId, selectedRoot?.rootId],
    queryFn: () =>
      api.get<ProjectCandidateRecord[]>(
        `/execution-targets/${targetId}/project-candidates?root=${encodeURIComponent(selectedRoot?.rootId ?? '')}`,
      ),
    enabled: dialogOpen && Boolean(targetId && selectedRoot),
  });
  const selectedTarget = targets.data?.find((target) => target.id === targetId);
  const pathPreflight = useQuery({
    queryKey: ['project-preflight-path', targetId, selectedPath],
    queryFn: () =>
      api.post<ProjectPreflightRecord>('/projects/preflight-path', { rootPath: selectedPath }),
    enabled:
      dialogOpen &&
      Boolean(selectedPath) &&
      (selectedTarget?.kind === 'LOCAL_HOST' || selectedTarget?.kind === 'DOCKER_CONTAINER'),
    staleTime: 2_000,
  });
  const addProject = useMutation({
    mutationFn: (values: ProjectFormValues & { rootPath: string }) =>
      api.post<ProjectRecord>('/projects', values),
    onSuccess: () => {
      setDialogOpen(false);
      form.reset();
      void client.invalidateQueries({ queryKey: ['projects'] });
    },
  });
  const editForm = useForm<{ name: string; description: string }>({
    defaultValues: { name: '', description: '' },
  });
  const updateProject = useMutation({
    mutationFn: (values: { name: string; description: string }) =>
      api.patch<ProjectRecord>(`/projects/${editingProject?.id ?? ''}`, {
        name: values.name,
        description: values.description || null,
      }),
    onSuccess: () => {
      setEditingProject(null);
      void client.invalidateQueries({ queryKey: ['projects'] });
    },
  });
  const archive = useMutation({
    mutationFn: (projectId: string) => api.post<ProjectRecord>(`/projects/${projectId}/archive`),
    onSuccess: () => {
      setArchiveProject(null);
      void client.invalidateQueries({ queryKey: ['projects'] });
    },
  });

  useEffect(() => {
    if (!dialogOpen) return;
    const firstTarget = targets.data?.[0];
    if (!form.getValues('targetId') && firstTarget) form.setValue('targetId', firstTarget.id);
  }, [dialogOpen, form, targets.data]);

  useEffect(() => {
    const root = roots.data?.[0];
    setSelectedRoot(root);
    setSelectedPath(root?.path ?? '');
  }, [roots.data]);

  useEffect(() => {
    if (!editingProject) return;
    editForm.reset({
      name: editingProject.name,
      description: editingProject.description ?? '',
    });
  }, [editForm, editingProject]);

  const targetOptions = useMemo(
    () =>
      (targets.data ?? []).map((target) => ({
        value: target.id,
        label: target.name,
        description: `${labelExecutionTargetKind(target.kind)} · ${labelRuntimeStatus(target.status)}`,
      })),
    [targets.data],
  );

  return (
    <div className="v06-page">
      <header className="v06-page-header">
        <div>
          <span className="v06-eyebrow">PROJECT</span>
          <h1>项目</h1>
          <p>从可用目录中选择工程，AgentHub 会自动完成 Git、规则文件和权限预检。</p>
        </div>
        <Button onClick={() => setDialogOpen(true)} disabled={!targets.data?.length}>
          <Plus size={16} /> 添加项目
        </Button>
      </header>

      {projects.isLoading ? <LoadingState label="正在加载项目" /> : null}
      {projects.error ? (
        <ErrorState error={projects.error} retry={() => void projects.refetch()} />
      ) : null}
      {!projects.isLoading && !projects.error && !projects.data?.length ? (
        <LegacyEmptyState
          title="还没有项目"
          description={
            targets.data?.length
              ? '点击“添加项目”，从目录选择器中选择一个工程。'
              : '请先在 Agent 页面接入一个运行环境。'
          }
          action={
            targets.data?.length ? (
              <Button onClick={() => setDialogOpen(true)}>添加第一个项目</Button>
            ) : undefined
          }
        />
      ) : null}
      {projects.data?.length ? (
        <section className="v06-panel">
          <SectionHeader
            title="已接入的项目"
            description="项目目录只读浏览；Agent 的修改通过自身工具完成。"
          />
          <div className="v06-record-list">
            {projects.data.map((project) => (
              <article className="v06-record" key={project.id}>
                <div className="v06-record-icon">
                  <FolderGit2 size={20} />
                </div>
                <div className="v06-record-main">
                  <strong>{project.name}</strong>
                  <span>{project.description || '暂无说明'}</span>
                  <code title={project.realRootPath}>{project.realRootPath}</code>
                </div>
                <div className="v06-record-meta">
                  <Badge color={project.repoKind === 'GIT' ? 'green' : 'gray'}>
                    {project.repoKind === 'GIT' ? 'Git' : '非 Git'}
                  </Badge>
                  <Badge color={project.status === 'ACTIVE' ? 'green' : 'gray'}>
                    {labelProjectStatus(project.status)}
                  </Badge>
                </div>
                <Link
                  className="v06-record-action"
                  to={`/sessions?projectId=${encodeURIComponent(project.id)}&new=1`}
                >
                  开始会话 <ArrowRight size={15} />
                </Link>
                <div className="v06-record-secondary-actions">
                  <Button
                    type="button"
                    size="2"
                    variant="ghost"
                    color="gray"
                    onClick={() => setEditingProject(project)}
                    aria-label={`编辑 ${project.name}`}
                  >
                    <Pencil size={15} /> 编辑
                  </Button>
                  {project.status === 'ACTIVE' ? (
                    <Button
                      type="button"
                      size="2"
                      variant="ghost"
                      color="gray"
                      onClick={() => setArchiveProject(project)}
                      aria-label={`归档 ${project.name}`}
                    >
                      <Archive size={15} /> 归档
                    </Button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <FormDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            form.reset();
            setSelectedRoot(undefined);
            setSelectedPath('');
          }
        }}
        title="添加项目"
        description="选择 AgentHub 可以访问的目录。路径由目录选择器提供，不能手动输入。"
        size="large"
        footer={
          <>
            <Button type="button" variant="soft" color="gray" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button
              type="submit"
              form="v06-add-project-form"
              disabled={
                addProject.isPending ||
                pathPreflight.isLoading ||
                pathPreflight.data?.status !== 'READY' ||
                !selectedPath ||
                !form.watch('name') ||
                !targetId
              }
              loading={addProject.isPending}
            >
              预检并添加
            </Button>
          </>
        }
      >
        <form
          id="v06-add-project-form"
          className="v06-form"
          onSubmit={form.handleSubmit((values) => {
            if (!selectedPath) return;
            addProject.mutate({ ...values, rootPath: selectedPath });
          })}
        >
          <FormTextField
            label="项目名称"
            id="v06-project-name"
            placeholder="例如 AgentHub"
            required
            {...form.register('name')}
          />
          <SelectField
            label="运行环境"
            id="v06-project-target"
            value={targetId}
            options={targetOptions}
            onValueChange={(value) => {
              form.setValue('targetId', value, { shouldValidate: true });
              setSelectedRoot(undefined);
              setSelectedPath('');
            }}
            required
            placeholder="请选择运行环境"
          />
          <PathPicker
            roots={roots.data ?? []}
            listing={listing.data}
            candidates={candidates.data ?? []}
            selectedRoot={selectedRoot}
            selectedPath={selectedPath}
            onRootChange={(root) => {
              setSelectedRoot(root);
              setSelectedPath(root.path);
            }}
            onPathChange={setSelectedPath}
          />
          {selectedPath ? (
            <ProjectPreflightSummary
              report={pathPreflight.data}
              loading={pathPreflight.isLoading}
              error={pathPreflight.error}
            />
          ) : null}
          <AdvancedSection title="补充说明" description="可选，不影响项目目录预检。">
            <FormTextArea
              label="项目说明"
              id="v06-project-description"
              placeholder="例如：AgentHub v0.6 主工程"
              {...form.register('description')}
            />
          </AdvancedSection>
          {addProject.error ? <InlineError error={addProject.error} title="项目添加失败" /> : null}
        </form>
      </FormDialog>

      <FormDialog
        open={Boolean(editingProject)}
        onOpenChange={(open) => {
          if (!open) {
            setEditingProject(null);
            updateProject.reset();
          }
        }}
        title="编辑项目"
        description="名称和说明可以修改；项目目录与运行环境保持不变。"
        footer={
          <>
            <Button
              type="button"
              variant="soft"
              color="gray"
              onClick={() => setEditingProject(null)}
            >
              取消
            </Button>
            <Button
              type="submit"
              form="v06-edit-project-form"
              loading={updateProject.isPending}
              disabled={updateProject.isPending || !editForm.watch('name').trim()}
            >
              保存修改
            </Button>
          </>
        }
      >
        <form
          id="v06-edit-project-form"
          className="v06-form"
          onSubmit={editForm.handleSubmit((values) => updateProject.mutate(values))}
        >
          <FormTextField
            label="项目名称"
            id="v06-edit-project-name"
            required
            {...editForm.register('name')}
          />
          <FormTextArea
            label="项目说明"
            id="v06-edit-project-description"
            {...editForm.register('description')}
          />
          {updateProject.error ? (
            <InlineError error={updateProject.error} title="项目保存失败" />
          ) : null}
        </form>
      </FormDialog>

      <ConfirmDialog
        open={Boolean(archiveProject)}
        onOpenChange={(open) => {
          if (!open) {
            setArchiveProject(null);
            archive.reset();
          }
        }}
        title="归档项目？"
        description={`归档后不会删除文件，但新的 Session 将无法使用“${archiveProject?.name ?? ''}”。你可以保留历史记录。`}
        confirmLabel="归档项目"
        destructive
        pending={archive.isPending}
        onConfirm={() => {
          if (archiveProject) archive.mutate(archiveProject.id);
        }}
      />
    </div>
  );
}

function PathPicker({
  roots,
  listing,
  candidates,
  selectedRoot,
  selectedPath,
  onRootChange,
  onPathChange,
}: {
  roots: WorkspaceRootRecord[];
  listing: DirectoryListingRecord | undefined;
  candidates: ProjectCandidateRecord[];
  selectedRoot: WorkspaceRootRecord | undefined;
  selectedPath: string;
  onRootChange: (root: WorkspaceRootRecord) => void;
  onPathChange: (path: string) => void;
}) {
  return (
    <div className="v06-picker">
      <div className="v06-picker-heading">
        <div>
          <strong>项目目录</strong>
          <span>选择包含 Git 或 package manager 文件的目录</span>
        </div>
        {selectedRoot ? (
          <Badge color="gray">
            {selectedRoot.source === 'DOCKER_MOUNT' ? '容器映射' : '允许目录'}
          </Badge>
        ) : null}
      </div>
      {roots.length ? (
        <SelectField
          label="目录范围"
          id="v06-project-root"
          {...(selectedRoot?.rootId ? { value: selectedRoot.rootId } : {})}
          options={roots.map((root) => ({
            value: root.rootId,
            label: root.label,
            description: root.source === 'DOCKER_MOUNT' ? '来自 Docker 映射' : '来自 AgentHub 设置',
          }))}
          onValueChange={(value) => {
            const root = roots.find((item) => item.rootId === value);
            if (root) onRootChange(root);
          }}
        />
      ) : (
        <div className="v06-inline-state">正在读取可用目录…</div>
      )}
      <div className="v06-picker-current">
        <code>{selectedPath || '请选择目录'}</code>
        {listing && selectedPath !== selectedRoot?.path ? (
          <Button
            type="button"
            variant="ghost"
            color="gray"
            onClick={() => onPathChange(selectedRoot?.path ?? '')}
          >
            <ChevronLeft size={15} /> 返回根目录
          </Button>
        ) : null}
      </div>
      {listing ? (
        <div className="v06-directory-list">
          {listing.entries
            .filter((entry) => entry.type === 'DIRECTORY' && entry.accessible)
            .map((entry) => (
              <button type="button" key={entry.path} onClick={() => onPathChange(entry.path)}>
                <FolderGit2 size={16} /> {entry.name}
              </button>
            ))}
          {!listing.entries.some((entry) => entry.type === 'DIRECTORY' && entry.accessible) ? (
            <span>当前目录没有可进入的子目录。</span>
          ) : null}
        </div>
      ) : null}
      <div className="v06-project-candidates">
        <span className="v06-subheading">检测到的工程</span>
        {candidates.length ? (
          candidates.slice(0, 8).map((candidate) => (
            <button
              type="button"
              className={candidate.rootPath === selectedPath ? 'selected' : ''}
              key={candidate.rootPath}
              onClick={() => onPathChange(candidate.rootPath)}
            >
              <span>
                <strong>{candidate.name}</strong>
                <small>{candidate.relativePath}</small>
              </span>
              <CheckCircle2 size={16} />
            </button>
          ))
        ) : (
          <span>向下浏览目录后，符合条件的工程会显示在这里。</span>
        )}
      </div>
    </div>
  );
}

function ProjectPreflightSummary({
  report,
  loading,
  error,
}: {
  report: ProjectPreflightRecord | undefined;
  loading: boolean;
  error: Error | null;
}) {
  return (
    <section className="v06-preflight-summary" aria-live="polite">
      <div className="v06-picker-heading">
        <div>
          <strong>添加前检查</strong>
          <span>确认目录可读写，并读取 Git 与工程标记。</span>
        </div>
        {loading ? <Badge color="gray">检查中</Badge> : null}
        {!loading && report ? (
          <Badge color={report.status === 'READY' ? 'green' : 'red'}>
            {report.status === 'READY' ? '可以添加' : '需要处理'}
          </Badge>
        ) : null}
      </div>
      {error ? <InlineError error={error} title="目录检查失败" /> : null}
      {!loading && !error && report ? (
        <ul>
          {report.checks.map((check) => (
            <li key={check.id} data-status={check.status}>
              <span aria-hidden>
                {check.status === 'FAIL' ? '!' : check.status === 'WARN' ? '·' : '✓'}
              </span>
              {check.message}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export function AgentsDiscoveryPage() {
  const client = useQueryClient();
  const runtimes = useQuery({
    queryKey: ['discovery-runtimes'],
    queryFn: () => api.get<RuntimeCandidateRecord[]>('/discovery/runtimes'),
  });
  const agents = useQuery({
    queryKey: ['discovery-agents'],
    queryFn: () => api.get<AgentCandidateRecord[]>('/discovery/agents'),
  });
  const registered = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.get<AgentRecord[]>('/agents'),
  });
  const [defaultsAgent, setDefaultsAgent] = useState<AgentRecord | null>(null);
  const [defaultModel, setDefaultModel] = useState('');
  const [defaultMode, setDefaultMode] = useState('');
  const rescan = useMutation({
    mutationFn: () => api.post('/discovery/agents/rescan'),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['discovery-agents'] });
      void client.invalidateQueries({ queryKey: ['discovery-runtimes'] });
      void client.invalidateQueries({ queryKey: ['agents'] });
      void client.invalidateQueries({ queryKey: ['targets'] });
    },
  });
  const adoptRuntime = useMutation({
    mutationFn: (candidateId: string) =>
      api.post(`/discovery/runtimes/${encodeURIComponent(candidateId)}/adopt`),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['discovery-runtimes'] });
      void client.invalidateQueries({ queryKey: ['discovery-agents'] });
      void client.invalidateQueries({ queryKey: ['targets'] });
    },
  });
  const adoptAgent = useMutation({
    mutationFn: (candidateId: string) =>
      api.post(`/discovery/agents/${encodeURIComponent(candidateId)}/adopt`),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['discovery-agents'] });
      void client.invalidateQueries({ queryKey: ['agents'] });
    },
  });
  const lifecycle = useMutation({
    mutationFn: ({ targetId, action }: { targetId: string; action: 'start' | 'stop' }) =>
      api.post(`/execution-targets/${targetId}/${action}`),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['discovery-runtimes'] });
      void client.invalidateQueries({ queryKey: ['targets'] });
    },
  });
  const updateDefaults = useMutation({
    mutationFn: (values: { defaultModel: string | null; defaultMode: string | null }) =>
      api.patch<AgentRecord>(`/agents/${defaultsAgent?.id ?? ''}`, values),
    onSuccess: () => {
      setDefaultsAgent(null);
      void client.invalidateQueries({ queryKey: ['agents'] });
    },
  });

  const readyAgents = registered.data?.filter((agent) => agent.status === 'READY').length ?? 0;
  const actionError =
    rescan.error ??
    adoptRuntime.error ??
    adoptAgent.error ??
    lifecycle.error ??
    updateDefaults.error;
  const visibleAgentCandidates = useMemo(
    () => (agents.data ?? []).filter((candidate) => candidate.agentKind !== 'UNKNOWN'),
    [agents.data],
  );
  const visibleRuntimeCandidates = useMemo(() => {
    if (!agents.isSuccess) return runtimes.data ?? [];
    const supportedRuntimeIds = new Set(
      visibleAgentCandidates.map((candidate) => candidate.targetCandidateId),
    );
    return (runtimes.data ?? []).filter(
      (runtime) =>
        runtime.kind === 'LOCAL_HOST' ||
        Boolean(runtime.targetId) ||
        supportedRuntimeIds.has(runtime.candidateId),
    );
  }, [agents.isSuccess, runtimes.data, visibleAgentCandidates]);
  const hiddenRuntimeCount = Math.max(
    0,
    (runtimes.data?.length ?? 0) - visibleRuntimeCandidates.length,
  );
  return (
    <div className="v06-page">
      <header className="v06-page-header">
        <div>
          <span className="v06-eyebrow">AGENT</span>
          <h1>Agent</h1>
          <p>
            AgentHub 会自动发现本机与 Docker 中的
            Agent。普通流程只需要接入和检查，不需要填写运行命令。
          </p>
        </div>
        <Button
          variant="soft"
          color="gray"
          onClick={() => rescan.mutate()}
          disabled={rescan.isPending}
          loading={rescan.isPending}
        >
          <RefreshCw size={16} /> 重新扫描
        </Button>
      </header>

      <div className="v06-summary-strip">
        <span>
          <strong>{readyAgents}</strong> 个 Agent 已就绪
        </span>
        <span>
          <strong>
            {visibleRuntimeCandidates.filter((runtime) => runtime.state === 'READY').length}
          </strong>{' '}
          个运行环境可用
        </span>
        <span className="v06-summary-muted">需要处理的已识别 Agent 会在下方明确标注原因。</span>
      </div>
      {actionError ? <InlineError error={actionError} /> : null}

      <section className="v06-panel">
        <SectionHeader
          title="运行环境"
          description="本机和 Docker 容器会在这里出现；接管只保存身份和允许的工作区映射。"
        />
        {hiddenRuntimeCount ? (
          <p className="v06-summary-muted">
            已隐藏 {hiddenRuntimeCount} 个未识别容器；如需接入，请先为容器配置支持的 Agent Profile。
          </p>
        ) : null}
        {runtimes.isLoading ? <LoadingState label="正在扫描运行环境" /> : null}
        {runtimes.error ? (
          <ErrorState error={runtimes.error} retry={() => void runtimes.refetch()} />
        ) : null}
        <div className="v06-card-grid">
          {visibleRuntimeCandidates.map((runtime) => (
            <article className="v06-discovery-card" key={runtime.candidateId}>
              <div className="v06-discovery-card-top">
                <div className="v06-record-icon">
                  <Settings size={19} />
                </div>
                <Badge
                  color={
                    runtime.state === 'READY'
                      ? 'green'
                      : runtime.state === 'STOPPED'
                        ? 'orange'
                        : 'gray'
                  }
                >
                  {labelRuntimeStatus(runtime.state)}
                </Badge>
              </div>
              <h3>{runtime.displayName}</h3>
              <p>
                {labelExecutionTargetKind(runtime.kind)}
                {runtime.image ? ` · ${runtime.image}` : ''}
              </p>
              {runtime.statusText ? <small>{runtime.statusText}</small> : null}
              <div className="v06-discovery-card-actions">
                {!runtime.targetId && runtime.adoptable ? (
                  <Button
                    size="2"
                    onClick={() => adoptRuntime.mutate(runtime.candidateId)}
                    loading={adoptRuntime.isPending}
                  >
                    接入运行环境
                  </Button>
                ) : null}
                {runtime.targetId && runtime.state === 'STOPPED' ? (
                  <Button
                    size="2"
                    onClick={() =>
                      lifecycle.mutate({ targetId: runtime.targetId!, action: 'start' })
                    }
                    loading={lifecycle.isPending}
                  >
                    <Play size={14} /> 启动
                  </Button>
                ) : null}
                {runtime.targetId &&
                runtime.state === 'READY' &&
                runtime.kind === 'DOCKER_CONTAINER' ? (
                  <Button
                    size="2"
                    variant="soft"
                    color="gray"
                    onClick={() =>
                      lifecycle.mutate({ targetId: runtime.targetId!, action: 'stop' })
                    }
                    loading={lifecycle.isPending}
                  >
                    停止
                  </Button>
                ) : null}
                {runtime.targetId ? <span className="v06-connected">已接入</span> : null}
              </div>
              {runtime.reasonCode ? (
                <small className="v06-card-warning">
                  {runtime.reasonCode === 'DOCKER_ENGINE_UNAVAILABLE'
                    ? 'Docker Engine 不可用，请检查服务权限。'
                    : '当前状态需要处理。'}
                </small>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      <section className="v06-panel">
        <SectionHeader
          title="发现的 Agent"
          description="接入后会自动运行 preflight；需要登录、缺少依赖或容器停止时会保留明确状态。"
        />
        {agents.isLoading ? <LoadingState label="正在检查 Agent" /> : null}
        {agents.error ? (
          <ErrorState error={agents.error} retry={() => void agents.refetch()} />
        ) : null}
        {!agents.isLoading && !agents.error && !visibleAgentCandidates.length ? (
          <LegacyEmptyState
            title="没有发现支持的 Agent"
            description="请先接入本机或 Docker 运行环境，然后重新扫描。未识别的普通容器不会显示在这里。"
          />
        ) : null}
        <div className="v06-record-list">
          {visibleAgentCandidates.map((candidate) => (
            <article className="v06-record" key={candidate.candidateId}>
              <div className="v06-record-icon">
                <Bot size={20} />
              </div>
              <div className="v06-record-main">
                <strong>{candidate.displayName}</strong>
                <span>
                  {candidate.agentKind === 'UNKNOWN'
                    ? '尚未识别 Agent 类型'
                    : labelAgentKind(candidate.agentKind)}{' '}
                  · {labelAdapterKind(candidate.adapterKind)}
                </span>
                {candidate.detectedVersion ? <code>{candidate.detectedVersion}</code> : null}
              </div>
              <Badge
                color={
                  candidate.state === 'READY'
                    ? 'green'
                    : candidate.state === 'AUTH_REQUIRED'
                      ? 'orange'
                      : 'gray'
                }
              >
                {labelDiscoveryStatus(candidate.state)}
              </Badge>
              {candidate.adoptable ? (
                <Button
                  size="2"
                  onClick={() => adoptAgent.mutate(candidate.candidateId)}
                  loading={adoptAgent.isPending}
                >
                  接入并检查
                </Button>
              ) : null}
              {candidate.registeredAgentId ? <span className="v06-connected">已接入</span> : null}
              {candidate.reasonCode ? (
                <small className="v06-card-warning">
                  {labelAgentCandidateReason(candidate.reasonCode)}
                </small>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      <section className="v06-panel">
        <SectionHeader
          title="已接入 Agent"
          description="这里管理已接入 Agent 的默认模型和模式；实际能力仍以每次 preflight 返回为准。"
        />
        {!registered.data?.length ? (
          <LegacyEmptyState
            title="还没有接入 Agent"
            description="从上面的发现列表接入一个 Agent。"
          />
        ) : (
          <div className="v06-record-list">
            {registered.data.map((agent) => (
              <article className="v06-record" key={agent.id}>
                <div className="v06-record-icon">
                  <Bot size={20} />
                </div>
                <div className="v06-record-main">
                  <strong>{agent.name}</strong>
                  <span>
                    {labelAgentKind(agent.agentKind)} · {labelDiscoveryStatus(agent.status)}
                  </span>
                  <small>
                    默认模型：{agent.defaultModel || '跟随 Agent'} · 默认模式：
                    {agent.defaultMode || '跟随 Agent'}
                  </small>
                </div>
                <Badge color={agent.status === 'READY' ? 'green' : 'orange'}>
                  {labelDiscoveryStatus(agent.status)}
                </Badge>
                <Button
                  type="button"
                  size="2"
                  variant="ghost"
                  color="gray"
                  onClick={() => {
                    setDefaultsAgent(agent);
                    setDefaultModel(agent.defaultModel ?? '');
                    setDefaultMode(agent.defaultMode ?? '');
                    updateDefaults.reset();
                  }}
                >
                  <Pencil size={15} /> 默认设置
                </Button>
              </article>
            ))}
          </div>
        )}
      </section>

      <FormDialog
        open={Boolean(defaultsAgent)}
        onOpenChange={(open) => {
          if (!open) {
            setDefaultsAgent(null);
            updateDefaults.reset();
          }
        }}
        title="Agent 默认设置"
        description="留空表示使用 Agent 自己的默认值。这里不会修改 Agent 的登录或运行命令。"
        footer={
          <>
            <Button
              type="button"
              variant="soft"
              color="gray"
              onClick={() => setDefaultsAgent(null)}
            >
              取消
            </Button>
            <Button type="submit" form="v06-agent-defaults-form" loading={updateDefaults.isPending}>
              保存设置
            </Button>
          </>
        }
      >
        <form
          id="v06-agent-defaults-form"
          className="v06-form"
          onSubmit={(event) => {
            event.preventDefault();
            updateDefaults.mutate({
              defaultModel: defaultModel.trim() || null,
              defaultMode: defaultMode.trim() || null,
            });
          }}
        >
          <FormTextField
            label="默认模型"
            id="v06-agent-default-model"
            value={defaultModel}
            onChange={(event) => setDefaultModel(event.target.value)}
            placeholder="跟随 Agent"
          />
          <FormTextField
            label="默认模式"
            id="v06-agent-default-mode"
            value={defaultMode}
            onChange={(event) => setDefaultMode(event.target.value)}
            placeholder="跟随 Agent"
          />
          {updateDefaults.error ? (
            <InlineError error={updateDefaults.error} title="默认设置保存失败" />
          ) : null}
        </form>
      </FormDialog>
    </div>
  );
}

function labelAgentCandidateReason(reasonCode: string): string {
  switch (reasonCode) {
    case 'AUTH_REQUIRED':
      return '请先完成该 Agent 的登录授权。';
    case 'AGENT_DEPENDENCY_MISSING':
      return 'AgentHub 未找到固定依赖，请先安装或重新部署。';
    case 'AGENT_UNSUPPORTED':
      return '当前 Agent 版本不在支持范围内。';
    case 'AGENT_BROKEN':
      return 'Agent 运行环境异常，请查看诊断信息。';
    case 'AGENT_PROFILE_NOT_DETECTED':
      return '容器中没有识别到支持的 Agent。';
    case 'RUNTIME_STOPPED':
      return '请先启动运行环境。';
    case 'REMOTE_NODE_OFFLINE':
      return 'Remote Node 当前离线，请检查连接。';
    case 'REMOTE_NODE_REVOKED':
      return 'Remote Node 已撤销，请重新注册设备。';
    case 'REMOTE_AGENT_MISSING':
      return '远程环境缺少该 Agent。';
    case 'REMOTE_AGENT_BROKEN':
      return '远程环境报告该 Agent 异常，请查看 Node 诊断。';
    case 'REMOTE_AGENT_INVENTORY_INVALID':
      return '远程环境的 Agent inventory 无法识别。';
    default:
      return '当前状态需要处理。';
  }
}

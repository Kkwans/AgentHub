import { useEffect, useState } from 'react';
import {
  AlertDialog,
  ArrowRight,
  Bot,
  Button,
  AdvancedSection,
  FormDialog,
  FormTextField,
  SelectField,
  Plus,
  RotateCcw,
} from '@agenthub/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import {
  api,
  type AgentRecord,
  type ExecutionTargetRecord,
  type ProjectRecord,
  type SessionRecord,
} from '../../../lib/api';
import {
  EmptyState,
  ErrorState,
  formatTime,
  LoadingState,
  PageIntro,
  StatusBadge,
} from '../../../components/Common';
import { labelAgentKind } from '../../../presentation/domain-labels';

export function SessionsPage() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const projectFilter = searchParams.get('projectId') ?? '';
  const creating = searchParams.get('new') === '1';
  const sessions = useQuery({
    queryKey: ['sessions', projectFilter || 'all'],
    queryFn: () =>
      api.get<SessionRecord[]>(
        projectFilter ? `/sessions?projectId=${encodeURIComponent(projectFilter)}` : '/sessions',
      ),
  });
  const projects = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<ProjectRecord[]>('/projects'),
    enabled: creating,
  });
  const agents = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.get<AgentRecord[]>('/agents'),
    enabled: creating,
  });
  const targets = useQuery({
    queryKey: ['targets'],
    queryFn: () => api.get<ExecutionTargetRecord[]>('/execution-targets'),
    enabled: creating,
  });
  const activeProjects = (projects.data ?? []).filter((project) => project.status === 'ACTIVE');
  const selectedProject =
    activeProjects.find((project) => project.id === projectFilter) ?? activeProjects[0];
  const selectedTarget = selectedProject
    ? (targets.data ?? []).find((target) => target.id === selectedProject.targetId)
    : undefined;
  const compatibleAgents = selectedProject
    ? (agents.data ?? []).filter(
        (agent) =>
          agent.enabled &&
          agent.status === 'READY' &&
          isAgentCompatibleWithProject(agent, selectedProject, targets.data ?? []),
      )
    : [];
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [title, setTitle] = useState('新 Session');
  const [model, setModel] = useState('');
  const [mode, setMode] = useState('');
  const [sessionToClose, setSessionToClose] = useState<SessionRecord>();
  const selectedAgent = compatibleAgents.find((agent) => agent.id === selectedAgentId);
  useEffect(() => {
    if (!compatibleAgents.some((agent) => agent.id === selectedAgentId)) {
      setSelectedAgentId(compatibleAgents[0]?.id ?? '');
    }
  }, [compatibleAgents, selectedAgentId]);
  useEffect(() => {
    const configuration = (selectedAgent?.capabilitiesJson.configuration ?? {}) as Record<
      string,
      unknown
    >;
    setModel(
      selectedAgent?.defaultModel ??
        readChoiceOptions(configuration.modelOptions ?? configuration.models)[0]?.value ??
        '',
    );
    setMode(
      selectedAgent?.defaultMode ??
        readChoiceOptions(configuration.modeOptions ?? configuration.modes)[0]?.value ??
        '',
    );
  }, [selectedAgent]);
  const createSession = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<SessionRecord>('/sessions', body),
    onSuccess: (session) => navigate(`/sessions/${session.id}`),
  });
  const resumeSession = useMutation({
    mutationFn: (sessionId: string) => api.post<SessionRecord>(`/sessions/${sessionId}/resume`),
    onSuccess: (session) => {
      void client.invalidateQueries({ queryKey: ['sessions'] });
      navigate(`/sessions/${session.id}`);
    },
  });
  const closeSession = useMutation({
    mutationFn: (sessionId: string) => api.post<SessionRecord>(`/sessions/${sessionId}/close`),
    onSuccess: () => {
      setSessionToClose(undefined);
      void client.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
  const openCreate = (nextProjectId = projectFilter) => {
    const next = new URLSearchParams(searchParams);
    if (nextProjectId) next.set('projectId', nextProjectId);
    else next.delete('projectId');
    next.set('new', '1');
    setSearchParams(next);
  };
  const closeCreate = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('new');
    setSearchParams(next);
  };
  const configuration = (selectedAgent?.capabilitiesJson.configuration ?? {}) as Record<
    string,
    unknown
  >;
  const modelOptions = readChoiceOptions(configuration.modelOptions ?? configuration.models);
  const modeOptions = readChoiceOptions(configuration.modeOptions ?? configuration.modes);
  const hasModelCapability = Boolean(
    selectedAgent?.defaultModel || configuration.models === true || modelOptions.length,
  );
  const hasModeCapability = Boolean(
    selectedAgent?.defaultMode || configuration.modes === true || modeOptions.length,
  );
  return (
    <div className="page-stack">
      <PageIntro
        title="Coding Session"
        description="进入多栏工作区查看对话、Approval、文件、Diff、Git 和运行上下文。"
        action={
          <div className="page-actions session-page-actions">
            {projectFilter && (
              <Link className="text-link session-filter-clear" to="/sessions">
                清除 Project 筛选
              </Link>
            )}
            {creating ? (
              <Button color="gray" variant="soft" onClick={closeCreate}>
                返回 Session 列表
              </Button>
            ) : (
              <Button onClick={() => openCreate()}>
                <Plus size={15} /> 新建 Session
              </Button>
            )}
          </div>
        }
      />
      {creating && (
        <FormDialog
          open={creating}
          onOpenChange={(open) => {
            if (!open) closeCreate();
          }}
          title="新建 Session"
          description="选择 Project 和已就绪的 Agent，其他运行参数会按能力自动填充。"
          footer={
            <>
              <Button type="button" color="gray" variant="soft" onClick={closeCreate}>
                取消
              </Button>
              <Button
                type="submit"
                form="v06-create-session-form"
                disabled={createSession.isPending || !selectedAgentId}
                loading={createSession.isPending}
              >
                创建并进入工作区
              </Button>
            </>
          }
        >
          {projects.isLoading || agents.isLoading || targets.isLoading ? (
            <LoadingState label="正在准备可用执行环境" />
          ) : projects.error ? (
            <ErrorState error={projects.error} retry={() => void projects.refetch()} />
          ) : agents.error ? (
            <ErrorState error={agents.error} retry={() => void agents.refetch()} />
          ) : targets.error ? (
            <ErrorState error={targets.error} retry={() => void targets.refetch()} />
          ) : !activeProjects.length ? (
            <EmptyState
              title="还没有可用的 Project"
              description="先添加一个处于 ACTIVE 状态的 Project，才能创建 Session。"
              action={
                <Link className="empty-state-link" to="/projects">
                  前往 Project 管理 <ArrowRight size={14} />
                </Link>
              }
            />
          ) : !selectedTarget ? (
            <EmptyState
              title="Project 尚未连接 Execution Target"
              description="当前 Project 的执行目标不存在或已经移除，请先在 Agent 页面检查目标。"
              action={
                <Link className="empty-state-link" to="/agents">
                  检查 Execution Target <ArrowRight size={14} />
                </Link>
              }
            />
          ) : !compatibleAgents.length ? (
            <EmptyState
              title="没有可用的 Agent"
              description="需要一个可访问当前 Project 工作区、已启用且预检就绪的 Agent。"
              action={
                <Link className="empty-state-link" to="/agents">
                  前往 Agent 管理 <ArrowRight size={14} />
                </Link>
              }
            />
          ) : (
            <form
              id="v06-create-session-form"
              className="session-create-form"
              aria-describedby={createSession.error ? 'session-create-error' : undefined}
              onSubmit={(event) => {
                event.preventDefault();
                if (!selectedProject || !selectedAgentId) return;
                createSession.mutate({
                  projectId: selectedProject.id,
                  agentId: selectedAgentId,
                  title: title.trim() || '新 Session',
                  cwd: selectedProject.realRootPath,
                  ...(model.trim() ? { model: model.trim() } : {}),
                  ...(mode.trim() ? { mode: mode.trim() } : {}),
                });
              }}
            >
              <SelectField
                label="Project"
                value={selectedProject!.id}
                options={activeProjects.map((project) => ({
                  value: project.id,
                  label: project.name,
                }))}
                onValueChange={openCreate}
              />
              <SelectField
                label="Agent"
                value={selectedAgentId}
                options={compatibleAgents.map((agent) => ({
                  value: agent.id,
                  label: agent.name,
                  description: labelAgentKind(agent.agentKind),
                }))}
                onValueChange={setSelectedAgentId}
              />
              <FormTextField
                label="Session 标题"
                id="v06-session-title"
                required
                maxLength={240}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
              <AdvancedSection
                title="运行参数"
                description="默认值来自 Project 和 Agent 能力，通常不需要修改。"
              >
                <div className="session-readonly-field" aria-label="工作目录">
                  <span>工作目录</span>
                  <code title={selectedProject!.realRootPath}>{selectedProject!.realRootPath}</code>
                </div>
                {hasModelCapability ? (
                  modelOptions.length ? (
                    <SelectField
                      label="model"
                      value={model}
                      options={modelOptions}
                      onValueChange={setModel}
                    />
                  ) : selectedAgent?.defaultModel ? (
                    <div className="session-readonly-field" aria-label="模型">
                      <span>模型</span>
                      <code>{model || '使用 Agent 默认模型'}</code>
                    </div>
                  ) : (
                    <FormTextField
                      label="模型"
                      description="填写 Agent 接受的 model ID"
                      value={model}
                      placeholder="输入 Agent 支持的模型 ID"
                      onChange={(event) => setModel(event.target.value)}
                    />
                  )
                ) : null}
                {hasModeCapability ? (
                  modeOptions.length ? (
                    <SelectField
                      label="mode"
                      value={mode}
                      options={modeOptions}
                      onValueChange={setMode}
                    />
                  ) : selectedAgent?.defaultMode ? (
                    <div className="session-readonly-field" aria-label="模式">
                      <span>模式</span>
                      <code>{mode || '使用 Agent 默认模式'}</code>
                    </div>
                  ) : (
                    <FormTextField
                      label="模式"
                      description="填写 Agent 接受的 mode ID"
                      value={mode}
                      placeholder="输入 Agent 支持的模式 ID"
                      onChange={(event) => setMode(event.target.value)}
                    />
                  )
                ) : null}
              </AdvancedSection>
              {createSession.error && (
                <p id="session-create-error" className="form-error" role="alert">
                  {createSession.error.message}
                </p>
              )}
            </form>
          )}
        </FormDialog>
      )}
      {sessions.isLoading ? (
        <LoadingState />
      ) : sessions.error ? (
        <ErrorState error={sessions.error} retry={() => void sessions.refetch()} />
      ) : !sessions.data?.length ? (
        <EmptyState
          title={projectFilter ? '该 Project 还没有 Session' : '还没有 Session'}
          description="从 Project 选择“开始会话”，或使用上方入口创建第一次会话。"
          action={
            projectFilter ? (
              <Link className="empty-state-link" to="/sessions">
                查看全部 Session <ArrowRight size={14} />
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="session-cards">
          {sessions.data.map((session) => {
            const canClose = ['READY', 'DISCONNECTED', 'FAILED'].includes(session.status);
            const resumeFailed =
              resumeSession.error && resumeSession.variables === session.id
                ? resumeSession.error
                : undefined;
            return (
              <article key={session.id} className="session-card">
                <Link className="session-card-link" to={`/sessions/${session.id}`}>
                  <div className="session-card-status">
                    <span className="session-icon">
                      <Bot size={17} />
                    </span>
                    <StatusBadge status={session.status} />
                  </div>
                  <strong>{session.title}</strong>
                  <code>{session.cwd}</code>
                  <span>
                    {session.branch || '无 Git 分支'} · {formatTime(session.lastActiveAt)}
                  </span>
                </Link>
                {canClose && (
                  <div className="session-card-actions">
                    {session.status === 'DISCONNECTED' && (
                      <Button
                        size="1"
                        disabled={resumeSession.isPending}
                        onClick={() => resumeSession.mutate(session.id)}
                      >
                        <RotateCcw size={14} />
                        {resumeSession.isPending && resumeSession.variables === session.id
                          ? '正在恢复'
                          : '恢复 Session'}
                      </Button>
                    )}
                    <Button
                      size="1"
                      color="gray"
                      variant="soft"
                      onClick={() => {
                        closeSession.reset();
                        setSessionToClose(session);
                      }}
                    >
                      关闭 Session
                    </Button>
                  </div>
                )}
                {resumeFailed && (
                  <p className="session-card-error" role="alert">
                    恢复失败：{resumeFailed.message}
                  </p>
                )}
              </article>
            );
          })}
        </div>
      )}
      <AlertDialog.Root
        open={Boolean(sessionToClose)}
        onOpenChange={(open) => {
          if (!open && !closeSession.isPending) setSessionToClose(undefined);
        }}
      >
        <AlertDialog.Content maxWidth="440px">
          <AlertDialog.Title>关闭 Session</AlertDialog.Title>
          <AlertDialog.Description size="2">
            将关闭“{sessionToClose?.title}”。关闭后不能恢复，但已有消息、Run 与 Git 记录会保留。
          </AlertDialog.Description>
          {closeSession.error && (
            <p className="session-dialog-error" role="alert">
              关闭失败：{closeSession.error.message}
            </p>
          )}
          <div className="session-dialog-actions">
            <AlertDialog.Cancel>
              <Button color="gray" variant="soft" disabled={closeSession.isPending}>
                取消
              </Button>
            </AlertDialog.Cancel>
            <Button
              color="red"
              disabled={!sessionToClose || closeSession.isPending}
              onClick={() => {
                if (sessionToClose) closeSession.mutate(sessionToClose.id);
              }}
            >
              {closeSession.isPending ? '正在关闭' : '确认关闭'}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </div>
  );
}

interface ChoiceOption {
  value: string;
  label: string;
  description?: string;
}

function readChoiceOptions(value: unknown): ChoiceOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === 'string' && item.trim()) {
      return [{ value: item, label: item }];
    }
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    const value = typeof record.id === 'string' ? record.id : record.value;
    if (typeof value !== 'string' || !value.trim()) return [];
    const label = typeof record.label === 'string' ? record.label : value;
    const description = typeof record.description === 'string' ? record.description : undefined;
    return [{ value, label, ...(description ? { description } : {}) }];
  });
}

function isAgentCompatibleWithProject(
  agent: AgentRecord,
  project: ProjectRecord,
  targets: ExecutionTargetRecord[],
): boolean {
  if (agent.targetId === project.targetId) return true;
  const projectTarget = targets.find((target) => target.id === project.targetId);
  const agentTarget = targets.find((target) => target.id === agent.targetId);
  return Boolean(
    projectTarget?.kind === 'LOCAL_HOST' &&
    agentTarget?.kind === 'DOCKER_CONTAINER' &&
    isPathCoveredByMapping(project.realRootPath, agentTarget.workspaceMappingsJson),
  );
}

function isPathCoveredByMapping(
  path: string,
  mappings: Array<{ hostRoot: string; containerRoot: string }>,
): boolean {
  const candidate = normalizeAbsolutePath(path);
  return mappings.some(({ hostRoot }) => {
    const root = normalizeAbsolutePath(hostRoot);
    return candidate === root || candidate.startsWith(`${root}/`);
  });
}

function normalizeAbsolutePath(path: string): string {
  const normalized = path.replaceAll('\\', '/').replace(/\/+/g, '/').replace(/\/$/, '');
  return normalized || '/';
}

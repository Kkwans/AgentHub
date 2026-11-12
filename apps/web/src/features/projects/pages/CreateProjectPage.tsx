import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { AhButton, AhDialog, AhErrorState, AhInput, AhSelect, AhTextarea } from '@agenthub/ui';

import { api, ApiError, authSession, type ExecutionTargetRecord } from '../../../lib/api';
import layout from '../../shared/layout.module.css';
import { useCompactViewport } from '../../shared/page-primitives';
import { ProjectDirectoryPicker } from '../components/ProjectDirectoryPicker';
import { ProjectsPage } from './ProjectsPage';

interface CreateProjectInput {
  name: string;
  description?: string;
  targetId: string;
  rootPath: string;
  kind: 'STANDARD' | 'TEST';
}

function verifyCreatedProject(value: unknown, input: CreateProjectInput): { id: string } {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !('id' in value) ||
    typeof value.id !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.id) ||
    !('targetId' in value) ||
    value.targetId !== input.targetId ||
    !('rootPath' in value) ||
    value.rootPath !== input.rootPath ||
    !('name' in value) ||
    value.name !== input.name
  ) {
    throw new ApiError(
      'PROJECT_CREATE_RESULT_UNKNOWN',
      '创建回执无法与当前项目匹配，请核对项目列表。',
      200,
    );
  }
  return { id: value.id };
}

function isKnownCreateRejection(error: Error): boolean {
  if (!(error instanceof ApiError)) return false;
  // validate() and ProjectService.add/preflightForTarget reject these before
  // projects.create. An arbitrary 4xx/HTTP_ERROR is not proof of no mutation.
  return (
    (error.status === 400 &&
      ['VALIDATION_FAILED', 'PROJECT_PREFLIGHT_FAILED'].includes(error.code)) ||
    (error.status === 404 && error.code === 'EXECUTION_TARGET_NOT_FOUND')
  );
}

export function CreateProjectPage() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const compact = useCompactViewport();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<'STANDARD' | 'TEST'>('STANDARD');
  const [chosenTargetId, setChosenTargetId] = useState<string | null>(null);
  const [selection, setSelection] = useState<{ targetId: string; path: string } | null>(null);
  const mounted = useRef(true);
  const submission = useRef(false);
  const [outcomeUnknown, setOutcomeUnknown] = useState(false);
  const authorizationLost = useRef(false);
  const [authorizationRequired, setAuthorizationRequired] = useState(false);
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = authSession.onAuthorizationRequired(() => {
      authorizationLost.current = true;
      mounted.current = false;
      setAuthorizationRequired(true);
    });
    return () => {
      mounted.current = false;
      unsubscribe();
    };
  }, []);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const targets = useQuery({
    queryKey: ['targets'],
    queryFn: () => api.get<ExecutionTargetRecord[]>('/execution-targets'),
  });
  const targetId = chosenTargetId ?? targets.data?.[0]?.id ?? '';
  const targetAvailable = Boolean(targets.data?.some((target) => target.id === targetId));
  const rootPath = selection?.targetId === targetId ? selection.path : '';
  const preflight = useQuery({
    queryKey: ['project-preflight', targetId, rootPath],
    queryFn: () =>
      api.post<{
        status: 'READY' | 'BROKEN';
        checks: Array<{ id: string; status: string; message: string }>;
      }>('/projects/preflight', { targetId, rootPath }),
    enabled: Boolean(targetAvailable && rootPath),
    staleTime: 2_000,
  });
  const create = useMutation({
    mutationFn: async (input: CreateProjectInput) =>
      verifyCreatedProject(await api.post<unknown>('/projects', input), input),
    onSuccess: (project) => {
      if (!authorizationLost.current) void client.invalidateQueries({ queryKey: ['projects'] });
      if (mounted.current) navigate(`/projects/${project.id}/overview`);
    },
    onError: (error) => {
      const knownRejection = isKnownCreateRejection(error);
      if (knownRejection) submission.current = false;
      else if (mounted.current) setOutcomeUnknown(true);
    },
  });
  const locked = create.isPending || outcomeUnknown || authorizationRequired;
  const canCreate = Boolean(
    name.trim() &&
    targetAvailable &&
    rootPath &&
    !targets.isFetching &&
    !targets.error &&
    !preflight.isFetching &&
    !preflight.error &&
    preflight.data?.status === 'READY' &&
    !locked,
  );
  const submit = () => {
    if (!canCreate || submission.current || !mounted.current) return;
    submission.current = true;
    create.mutate({
      name: name.trim(),
      ...(description.trim() ? { description: description.trim() } : {}),
      targetId,
      rootPath,
      kind,
    });
  };
  const close = () => {
    mounted.current = false;
    navigate('/projects');
  };
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
            <AhButton onClick={submit} loading={create.isPending} disabled={!canCreate}>
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
                setChosenTargetId(value ?? '');
                setSelection(null);
              }}
              data={(targets.data ?? []).map((target) => ({
                value: target.id,
                label: `${target.name} · ${target.os}/${target.arch}`,
              }))}
              disabled={locked || targets.isLoading}
              placeholder="选择运行环境"
            />
          </div>
          {targets.isLoading ? <p role="status">正在读取运行环境…</p> : null}
          {targets.error ? (
            <AhErrorState
              title="无法读取运行环境"
              description={targets.error.message}
              retry={() => void targets.refetch()}
            />
          ) : null}
          {!targets.isLoading && !targets.error && targets.data?.length === 0 ? (
            <p role="status">尚无可用运行环境，请先在 Agent 页面接入运行环境。</p>
          ) : null}
          {targetAvailable ? (
            <ProjectDirectoryPicker
              key={targetId}
              targetId={targetId}
              selectedPath={rootPath}
              disabled={locked}
              onSelect={(path) => {
                setSelection({ targetId, path });
                if (!name.trim() && path) setName(path.split('/').filter(Boolean).at(-1) ?? '');
              }}
            />
          ) : null}
          <p role="status">
            已选择的项目目录：
            <code style={{ overflowWrap: 'anywhere' }}>{rootPath || '尚未选择'}</code>
          </p>
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
                disabled={locked}
                maxLength={160}
                label="项目名称"
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
                placeholder="例如 AgentHub"
                required
              />
              <AhTextarea
                disabled={locked}
                maxLength={4000}
                label="项目说明（可选）"
                value={description}
                onChange={(event) => setDescription(event.currentTarget.value)}
                placeholder="描述这个工程的用途"
                minRows={3}
              />
              <AhSelect
                disabled={locked}
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
              <AhErrorState
                title="目录预检失败"
                description={preflight.error.message}
                retry={() => void preflight.refetch()}
              />
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
          {authorizationRequired ? (
            <AhErrorState
              title="登录状态已失效"
              description="请重新登录后核对项目列表，本窗口不会继续创建或跳转。"
            />
          ) : null}
          {create.isPending ? (
            <p role="status">正在创建项目。关闭窗口不会撤销已发送的请求。</p>
          ) : null}
          {create.error ? (
            <AhErrorState
              title={outcomeUnknown ? '创建结果尚未确认' : '创建失败'}
              description={
                outcomeUnknown
                  ? '请求可能已经完成，请返回项目列表核对，暂不重复创建。'
                  : create.error.message
              }
            />
          ) : null}
        </div>
      </AhDialog>
    </>
  );
}

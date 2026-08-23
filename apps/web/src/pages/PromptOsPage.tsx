import { useEffect, useState } from 'react';
import {
  ArrowRight,
  AdvancedSection,
  Braces,
  Button,
  FormDialog,
  FormTextArea,
  FormTextField,
  Plus,
  SelectField,
} from '@agenthub/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';

import { EmptyState, ErrorState, LoadingState, PageIntro } from '../components/Common';
import { api, type AgentRecord, type ProjectRecord, type PromptRecord } from '../lib/api';
import '../lib/monaco';
import {
  PromptDetail,
  promptTabs,
  type PromptTab,
} from '../features/promptos/components/PromptOsSections';
import { labelPromptKind, labelPromptType } from '../presentation/domain-labels';

function createPromptKey(name: string): string {
  const normalized = name
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized ? `prompt/${normalized}` : `prompt/${Date.now()}`;
}

export function PromptOsPage() {
  const client = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [createOpen, setCreateOpen] = useState(false);
  const [promptKind, setPromptKind] = useState('TASK');
  const [promptType, setPromptType] = useState('TEXT');
  const [promptProjectId, setPromptProjectId] = useState('');
  const prompts = useQuery({
    queryKey: ['prompts'],
    queryFn: () => api.get<PromptRecord[]>('/prompts'),
  });
  const projects = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<ProjectRecord[]>('/projects'),
  });
  const agents = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.get<AgentRecord[]>('/agents'),
  });
  const selectedParam = searchParams.get('prompt');
  const selectedId = prompts.data?.some((prompt) => prompt.id === selectedParam)
    ? selectedParam!
    : prompts.data?.[0]?.id;
  const tabParam = searchParams.get('tab');
  const tab = promptTabs.some((item) => item.id === tabParam)
    ? (tabParam as PromptTab)
    : 'versions';

  const setSelectedId = (promptId: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('prompt', promptId);
    setSearchParams(next);
  };

  const setTab = (nextTab: PromptTab) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', nextTab);
    setSearchParams(next);
  };

  const createPrompt = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<PromptRecord>('/prompts', body),
    onSuccess: (created) => {
      setCreateOpen(false);
      setSelectedId(created.id);
      void client.invalidateQueries({ queryKey: ['prompts'] });
    },
  });

  useEffect(() => {
    if (!selectedId || selectedParam === selectedId) return;
    const next = new URLSearchParams(searchParams);
    next.set('prompt', selectedId);
    setSearchParams(next, { replace: true });
  }, [searchParams, selectedId, selectedParam, setSearchParams]);

  return (
    <div className="page-stack promptos-page">
      <PageIntro
        title="PromptOS"
        description="管理稳定 Prompt 标识、不可变版本、可移动标签、绑定与可复现的最终上下文。"
        action={
          <Button onClick={() => setCreateOpen(!createOpen)}>
            <Plus size={15} /> 新建 Prompt
          </Button>
        }
      />
      {createOpen && (
        <FormDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          title="创建 Prompt"
          description="先创建稳定身份，再通过“创建新版本”追加内容；历史版本不会被覆盖。"
          size="medium"
          footer={
            <>
              <Button
                type="button"
                color="gray"
                variant="soft"
                onClick={() => setCreateOpen(false)}
              >
                取消
              </Button>
              <Button
                type="submit"
                form="v06-create-prompt-form"
                disabled={createPrompt.isPending}
                loading={createPrompt.isPending}
              >
                创建 Prompt
              </Button>
            </>
          }
        >
          <form
            id="v06-create-prompt-form"
            className="v06-form"
            onSubmit={(event) => {
              event.preventDefault();
              const values = Object.fromEntries(new FormData(event.currentTarget));
              const name = String(values.name).trim();
              const explicitKey = String(values.key ?? '').trim();
              createPrompt.mutate({
                key: explicitKey || createPromptKey(name),
                name,
                kind: promptKind,
                type: promptType,
                ...(promptProjectId ? { projectId: promptProjectId } : {}),
                ...(values.description ? { description: String(values.description) } : {}),
              });
            }}
          >
            <FormTextField
              label="名称"
              id="v06-prompt-name"
              name="name"
              required
              placeholder="例如安全变更审阅"
            />
            <SelectField
              label="用途"
              id="v06-prompt-kind"
              value={promptKind}
              onValueChange={setPromptKind}
              options={['SYSTEM', 'TASK', 'REVIEW', 'COMMIT', 'RULE', 'TEMPLATE'].map((value) => ({
                value,
                label: labelPromptKind(value),
              }))}
            />
            <SelectField
              label="内容格式"
              id="v06-prompt-type"
              value={promptType}
              onValueChange={setPromptType}
              options={['TEXT', 'CHAT'].map((value) => ({ value, label: labelPromptType(value) }))}
            />
            <SelectField
              label="Project 范围"
              id="v06-prompt-project"
              value={promptProjectId || '__global__'}
              options={[
                { value: '__global__', label: '全局' },
                ...(projects.data ?? []).map((project) => ({
                  value: project.id,
                  label: project.name,
                })),
              ]}
              onValueChange={(value) => setPromptProjectId(value === '__global__' ? '' : value)}
            />
            <FormTextArea
              label="说明"
              id="v06-prompt-description"
              name="description"
              placeholder="说明用途和适用范围"
            />
            <AdvancedSection
              title="稳定 key"
              description="普通用户无需填写；留空时会根据名称自动生成。"
            >
              <FormTextField
                label="key"
                id="v06-prompt-key"
                name="key"
                className="mono"
                placeholder="自动生成"
              />
            </AdvancedSection>
            {createPrompt.error ? (
              <span className="v06-form-error">{createPrompt.error.message}</span>
            ) : null}
          </form>
        </FormDialog>
      )}
      <div className="promptos-layout">
        <aside className="prompt-list-panel">
          <div className="prompt-list-heading">
            <div>
              <span>Prompt 资产</span>
              <small>{prompts.data?.length ?? 0}</small>
            </div>
          </div>
          {prompts.isLoading ? (
            <LoadingState />
          ) : prompts.error ? (
            <ErrorState error={prompts.error} />
          ) : !prompts.data?.length ? (
            <EmptyState title="还没有 Prompt" description="先创建稳定标识，再追加第一个版本。" />
          ) : (
            <div className="prompt-list">
              {prompts.data.map((prompt) => (
                <button
                  key={prompt.id}
                  className={selectedId === prompt.id ? 'active' : ''}
                  onClick={() => setSelectedId(prompt.id)}
                >
                  <span className="prompt-kind">
                    <Braces size={14} />
                  </span>
                  <div>
                    <strong>{prompt.name}</strong>
                    <code>{prompt.key}</code>
                    <small>
                      {labelPromptKind(prompt.kind)} · {labelPromptType(prompt.type)}
                    </small>
                  </div>
                  <ArrowRight size={14} />
                </button>
              ))}
            </div>
          )}
        </aside>
        <section className="prompt-detail-panel">
          {!selectedId ? (
            <EmptyState
              title="选择 Prompt"
              description="在左侧选择 Prompt 查看版本、标签和绑定。"
            />
          ) : (
            <PromptDetail
              key={selectedId}
              promptId={selectedId}
              tab={tab}
              setTab={setTab}
              projects={projects.data ?? []}
              agents={agents.data ?? []}
            />
          )}
        </section>
      </div>
    </div>
  );
}

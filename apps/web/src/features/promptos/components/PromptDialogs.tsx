import { AhButton, AhDialog, AhErrorState, AhInput, AhSelect, AhTextarea } from '@agenthub/ui';
import { ApiError } from '../../../lib/api-error';
import { labelPromptBindingTarget } from '../../../presentation/domain-labels';

import type { PromptLibraryModel } from '../hooks/usePromptLibrary';

export function PromptDialogs({ model }: { model: PromptLibraryModel }) {
  const {
    newOpen,
    setNewOpen,
    create,
    name,
    setName,
    key,
    setKey,
    versionOpen,
    setVersionOpen,
    versionCreate,
    versionTarget,
    versionOutcomeUnknown,
    checkVersionOutcome,
    resumeVersionEditing,
    versionContent,
    setVersionContent,
    versionVariables,
    setVersionVariables,
    versionChangelog,
    setVersionChangelog,
    labelOpen,
    setLabelOpen,
    moveLabel,
    labelName,
    setLabelName,
    labelVersionId,
    setLabelVersionId,
    versions,
    bindingOpen,
    setBindingOpen,
    createBinding,
    bindingTargetId,
    bindingSelectorValue,
    bindingTargetType,
    setBindingTargetType,
    setBindingTargetId,
    bindingTargets,
    bindingTargetState,
    bindingTargetSource,
    bindingSlot,
    setBindingSlot,
    bindingSelector,
    setBindingSelector,
    bindingSelectors,
    setBindingSelectorValue,
  } = model;

  return (
    <>
      <AhDialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title="新建 Prompt"
        description="先建立资产，再逐步添加版本和绑定。"
        actions={
          <>
            <AhButton variant="default" onClick={() => setNewOpen(false)}>
              取消
            </AhButton>
            <AhButton
              onClick={() => create.mutate()}
              loading={create.isPending}
              disabled={!name.trim() || !key.trim()}
            >
              创建
            </AhButton>
          </>
        }
      >
        {create.error ? <AhErrorState description={create.error.message} /> : null}
        <AhInput
          label="名称"
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
        />
        <AhInput
          label="Key"
          value={key}
          onChange={(event) => setKey(event.currentTarget.value)}
          placeholder="project/task-primer"
        />
      </AhDialog>
      <AhDialog
        open={versionOpen}
        onClose={() => setVersionOpen(false)}
        title="创建新版本"
        description="版本创建后不可覆盖或删除，latest 会自动指向这次创建的版本。"
        size={760}
        actions={
          <>
            <AhButton variant="default" onClick={() => setVersionOpen(false)}>
              取消
            </AhButton>
            <AhButton
              onClick={() => versionCreate.mutate()}
              loading={versionCreate.isPending}
              disabled={!versionContent.trim() || Boolean(versionOutcomeUnknown)}
            >
              创建版本
            </AhButton>
          </>
        }
      >
        <p>目标 Prompt：{versionTarget?.name}</p>
        <p>离开或关闭不会撤回已发送的创建请求。重新进入前请先检查版本历史。</p>
        {versionCreate.error ? <AhErrorState description={versionCreate.error.message} /> : null}
        {versionOutcomeUnknown ? (
          <section aria-label="核对版本创建结果">
            <p role="alert">创建结果尚未确认，版本可能已经保存。请先核对，避免重复创建。</p>
            <AhButton
              variant="default"
              onClick={() => void checkVersionOutcome()}
              loading={versionCreate.isPending}
            >
              读取此 Prompt 的版本列表
            </AhButton>
            {versionOutcomeUnknown.checked ? (
              <>
                <p>
                  当前读到 {versionOutcomeUnknown.checked.length}{' '}
                  个版本。列表不证明此前请求已结束，请确认是否已包含本次正文。
                </p>
                <ul>
                  {versionOutcomeUnknown.checked.map((version) => (
                    <li key={version.id}>
                      v{version.version} · {version.id}
                      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs">
                        {JSON.stringify(version.contentJson, null, 2)}
                      </pre>
                    </li>
                  ))}
                </ul>
                <AhButton variant="default" onClick={resumeVersionEditing}>
                  已核对，重新编辑
                </AhButton>
              </>
            ) : null}
          </section>
        ) : null}
        <AhTextarea
          label={versionTarget?.type === 'CHAT' ? 'CHAT 内容 JSON' : 'Prompt 内容'}
          disabled={versionCreate.isPending || Boolean(versionOutcomeUnknown)}
          value={versionContent}
          onChange={(event) => setVersionContent(event.currentTarget.value)}
          minRows={versionTarget?.type === 'CHAT' ? 10 : 8}
          placeholder={
            versionTarget?.type === 'CHAT' ? '{"messages":[]}' : '输入 {{ variable }} 模板内容'
          }
        />
        <AhTextarea
          label="Variables JSON"
          disabled={versionCreate.isPending || Boolean(versionOutcomeUnknown)}
          value={versionVariables}
          onChange={(event) => setVersionVariables(event.currentTarget.value)}
          minRows={6}
        />
        <AhInput
          label="变更说明"
          disabled={versionCreate.isPending || Boolean(versionOutcomeUnknown)}
          value={versionChangelog}
          onChange={(event) => setVersionChangelog(event.currentTarget.value)}
          placeholder="说明本次变化"
        />
      </AhDialog>
      <AhDialog
        open={labelOpen}
        onClose={() => setLabelOpen(false)}
        title="移动 Prompt 标签"
        description="标签是可移动指针；latest 由系统维护。"
        actions={
          <>
            <AhButton variant="default" onClick={() => setLabelOpen(false)}>
              取消
            </AhButton>
            <AhButton
              onClick={() => moveLabel.mutate()}
              loading={moveLabel.isPending}
              disabled={!labelName.trim() || !labelVersionId}
            >
              移动标签
            </AhButton>
          </>
        }
      >
        {moveLabel.error ? <AhErrorState description={moveLabel.error.message} /> : null}
        <AhInput
          label="标签名称"
          value={labelName}
          onChange={(event) => setLabelName(event.currentTarget.value)}
        />
        <AhSelect
          label="目标版本"
          value={labelVersionId}
          onChange={(value) => setLabelVersionId(value ?? '')}
          data={(versions.data ?? []).map((version) => ({
            value: version.id,
            label: `v${version.version} · ${version.changelog ?? '无变更说明'}`,
          }))}
          placeholder="选择版本"
        />
      </AhDialog>
      <AhDialog
        open={bindingOpen}
        onClose={() => setBindingOpen(false)}
        title="新建 Prompt 绑定"
        description="选择绑定目标和版本来源；保存后会参与后续上下文解析。"
        size={680}
        actions={
          <>
            <AhButton variant="default" onClick={() => setBindingOpen(false)}>
              取消
            </AhButton>
            <AhButton
              onClick={() => createBinding.mutate()}
              loading={createBinding.isPending}
              disabled={bindingTargetState !== 'ready' || !bindingSelectorValue}
            >
              创建绑定
            </AhButton>
          </>
        }
      >
        {createBinding.error ? <AhErrorState description={createBinding.error.message} /> : null}
        <AhSelect
          label="绑定目标类型"
          value={bindingTargetType}
          onChange={(value) => {
            setBindingTargetType((value as typeof bindingTargetType) ?? 'PROJECT');
            setBindingTargetId('');
          }}
          data={[
            { value: 'PROJECT', label: 'Project' },
            { value: 'AGENT', label: 'Agent' },
            { value: 'TASK', label: 'Task' },
          ]}
        />
        <AhSelect
          label={labelPromptBindingTarget(bindingTargetType)}
          value={bindingTargetId}
          onChange={(value) => setBindingTargetId(value ?? '')}
          data={bindingTargets}
          disabled={['error', 'loading', 'refreshing', 'empty'].includes(bindingTargetState)}
          placeholder="请选择绑定目标"
        />
        {bindingTargetState !== 'ready' ? (
          <div
            role={bindingTargetState === 'error' ? 'alert' : 'status'}
            aria-label="绑定目标读取状态"
          >
            {bindingTargetState === 'error' ? (
              <>
                <p>
                  {bindingTargetSource.error instanceof ApiError &&
                  bindingTargetSource.error.code === 'AUTH_REQUIRED'
                    ? '登录已失效，无法确认绑定目标。'
                    : bindingTargetId
                      ? '目标读取失败，不代表没有目标。原选择已保留，确认前不能创建绑定。'
                      : '目标读取失败，不代表没有目标。读取成功前不能选择目标或创建绑定。'}
                </p>
              </>
            ) : bindingTargetState === 'loading' ? (
              <p>正在读取绑定目标。</p>
            ) : bindingTargetState === 'refreshing' ? (
              <p>
                {bindingTargetId
                  ? '正在等待目标数据更新，原选择已保留，确认前不能创建绑定。'
                  : '正在等待目标数据更新，确认前不能选择目标或创建绑定。'}
              </p>
            ) : bindingTargetState === 'empty' ? (
              <p>
                当前没有可绑定的 {labelPromptBindingTarget(bindingTargetType)}
                。请切换目标类型，或
                {bindingTargetType === 'AGENT'
                  ? '先接入 Agent'
                  : bindingTargetType === 'PROJECT'
                    ? '先创建项目'
                    : '先创建工作'}
                。
              </p>
            ) : bindingTargetState === 'missing' ? (
              <p>原目标已不在最新列表，请重新选择；不会自动改选其他目标。</p>
            ) : bindingTargetState === 'unselected' ? (
              <p>请选择本次要绑定的目标。</p>
            ) : null}
            {['error', 'empty', 'missing'].includes(bindingTargetState) ? (
              <AhButton
                variant="subtle"
                disabled={bindingTargetSource.fetchStatus !== 'idle'}
                onClick={() => void bindingTargetSource.refetch()}
              >
                重新读取目标
              </AhButton>
            ) : null}
          </div>
        ) : null}
        <AhSelect
          label="提示位"
          value={bindingSlot}
          onChange={(value) => setBindingSlot(value ?? 'SYSTEM')}
          data={[
            { value: 'SYSTEM', label: '系统' },
            { value: 'TASK_PRIMER', label: '任务前置' },
            { value: 'REVIEW', label: 'Review' },
            { value: 'COMMIT', label: 'Commit' },
            { value: 'RULES', label: '规则' },
          ]}
        />
        <AhSelect
          label="选择方式"
          value={bindingSelector}
          onChange={(value) => {
            setBindingSelector((value as typeof bindingSelector) ?? 'LABEL');
            setBindingSelectorValue('');
          }}
          data={[
            { value: 'LABEL', label: '标签' },
            { value: 'VERSION', label: '固定版本' },
          ]}
        />
        <AhSelect
          label={bindingSelector === 'LABEL' ? '标签' : '固定版本'}
          value={bindingSelectorValue}
          onChange={(value) => setBindingSelectorValue(value ?? '')}
          data={bindingSelectors}
          placeholder="选择来源"
        />
      </AhDialog>
    </>
  );
}

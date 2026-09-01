import { AhButton, AhDialog, AhErrorState, AhInput, AhSelect, AhTextarea } from '@agenthub/ui';
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
    versionContent,
    setVersionContent,
    versionVariables,
    setVersionVariables,
    versionChangelog,
    setVersionChangelog,
    selected,
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
              disabled={!versionContent.trim()}
            >
              创建版本
            </AhButton>
          </>
        }
      >
        {versionCreate.error ? <AhErrorState description={versionCreate.error.message} /> : null}
        <AhTextarea
          label={selected?.type === 'CHAT' ? 'CHAT 内容 JSON' : 'Prompt 内容'}
          value={versionContent}
          onChange={(event) => setVersionContent(event.currentTarget.value)}
          minRows={selected?.type === 'CHAT' ? 10 : 8}
          placeholder={
            selected?.type === 'CHAT' ? '{"messages":[]}' : '输入 {{ variable }} 模板内容'
          }
        />
        <AhTextarea
          label="Variables JSON"
          value={versionVariables}
          onChange={(event) => setVersionVariables(event.currentTarget.value)}
          minRows={6}
        />
        <AhInput
          label="变更说明"
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
              disabled={!bindingTargetId || !bindingSelectorValue}
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
          placeholder="选择目标"
        />
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

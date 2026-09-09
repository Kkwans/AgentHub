import { AhButton, AhPageHeader, Card, Plus } from '@agenthub/ui';

import { QueryMessage } from '../../shared/page-primitives';
import promptSettingsStyles from '../promptSettings.module.css';

import type { PromptLibraryModel } from '../hooks/usePromptLibrary';
import { PromptAssetList } from './PromptAssetList';
import { PromptDialogs } from './PromptDialogs';
import { PromptEditor } from './PromptEditor';
import { PromptLifecycleDrawer } from './PromptLifecycleDrawer';

export function PromptLibraryView({ model }: { model: PromptLibraryModel }) {
  const { prompts, setNewOpen } = model;

  return (
    <div className={`${promptSettingsStyles.promptPage} workspace-page page-shell min-h-full`}>
      <AhPageHeader
        eyebrow="PROMPT ASSETS"
        title="Prompt 库"
        description="集中管理 Prompt 内容、版本、变量、标签与绑定；主工作区保持单一焦点。"
        actions={
          <AhButton leftSection={<Plus size={16} />} onClick={() => setNewOpen(true)}>
            新建 Prompt
          </AhButton>
        }
        className="mb-1 border-b border-[hsl(var(--border))]/70 pb-5"
      />
      <QueryMessage
        loading={prompts.isLoading}
        error={prompts.error}
        retry={() => void prompts.refetch()}
        label="正在加载 Prompt 资产"
      />
      {!prompts.isLoading && !prompts.error ? (
        <Card
          className={`${promptSettingsStyles.promptLayout} two-pane min-h-[680px] overflow-hidden rounded-[var(--radius-xl)] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] shadow-[var(--shadow-sm)]`}
        >
          <PromptAssetList model={model} />
          <PromptEditor model={model} />
        </Card>
      ) : null}
      <PromptLifecycleDrawer model={model} />
      <PromptDialogs model={model} />
    </div>
  );
}

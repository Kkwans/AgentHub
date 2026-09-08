import { AhButton, Plus } from '@agenthub/ui';

import { QueryMessage } from '../../shared/page-primitives';
import promptSettingsStyles from '../promptSettings.module.css';

import type { PromptLibraryModel } from '../hooks/usePromptLibrary';
import { PromptAssetList } from './PromptAssetList';
import { PromptDialogs } from './PromptDialogs';
import { PromptEditor } from './PromptEditor';
import { PromptLifecycleDrawer } from './PromptLifecycleDrawer';
import { Card } from '../../../pinharness/ui/card';

export function PromptLibraryView({ model }: { model: PromptLibraryModel }) {
  const { prompts, setNewOpen } = model;

  return (
    <div className={`${promptSettingsStyles.promptPage} workspace-page page-shell min-h-full`}>
      <header
        className={`${promptSettingsStyles.pageHeader} workspace-header navigation-page-header -mx-4 px-4 sm:-mx-6 sm:px-6`}
      >
        <div>
          <p
            className={`${promptSettingsStyles.eyebrow} mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--primary))]`}
          >
            PROMPT ASSETS
          </p>
          <h1 className="m-0 text-[clamp(24px,3vw,32px)] font-semibold tracking-[-0.035em] text-[hsl(var(--foreground))]">
            Prompt 库
          </h1>
          <p className="mt-2 max-w-[42rem] text-sm leading-6 text-[hsl(var(--foreground-muted))]">
            集中管理 Prompt 内容、版本、变量、标签与绑定；主工作区保持单一焦点。
          </p>
        </div>
        <div className={`${promptSettingsStyles.pageActions} flex flex-wrap items-center gap-2`}>
          <AhButton leftSection={<Plus size={16} />} onClick={() => setNewOpen(true)}>
            新建 Prompt
          </AhButton>
        </div>
      </header>
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

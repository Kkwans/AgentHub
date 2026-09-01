import { AhButton, Plus } from '@agenthub/ui';

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
    <div className={promptSettingsStyles.promptPage}>
      <header className={promptSettingsStyles.pageHeader}>
        <div>
          <p className={promptSettingsStyles.eyebrow}>PROMPT ASSETS</p>
          <h1>Prompt 库</h1>
          <p>集中管理 Prompt 内容、版本、变量、标签与绑定；主工作区保持单一焦点。</p>
        </div>
        <div className={promptSettingsStyles.pageActions}>
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
        <div className={promptSettingsStyles.promptLayout}>
          <PromptAssetList model={model} />
          <PromptEditor model={model} />
        </div>
      ) : null}
      <PromptLifecycleDrawer model={model} />
      <PromptDialogs model={model} />
    </div>
  );
}

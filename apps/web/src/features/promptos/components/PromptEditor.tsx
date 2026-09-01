import { AhButton, AhEmptyState, AhErrorState, AhStatusPill, AhTextarea, Eye } from '@agenthub/ui';
import {
  labelPromptBindingTarget,
  labelPromptKind,
  labelPromptSelector,
} from '../../../presentation/domain-labels';
import layout from '../../shared/layout.module.css';
import { displayDate } from '../../shared/page-primitives';
import promptSettingsStyles from '../promptSettings.module.css';

import type { PromptLibraryModel } from '../hooks/usePromptLibrary';

export function PromptEditor({ model }: { model: PromptLibraryModel }) {
  const {
    selected,
    setNewOpen,
    latestVersion,
    refreshPrompt,
    setLifecycleOpen,
    setVersionContent,
    setVersionVariables,
    setVersionOpen,
    tab,
    tabLabels,
    selectMainTab,
    contentValue,
    variableEntries,
    render,
    playground,
    setPlayground,
    bindings,
    targetName,
    setBindingOpen,
    toggleBinding,
  } = model;

  return (
    <section className={promptSettingsStyles.mainPane} aria-label="Prompt 编辑器">
      {selected ? (
        <>
          <header className={promptSettingsStyles.mainHeader}>
            <div>
              <div className={promptSettingsStyles.titleLine}>
                <h2>{selected.name}</h2>
                <AhStatusPill status="ACTIVE" />
                <AhStatusPill status={latestVersion ? 'READY' : 'PENDING'} />
              </div>
              <p>
                {selected.key} · {labelPromptKind(selected.kind)}
                {latestVersion
                  ? ` · v${latestVersion.version} · ${displayDate(latestVersion.createdAt)}`
                  : ' · 尚未创建版本'}
              </p>
            </div>
            <div className={promptSettingsStyles.editorActions}>
              <AhButton size="sm" variant="default" onClick={refreshPrompt}>
                刷新
              </AhButton>
              <AhButton size="sm" variant="default" onClick={() => setLifecycleOpen(true)}>
                版本与标签
              </AhButton>
              <AhButton
                size="sm"
                onClick={() => {
                  setVersionContent(contentValue);
                  setVersionVariables(JSON.stringify(latestVersion?.variablesJson ?? {}, null, 2));
                  setVersionOpen(true);
                }}
              >
                新建版本
              </AhButton>
            </div>
          </header>
          <nav className={promptSettingsStyles.tabs} aria-label="Prompt 资产分区" role="tablist">
            {(Object.keys(tabLabels) as Array<keyof typeof tabLabels>).map((item) => (
              <button
                type="button"
                role="tab"
                aria-selected={tab === item}
                key={item}
                className={`${promptSettingsStyles.tab} ${tab === item ? promptSettingsStyles.tabActive : ''}`}
                onClick={() => selectMainTab(item)}
              >
                {tabLabels[item]}
              </button>
            ))}
          </nav>
          <div className={promptSettingsStyles.tabContent}>
            {tab === 'content' ? (
              <div className={promptSettingsStyles.contentShell}>
                <div className={promptSettingsStyles.contentToolbar}>
                  <strong>Prompt 内容</strong>
                  <div className={promptSettingsStyles.contentMeta}>
                    <span className={layout.chip}>
                      {selected.type === 'CHAT' ? 'CHAT' : '文本'}
                    </span>
                    <span className={layout.chip}>{contentValue.length} 字符</span>
                    <span className={layout.chip}>{variableEntries.length} 个变量</span>
                  </div>
                </div>
                <article className={promptSettingsStyles.prose}>
                  {contentValue.split(/\n{2,}/).map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                  {!contentValue.trim() ? (
                    <AhEmptyState compact title="尚未创建 Prompt 内容" />
                  ) : null}
                </article>
              </div>
            ) : null}
            {tab === 'variables' ? (
              <>
                <div className={promptSettingsStyles.sectionHeading}>
                  <div>
                    <h3>变量</h3>
                    <p>优先结构化查看；Raw JSON 仅在版本编辑中提供。</p>
                  </div>
                  <AhButton
                    size="sm"
                    onClick={() => {
                      setVersionContent(contentValue);
                      setVersionVariables(
                        JSON.stringify(latestVersion?.variablesJson ?? {}, null, 2),
                      );
                      setVersionOpen(true);
                    }}
                  >
                    编辑变量
                  </AhButton>
                </div>
                <div className={promptSettingsStyles.variableTable}>
                  <div className={promptSettingsStyles.tableHead}>
                    <span>变量</span>
                    <span>类型</span>
                    <span>必填</span>
                    <span>说明</span>
                  </div>
                  {variableEntries.map(([name, value]) => (
                    <div key={name}>
                      <code>{name}</code>
                      <span>{typeof value}</span>
                      <span>—</span>
                      <span>由当前版本定义</span>
                    </div>
                  ))}
                  {!variableEntries.length ? (
                    <AhEmptyState
                      compact
                      title="还没有变量"
                      description="在新版本中添加结构化变量。"
                    />
                  ) : null}
                </div>
              </>
            ) : null}
            {tab === 'playground' ? (
              <>
                <div className={promptSettingsStyles.sectionHeading}>
                  <div>
                    <h3>Playground</h3>
                    <p>输入变量并即时预览渲染结果，测试通过后再生成新版本。</p>
                  </div>
                  <AhButton
                    size="sm"
                    onClick={() => render.mutate()}
                    loading={render.isPending}
                    leftSection={<Eye size={15} />}
                  >
                    运行预览
                  </AhButton>
                </div>
                <div className={promptSettingsStyles.playground}>
                  <div className={promptSettingsStyles.playgroundForm}>
                    <AhTextarea
                      label="变量 JSON"
                      value={playground}
                      onChange={(event) => setPlayground(event.currentTarget.value)}
                      placeholder="{}"
                      minRows={9}
                    />
                    <AhButton onClick={() => render.mutate()} loading={render.isPending}>
                      Render
                    </AhButton>
                    {render.error ? <AhErrorState description={render.error.message} /> : null}
                  </div>
                  <div className={promptSettingsStyles.playgroundResult}>
                    <span className={layout.eyebrow}>渲染预览</span>
                    {render.data?.text ? (
                      <p style={{ whiteSpace: 'pre-wrap' }}>{render.data.text}</p>
                    ) : (
                      <AhEmptyState
                        compact
                        title="尚未运行预览"
                        description="输入变量后运行 Render 查看最终内容。"
                      />
                    )}
                  </div>
                </div>
              </>
            ) : null}
            {tab === 'bindings' ? (
              <>
                <div className={promptSettingsStyles.sectionHeading}>
                  <div>
                    <h3>绑定</h3>
                    <p>显示这个 Prompt 在哪些 Project / Agent / Task 中生效。</p>
                  </div>
                  <AhButton
                    size="sm"
                    onClick={() => {
                      refreshPrompt();
                      setBindingOpen(true);
                    }}
                  >
                    新增绑定
                  </AhButton>
                </div>
                <div className={promptSettingsStyles.bindingList}>
                  {(bindings.data ?? []).map((binding) => (
                    <div className={promptSettingsStyles.bindingRow} key={binding.id}>
                      <span className={promptSettingsStyles.bindingAvatar}>
                        {targetName(binding).slice(0, 1).toUpperCase()}
                      </span>
                      <div>
                        <strong>{targetName(binding)}</strong>
                        <small>
                          {labelPromptBindingTarget(binding.targetType)} · {binding.slot} ·{' '}
                          {labelPromptSelector(binding.selectorType)}
                        </small>
                      </div>
                      <AhStatusPill status={binding.enabled ? 'ACTIVE' : 'CANCELED'} />
                      <AhButton
                        size="xs"
                        variant="default"
                        onClick={() =>
                          toggleBinding.mutate({ id: binding.id, enabled: !binding.enabled })
                        }
                      >
                        {binding.enabled ? '停用' : '启用'}
                      </AhButton>
                    </div>
                  ))}
                  {!bindings.data?.length ? (
                    <AhEmptyState
                      compact
                      title="还没有 Binding"
                      description="将 Prompt 绑定到 Project、Agent 或 Task。"
                    />
                  ) : null}
                </div>
              </>
            ) : null}
          </div>
        </>
      ) : (
        <AhEmptyState
          title="选择一个 Prompt"
          description="从左侧目录选择一个资产，或创建新的 Prompt。"
          action={<AhButton onClick={() => setNewOpen(true)}>新建 Prompt</AhButton>}
        />
      )}
    </section>
  );
}

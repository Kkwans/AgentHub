import {
  AhButton,
  AhDrawer,
  AhEmptyState,
  AhErrorState,
  AhLoadingState,
  AhSelect,
  AhStatusPill,
  ArrowRight,
} from '@agenthub/ui';
import { labelPromptVersionSource } from '../../../presentation/domain-labels';
import { displayDate } from '../../shared/page-primitives';
import promptSettingsStyles from '../promptSettings.module.css';

import type { PromptLibraryModel } from '../hooks/usePromptLibrary';

export function PromptLifecycleDrawer({ model }: { model: PromptLibraryModel }) {
  const {
    lifecycleOpen,
    setLifecycleOpen,
    contentValue,
    latestVersion,
    setVersionContent,
    setVersionVariables,
    setVersionOpen,
    versions,
    labels,
    setLabelVersionId,
    setLabelOpen,
    setLabelName,
    diffFrom,
    setDiffFrom,
    diffTo,
    setDiffTo,
    versionDiff,
  } = model;

  return (
    <AhDrawer
      open={lifecycleOpen}
      onClose={() => setLifecycleOpen(false)}
      title="版本与标签"
      position="right"
      size={420}
    >
      <div className={promptSettingsStyles.lifecycleDrawerIntro}>
        版本不可变；标签是指向已发布版本的可移动指针。
      </div>
      <div className={promptSettingsStyles.lifecycleGrid}>
        <section>
          <div className={promptSettingsStyles.sectionHeading}>
            <div>
              <h3>版本历史</h3>
              <p>查看变更来源，并从任意历史版本创建新版本。</p>
            </div>
            <AhButton
              size="sm"
              onClick={() => {
                setLifecycleOpen(false);
                setVersionContent(contentValue);
                setVersionVariables(JSON.stringify(latestVersion?.variablesJson ?? {}, null, 2));
                setVersionOpen(true);
              }}
            >
              新建版本
            </AhButton>
          </div>
          <div className={promptSettingsStyles.versionList}>
            {(versions.data ?? []).map((version, index) => (
              <div
                className={`${promptSettingsStyles.versionRow} ${index === 0 ? promptSettingsStyles.versionRowActive : ''}`}
                key={version.id}
              >
                <b>v{version.version}</b>
                <span>
                  <strong>{version.changelog ?? (index === 0 ? '当前版本' : '历史版本')}</strong>
                  <small>
                    {labelPromptVersionSource(version.source)} · {displayDate(version.createdAt)}
                  </small>
                </span>
                {index === 0 ? (
                  <AhStatusPill status="READY" />
                ) : (
                  <AhButton
                    size="xs"
                    variant="default"
                    onClick={() => {
                      setLifecycleOpen(false);
                      setVersionContent(
                        String((version.contentJson as { text?: unknown })?.text ?? ''),
                      );
                      setVersionVariables(JSON.stringify(version.variablesJson ?? {}, null, 2));
                      setVersionOpen(true);
                    }}
                  >
                    基于此版本
                  </AhButton>
                )}
              </div>
            ))}
            {!versions.data?.length ? (
              <AhEmptyState compact title="还没有版本" description="创建第一个 Prompt 版本。" />
            ) : null}
          </div>
        </section>
        <section>
          <div className={promptSettingsStyles.sectionHeading}>
            <div>
              <h3>标签</h3>
              <p>控制 production、test 或实验环境使用的版本。</p>
            </div>
            <AhButton
              size="sm"
              variant="default"
              onClick={() => {
                setLifecycleOpen(false);
                setLabelVersionId(latestVersion?.id ?? '');
                setLabelOpen(true);
              }}
            >
              移动标签
            </AhButton>
          </div>
          <div className={promptSettingsStyles.labelList}>
            {(labels.data ?? []).map((label) => (
              <div className={promptSettingsStyles.labelRow} key={label.label}>
                <span>{label.label}</span>
                <strong>v{label.version}</strong>
                <AhButton
                  size="xs"
                  variant="default"
                  onClick={() => {
                    setLifecycleOpen(false);
                    setLabelName(label.label);
                    setLabelVersionId(latestVersion?.id ?? '');
                    setLabelOpen(true);
                  }}
                >
                  编辑
                </AhButton>
              </div>
            ))}
            {!labels.data?.length ? (
              <AhEmptyState
                compact
                title="还没有 Label"
                description="在版本上移动 production 或 latest 标签。"
              />
            ) : null}
          </div>
        </section>
        <section className={promptSettingsStyles.diffPanel}>
          <div className={promptSettingsStyles.sectionHeading}>
            <div>
              <h3>版本比较</h3>
              <p>比较任意两个不可变版本，确认内容与变量的实际差异。</p>
            </div>
          </div>
          {(versions.data?.length ?? 0) < 2 ? (
            <AhEmptyState
              compact
              title="至少需要两个版本"
              description="创建新版本后才能比较差异。"
            />
          ) : (
            <>
              <div className={promptSettingsStyles.diffControls}>
                <AhSelect
                  label="起始版本"
                  value={diffFrom}
                  onChange={(value) => setDiffFrom(value ?? '')}
                  data={(versions.data ?? []).map((version) => ({
                    value: String(version.version),
                    label: `v${version.version}`,
                  }))}
                />
                <ArrowRight size={16} aria-hidden="true" />
                <AhSelect
                  label="目标版本"
                  value={diffTo}
                  onChange={(value) => setDiffTo(value ?? '')}
                  data={(versions.data ?? []).map((version) => ({
                    value: String(version.version),
                    label: `v${version.version}`,
                  }))}
                />
              </div>
              {diffFrom === diffTo ? (
                <AhEmptyState
                  compact
                  title="请选择不同版本"
                  description="起始版本和目标版本不能相同。"
                />
              ) : versionDiff.isLoading ? (
                <AhLoadingState label="正在比较版本" rows={1} />
              ) : versionDiff.error ? (
                <AhErrorState description={versionDiff.error.message} />
              ) : (
                <pre className={promptSettingsStyles.diffPatch}>{versionDiff.data?.patch}</pre>
              )}
            </>
          )}
        </section>
      </div>
    </AhDrawer>
  );
}

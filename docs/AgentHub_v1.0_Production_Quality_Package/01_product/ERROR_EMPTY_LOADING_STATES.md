# Loading / Empty / Error / Offline Contract

## Loading
- list → skeleton rows，保持最终 geometry。
- editor → header skeleton + content skeleton。
- Workspace → shell 立即出现，panel 内独立加载，不整页 spinner。

## Empty
说明：为什么为空 + 最可能下一步。禁止只写“暂无数据”。

## Error
必须包含：
- 人类可读标题；
- 影响范围；
- retry；
- diagnostics（折叠）；
- 如果可用，fallback action。

## Offline / Agent disconnected
Conversation 保留历史；Composer 禁用并显示 reconnect/continue CTA；不要整页 error replace。

# Workspace 样式归属审计（AH-018）

## 证据与范围

基于 d430519 源码；检查 ff160132 真实控制面截图的浅/深主题、1440×900 与 390×844。截图可见桌面三栏、拖拽分隔、底部输入区与移动端单面板标签。本次不是布局重设计，也不以旧截图证明新 CSS 已通过视觉验收。

## 删除依据

`WorkspaceView.tsx` 是此 CSS module 唯一产品导入者，只读取 `workspace`、`sessionStatus`、`mobileTabs`，没有动态索引。其他本地类名由 CSS module 隔离，不会匹配同名全局 class。

因此删除 44 个不再使用的选择器分支：contextbar/contextTitle/contextFacts/panelActions、panels/conversationShell、panel/sessionRail/conversationPanel/inspectorPanel/panelOpen、separator 及其断点/状态规则。当前布局由 WorkspaceView 的 utility class 和 ThreeColumnSplit 拥有；这些旧规则不是它们的 fallback。对应无人使用的 workspace-panel-enter 动画一起删除。混合选择器仅删除失效分支，保留活跃的全局减少动画规则。

保留终端 slot（含嵌套 :has 的展开圆角）、全局滚动条、焦点、resize、会话/检查器抽屉、移动标签、媒体断点与运行中 spin。没有拆分文件、压缩源码或提高预算。

## 去除 8 个 important 的层叠依据

- 桌面面板规则 `.workspace :global(.workspace-panel.workbench-panel)` 的特异性为 0,3,0，高于共享 `.workbench-panel` 的 0,1,0 和 `.dark .workbench-panel` 的 0,2,0；原共享声明没有 important。
- ThreeColumnSplit 分隔器子 span 的上下边界、宽度和背景由 Tailwind utility 提供，没有对应 inline style。模块的宿主 + 类名 + 两个属性选择器比 utility 更具体，并且模块规则不在 utilities layer。移除 important 后仍由同一模块规则决定默认和 hover/focus-visible 边界。没有修改实际拖拽事件、键盘处理、指针命中区或收起状态。
- 活跃拖拽时的背景/宽度仍与原来一样由 Workspace 覆盖，本次不改变视觉策略。

## 单独发现：分支未知不等于无 Git

真实桌面截图左侧会话显示“无 Git”，右侧 Git 检查器显示 main。源码 `SessionRail.tsx`、`ContextPopover.tsx` 和 `WorkspaceView.tsx` 都用 `session.branch || '无 Git'`，把未记录分支当成非 Git 仓库。应独立修复为未知状态或核对仓库信息，本 CSS 切片不改行为。

## 验证

- PostCSS 解析成功；格式化与 diff check 通过。
- `node scripts/qa/css-budget.mjs` 无错误；其他已有大文件告警保留。
- 重测试与构建按主任务资源协调暂停。最终应运行真实服务四视口/浅深主题，重点检查分隔器 hover/键盘焦点、resize、移动切换、终端展开与关闭；本切片尚无新截图验收。

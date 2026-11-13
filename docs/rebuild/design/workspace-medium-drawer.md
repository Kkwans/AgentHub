# C26：中宽 Workspace 辅助抽屉

状态：实现候选，本地回归通过；精确提交浏览器截图与键盘门待 CI。

## 实际依据

e8dc696 的 `workspace-review-diff-tablet-768.png` / `workspace-review-diff-desktop-1024.png` 显示检查器分别约240/287px；共享组件按28%分配，768图的“空白”标签拆字、代码阅读区约120px。相关源码到3794b52未变化。

## 最小合同

- ThreeColumnSplit 新增 `mediumPresentation="drawer"`，默认 inline 不变，仅 Workspace opt-in。
- 768–1179px：默认对话优先，无自动弹层；仅显式辅助栏或URL view打开。不会用桌面持久化 leftCollapsed 强制打开，也不回写桌面偏好。
- 右侧抽屉宽 `min(420px, 100% - 32px)`；辅助会话/检查器共用一个带名称的modal dialog，包含切换tabs、关闭与实际内容。背景对话保持全宽并 inert，contextbar 同步 inert。
- 对话、两个辅助面板在 medium 的打开/关闭/左右切换中维持节点身份；关闭遮罩名称“关闭辅助栏遮罩”，Escape/关闭后恢复可见入口。
- 焦点圈包含summary、auxiliary tabs及内部控件，排除hidden/inert。切tab保留仍可见的焦点；若旧内容隐藏才迁到当前关闭按钮。
- 手机<768与宽屏>=1180布局不修改；宽屏仍真实第三栏，不修改Git动作、Diff基准、请求或提交资格。

## 证明与边界

本地29测试覆盖Workspace初始关闭、modal/inert、tab焦点、Escape/遮罩恢复，以及共享组件inline兼容和medium关开后同一提交textarea/对话草稿节点。UI源码先build；web类型、lint、build与CSS预算通过。真实焦点遍历/几何/截图交由父线程E2E，不能把jsdom当浏览器验收。

既有ThreeColumn在single/medium/wide之间使用不同布局组件，跨断点可能重挂内部编辑器。本片只承诺medium内开关/切tab不重挂；外层model的staged/URL选择可保持，但不声称提交本地草稿跨断点持久化。硬刷新也无新保障。

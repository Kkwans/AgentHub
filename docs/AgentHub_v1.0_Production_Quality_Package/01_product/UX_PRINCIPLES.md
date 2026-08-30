# v1.0 UX Principles

## 1. Work over chrome
界面装饰永远不能比工作内容更显眼。

## 2. Compact, not cramped
紧凑不是把字缩到 10px，而是减少不必要容器、重复标题、重复路径和状态胶囊。

## 3. One visual decision per layer
每个层级只做一个视觉决定：Canvas → Panel → Row → Content。避免 Card 套 Card。

## 4. Keep place
用户在 Session、Diff、File、Prompt 之间切换后应保持 selection、scroll、panel size。

## 5. Errors are workflows
错误必须映射到恢复动作：Retry / Reconnect / Continue / Reopen / Open diagnostics。

## 6. Real data is the design
所有组件都以长文本、多数据、异常数据为默认设计条件，而不是 demo 数据。

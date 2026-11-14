# Session 重命名：最小闭环方案

2026-11-14 07:03 UTC。状态：只读源码评估完成，待实施；不能把已有 title 字段当作重命名功能。

## 范围与现状

`agentSessions.title` 已存在，创建时有1–240字符校验；Repository 无独立重命名/CAS，API 无专用入口。Workspace 顶栏、SessionRail、项目会话列表已有只读展示。首片仅工作区顶栏入口及轻量对话框，不同时重构归档、搜索、导出。

## 服务合同

- 新 `titleRevision` 默认0及兼容迁移，不用会随运行更新的 `lastActiveAt` 做并发版本。
- `PATCH /api/v1/sessions/:id/title`，严格 `{title, expectedRevision}`。trim 后1–240字符，版本为非负整数，拒绝额外字段。
- Repository 原子匹配 id+expectedRevision，更新 title 与 titleRevision；版本冲突409、无记录404，禁止先读后无条件写。
- 元数据改名允许运行中或已关闭 Session；不调用 adapter、不改变 Run/Session 状态、不改变最近活动时间或排序。共享 ADMIN 模型不宣传成逐用户所有权授权。

## UI 与未知写入

工作区顶栏“重命名”打开专用组件，避免继续扩大 WorkspaceView。保留编辑草稿，绑定 auth identity、Session ID 和原 revision；pending 禁止重复保存，切路由后的晚响应不得写新会话。

成功响应须核对会话与版本，更新原Session与列表缓存且不覆盖更高版本。网络错误/不匹配响应进入 unknown，只提供 GET 核对，不自动 PATCH。读回同revision仍未知，保持锁定；读回更高revision代表原CAS已不可能再覆盖，可展示当前值/被其他修改取代，不能仅因同名就声称原请求成功。关闭后重入仍保留未知范围与草稿，不能借卸载解除锁。

## 验收任务

1. DB/迁移：旧数据revision=0；并发CAS仅一个成功；版本递增，状态/Run/活动时间不变。
2. API：空白、超长、非法版本、额外字段、404、409；不启动任何Agent。
3. UI：标题/侧栏/项目列表一致；长标题截断与可读性；草稿、冲突、重复点击、关闭重入、切会话/认证、晚响应均不串写。
4. unknown：同版本读回不重投；更高版本明确显示当前结果/冲突，不编造原请求归属。
5. 双主题四视口、焦点恢复/键盘操作、错误与横向溢出、实际新截图；静态构建不替代视觉验证。
6. 冻结后专项、全仓tests/lint/types/build、独立CR与精确提交CI；开发分支提交，不合main、不部署。

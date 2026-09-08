# AgentHub v1.1.0 发布说明

## 目标

v1.1.0 是 Workspace 优先的前端重构版本。它沿用 PinHarness 的三栏工作台、实体 surface、紧凑工具栏和因果对话语言，同时保留 AgentHub 的 REST `/api/v1`、WebSocket `/ws`、数据库、认证、Approval、Git、Terminal 与 PromptOS 契约。

## 主要改动

- `@agenthub/ui` 原位升级 tokens、Workbench、Command Bar、执行 disclosure、状态指示和 reduced-motion 规则；WorkBench 样式拆为共享入口下的独立 stylesheet，保持 `@agenthub/ui/styles.css` 导入兼容；
- Workspace 按 `>=1180px` 三栏、`768-1179px` 可切换 drawer、`<768px` 单面板 tabs 适配；
- 对话显示层新增 `ConversationTurn` / `ConversationEntryView`，按真实顺序插入 thought、tool、Approval 和 streaming Assistant delta，并在长会话启用 `@tanstack/react-virtual`；
- Composer 草稿按 Session 保存，输入区支持 40–320px 调整；Terminal 进入 Workspace 底部 dock，尺寸和打开状态按 Session 保存；
- AppShell、Home、Projects、共享容器统一冷中性画布、实体 surface、8/12/14px 圆角、短阴影和有限 transform/opacity 动效。

## 版本、镜像与回滚

- 软件版本：`1.1.0`；候选镜像标签：`agenthub:2026.9.8-v1`；OCI `revision` 必须为最终已推送 commit SHA；
- 当前生产 1.0.0 回滚点：`agenthub:2026.9.5-v2`，其 image ID、Compose 配置、数据卷和其他 Agent 容器不得覆盖或删除；
- 发布只替换 `agenthub` service，不执行 `docker compose down`，不触碰 Project、PGlite/Postgres、worktrees、token 或其他容器。

## 代码级验证

已通过的切片门禁：

- `@agenthub/ui` typecheck/build、Workbench/layout/primitives Vitest：12/12；
- Workspace Vitest：9 files，40/40；Terminal dock 新增高度恢复测试通过；
- `pnpm lint`、`pnpm format:check`、`@agenthub/web typecheck`、`@agenthub/web build`、`git diff --check`；
- `pnpm qa:css-budget` 通过；全仓 Vitest `70 files / 295 passed / 10 skipped`；Mock Playwright `44/44` 通过（四档视口）；
- 已推送提交：`35dfc5e`（共享 UI 基础）、`b0eee6f`（Workspace）、`fe3fd7a`（全局壳层）、`444f817`（版本真值）、`a9c8037`（候选固化）、`fe2e49e`（响应式面板交互）、`dbb8b50`（Panel host 响应式根因）、`5653772`（Workbench 样式与动效预算）。

## 尚未宣称完成的门禁

发布候选必须继续完成真实 NAS Playwright 四视口（1440/1024/768/390，light/dark）、console/page/request error、几何/横向溢出、真实 Agent/ACP、native PTY、备份恢复、性能和独立视觉复核。当前无 `AGENTHUB_BROWSER_TOKEN_FILE`，真实部署截图、性能报告和运行时能力仍为 `UNVERIFIED`；Mock fixture 结果不能替代这些证据。对应证据应写入 `docs/qa/visual/v1.1.0/manifest.json`，在 `complete: true` 前不得把本版本视为完整验收通过，也不得替换生产服务。

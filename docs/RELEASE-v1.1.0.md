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
- 当前候选源码提交：`befa67b0d355e210276f4790d90ccaffc42c80d1`（`main` 与 `origin/main` 已同步）；
- 当前生产 1.0.0 回滚点：`agenthub:2026.9.5-v2`，image ID 为 `sha256:cf44afd240c555bb0e629af61dad2bcb3b343c7f87de69babc9323292ad2cc03`（arm64，创建于 `2026-09-05T17:03:24+08:00`）；其 Compose 配置、数据卷和其他 Agent 容器不得覆盖或删除；
- 生产只读预检：`http://192.168.5.110:3210` 返回 health `200`、版本 `1.0.0`、状态 `healthy`；本轮未替换服务；
- 发布只替换 `agenthub` service，不执行 `docker compose down`，不触碰 Project、PGlite/Postgres、worktrees、token 或其他容器。

## 代码级验证

已通过的切片门禁：

- `@agenthub/ui` typecheck/build；UI primitives/layout/workbench Vitest：6 files，25/25；
- Workspace Vitest：9 files，41/41；UI primitives/layout/workbench Vitest：6 files，25/25；ACP adapter：2 files，12/12；Terminal dock、长会话窗口与辅助栏焦点恢复均覆盖；
- `pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm build`、`pnpm qa:css-budget`、`git diff --check`；Workspace CSS 16366 bytes，小于 16384 bytes 门限；
- 全仓 Vitest（单 worker、hook/test timeout 120s）：70 files，66 passed / 4 skipped；305 tests 中 295 passed / 10 skipped；
- Mock Playwright：最新 Workspace 四视口 `4/4` 通过（含初始跟随与 cwd 可见性）；完整 44 用例首轮 `42/44`，两个 Settings 桌面用例因 NAS 负载下定位超时，隔离复跑 `2/2` 通过。fixture 只拦截 REST，Vite `/ws` 仍报告 `ECONNREFUSED 127.0.0.1:3210`，不代表真实运行时；
- 版本真值：`pnpm release:version-truth 1.1.0 --allow-incomplete` 通过，11 个 workspace package 与 AppShell 版本一致，residues 为空；
- 已推送提交（按功能切片）：`35dfc5e`（共享 UI 基础）、`b0eee6f`（Workspace 对话）、`fe3fd7a`（全局壳层）、`444f817`（版本真值）、`a9c8037`（候选固化）、`fe2e49e`（响应式面板交互）、`dbb8b50`（Panel host 根因）、`5653772`（Workbench 样式与动效预算）、`427cf72`（验证证据）、`8c817a5`（动效与移动反馈）、`9eb3f88`（辅助栏交互）、`07705db`（轮次虚拟化）、`b188a8c`（触控目标）、`29def87`（文字密度）、`28bd4c9`（验收断言）、`17de41e`（抽屉宿主）、`1977333`（Command Bar）、`6cbc82b`（抽屉宽度）、`371203d`（移动面板测试）、`5ae223e`（初始跟随与上下文事实）、`0d0f257`（ACP 版本元数据）、`52de0c7`（忽略伪滚动）、`befa67b`（cwd 可见性断言）。

## 尚未宣称完成的门禁

发布候选必须继续完成真实 NAS Playwright 四视口（1440/1024/768/390，light/dark）、console/page/request error、几何/横向溢出、真实 Agent/ACP、native PTY、备份恢复、性能和独立视觉复核。当前无 `AGENTHUB_BROWSER_TOKEN_FILE`，真实部署截图、性能报告和运行时能力仍为 `UNVERIFIED`；独立复核已在当前源码/mock 上确认 P0=0、P1=0，但不能替代真实部署视觉验收；Mock fixture 结果不能替代这些证据。对应证据应写入 `docs/qa/visual/v1.1.0/manifest.json`，在 `complete: true` 前不得把本版本视为完整验收通过，也不得替换生产服务。

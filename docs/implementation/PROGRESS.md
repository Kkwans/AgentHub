# 实施进度

最后更新：2026-08-09

## 当前

- M0：已完成。
- M1：已完成。
- M2：进行中。
- 已创建 durable Goal。
- 已初始化 `main` 分支与 pnpm monorepo。
- 已固定 Node.js 24、pnpm 11、TypeScript、ESLint、Prettier、Vitest、Playwright 与 CI 基线。
- 已锁定 ACP v1 依赖：SDK `1.3.0`、codex-acp `1.1.14`、claude-agent-acp `0.66.0`。

## 环境事实

- NAS 架构：Linux ARM64。
- 宿主机 Codex：`0.146.0`，已有 ChatGPT 登录。
- Claude Code、Hermes、OpenClaw 通过现有 Docker 容器部署。
- Hermes 当前没有 `/volume2/Project` 工作区映射；MVP 必须返回 `WORKSPACE_UNMAPPED`，不得修改 Compose。
- OpenCode 当前宿主机未安装；live test 允许 `SKIP: MISSING`，fixture 必须通过。
- `node-pty@1.1.0` 在当前 Linux ARM64 环境无可用预构建产物，且宿主机无本地编译工具；已作为 optional dependency 安装并禁用 build script。运行时必须报告 Terminal capability=false，不得用普通 Shell 冒充 PTY。

## 验证记录

M0：

- `pnpm install --frozen-lockfile`：通过。
- `pnpm lint`：通过。
- `pnpm typecheck`：通过，9 个 workspace project 完成。
- `pnpm test`：通过，1 个文件、1 个测试。
- `pnpm build`：通过，全部 package 与 Web production bundle 完成。
- `pnpm format:check`：通过。

M1：

- 初始 migration：20 张 MVP 表，`drizzle-kit check` 通过。
- PGlite startup/migration、Prompt Version immutable、Label 事务移动、Approval exactly-once、Session seq unique/monotonic：通过。
- REST `/api/v1`、统一错误信封、request ID、Zod validation：通过。
- 单 `/ws` topic、subscribe、`afterSeq` replay 与实时 publish：通过真实本地 TCP 测试。
- Session/Run/Task 状态机与 deterministic fake adapter 的 complete/approval/cancel/fail/disconnect：通过。
- 全仓：4 个测试文件、18 个测试通过；lint、typecheck、build、format check 通过。

## 未验证项

- Claude Code 容器内 adapter/auth/session 尚未 live 验证。
- Hermes 与 OpenClaw 容器尚未启动，本轮尚未改变其状态。
- UI 尚未通过 TX5Pro 或远程浏览器验证。

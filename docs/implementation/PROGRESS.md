# 实施进度

最后更新：2026-08-09

## 当前

- M0：已完成。
- M1：已完成。
- M2：已完成。
- M3：进行中。
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

M2：

- Process Supervisor：绝对 executable、argv/`shell:false`、进程组、timeout、输出上限、脱敏及 protocol cancel→TERM→KILL：通过。
- Docker 显式接管：完整 container ID 复验、MANUAL/ON_DEMAND、最长工作区映射、实际 mount 复验、活动 Session 停止保护和固定 Agent 命令：通过。
- ACP v1：initialize、session/new/load/resume/close、prompt、permission、cancel、tool/file/plan/usage 归一化与真实 stdio fixture：通过。
- 五类 Agent 注册、capability 与 preflight 状态持久化：通过。
- Session/Run/Message/Event/Approval、exactly-once 决策、Git BEFORE/AFTER SHA、取消、关闭与服务重启恢复：通过。
- 全仓：12 个测试文件、45 个测试通过；lint、typecheck、build 通过。
- Codex live：`codex-acp@1.1.14` 完成 ACP v1 initialize 和 `session/new`，状态 `READY`；宿主机 Codex 仍单独报告 `0.146.0` 与 ChatGPT 已登录。
- Claude Code live：容器内 Claude Code `2.1.168` 可用，但缺少 `claude-agent-acp`，状态 `BROKEN`；未运行 `npx latest`，未修改镜像/Compose。
- Hermes live：Hermes Agent `0.10.0` 和 `hermes acp` 存在；当前 Project 无映射，AgentHub preflight 返回 `WORKSPACE_UNMAPPED`。
- OpenClaw live：OpenClaw `2026.6.11` 提供 `openclaw acp`；清洁 stdio 后 Gateway 返回 scope upgrade pending approval，状态 `AUTH_REQUIRED`；该版本未确认存在 `agent exec` 子命令，不启用回退。
- live probe 后 `claude-code`、`hermes`、`openclaw-official` 均恢复原始 `exited` 状态。

## 未验证项

- Claude Code 需在镜像内固定安装 `@agentclientprotocol/claude-agent-acp@0.66.0` 后才能验证 auth/session。
- Hermes 需增加覆盖 Project 的部署级 workspace mount 后才能验证项目 Session；本次未修改 Compose。
- OpenClaw 需在原生 Gateway 中批准 scope upgrade 后才能验证 `session/new` 和 prompt；本次未替用户批准授权请求。
- UI 尚未通过 TX5Pro 或远程浏览器验证。

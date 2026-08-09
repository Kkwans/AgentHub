# 实施进度

最后更新：2026-08-09

## 当前

- M0：已完成。
- M1：已完成。
- M2：已完成。
- M3：已完成。
- M4：已完成。
- M5：已完成。
- M6：已完成。
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

M3：

- Project add/preflight：`realpath`、目录/读写权限、Git/branch/dirty、AGENTS.md/CLAUDE.md/OpenSpec 与 package manager hints：通过。
- 只读文件树/内容：root lexical containment、realpath containment、symlink escape、`../`、绝对路径、单/双编码 traversal、大文件和二进制限制：通过。
- Git：status、Diff、commits、branches、staged/selected-files commit；selected commit 不混入其他已 staged 文件：通过。
- Run Git snapshot：BEFORE/AFTER 状态与 SHA 持久化，snapshot 失败不改变 Agent Run outcome：通过。
- Terminal：真实 `node-pty` open/input/resize/output/close 生命周期和独立 `terminal:*` topic 已实现；无 native binding 时禁止 shell fallback。
- 当前 NAS runtime 诊断：`available=false`、`PTY_NATIVE_BINDING_UNAVAILABLE`、`linux/arm64`。
- M3 聚焦回归：Project/Git/Terminal/Session 共 16 项测试通过；lint、typecheck、全仓 build 通过。

M4：

- 中文 Web Shell：概览、项目、任务、Agent、会话、PromptOS、设置一级导航与共享 TanStack Query/API/WebSocket 数据层：完成。
- Dashboard 基线只呈现待批准、运行中、Agent 健康和 Project，不使用 KPI 卡片墙。
- Coding Workspace：可调多栏 Session、对话/工具/Approval、只读文件/Monaco、Diff、Git、Run 上下文和固定 Composer：完成。
- Composer 固定展示 Agent、模型、模式、Project/cwd、branch、PromptOS、Skill；无 capability 时隐藏模型、模式和 Terminal 控件。
- 响应式：桌面多栏，900px 以下使用 Workspace tabs 和侧边检查器，390px 使用全宽 drawer；实现导航抽屉、键盘 Escape、焦点可见和 reduced-motion。
- Agent UI：显式注册宿主机/Docker Execution Target、完整 container ID、工作区映射、启动策略、内置 Agent Profile、preflight、生命周期操作与 capability 调试视图：完成。
- UI 文案：操作、说明、表单、状态、错误和空状态使用简体中文；Agent/PromptOS/Git/Terminal/model/mode/path/branch/command/protocol/vendor data 保留原文。
- M4 回归：`pnpm lint`、`pnpm typecheck`、Web 单元测试、Web production build 均通过。

M5：

- Prompt stable identity 与 immutable Version：每次保存由事务锁定 Prompt 并分配下一版本，自动移动 `latest`；变量模板必须在 object JSON Schema 中声明。
- Label：`latest` 禁止手工移动/删除，`production` 与自定义标签支持事务移动和快速回退。
- Diff/Render：TEXT 按文本、CHAT 按 role/message JSON 结构生成 Diff；Render 返回 resolved version、label、content hash、缺失变量和最终内容。
- Binding：实现 Project → Agent → Task、同 slot priority、LABEL/VERSION selector、启停和完整 provenance。
- Run 集成：发送前解析 Context Preview；缺 required variable 阻断，成功 Run 保存 prompt/version/label/hash/binding/target 来源和 final context hash。
- Skill：只扫描 Project 内 `.agents/skills`/`.codex/skills` 的 `SKILL.md` metadata 并支持绑定；realpath containment 阻止 symlink escape，不复制 AGENTS.md/CLAUDE.md，不安装 Marketplace。
- 中文 PromptOS UI：Prompt 列表/详情、版本、标签、差异、绑定、渲染演练、上下文预览、Skill 扫描/绑定；保存按钮明确为“创建新版本”。
- Workspace Composer：展示真实 PromptOS 生效项和 provenance，支持变量 JSON 重新解析，缺变量/解析异常时禁止发送 Run。
- M5 聚焦回归：PromptOS service 7 项、Session/Run 4 项、REST 1 项、Web UI 3 项通过；`pnpm lint`、`pnpm typecheck`、全仓 build 通过。

M6：

- Goal/Task：完成 CRUD、Goal 状态、Task 看板排序与状态机、“交给 Agent 开始”、Run 完成进入待审阅、失败/取消进入受阻、用户 `APPROVE` 后才完成。
- Dashboard：只聚合运行中 Session、待 Approval、待审阅/受阻 Task、最近终态 Run、Git outcome 与 Agent 健康。
- Auth：loopback 默认 `local_trusted`；非 loopback 在监听前强制 `token`。API token 使用 256-bit 随机值，只在创建时显示一次，数据库只保存 SHA-256 hash；HTTP 与 `/ws` 统一认证。
- Production：Server 自动托管 `apps/web/dist` 并提供 SPA fallback；临时 production Server 使用内存 PGlite 启动，`/api/v1/health` 返回 `web=true`，`/tasks` 返回 Web index。
- 核心 E2E：确定性贯通 Project → PromptOS → Task → Agent → Approval exactly-once → Git BEFORE/AFTER → Dashboard → 人工审阅。
- 浏览器 E2E：NAS 本地 Playwright Chromium 在 1440、1024、768、390 四种视口共 12 项通过；根据 1024 截图修复 Dashboard Agent 健康区挤压。
- Live gate：Codex 真实 ACP preflight、Session、流式响应和 cancel notification 通过；Claude/Hermes/OpenClaw 容器固定命令验证通过；OpenCode 明确 `SKIP: MISSING`。
- Live gate 后 `claude-code`、`hermes`、`openclaw-official` 均恢复原 `exited` 状态，完整 container ID 未变化。
- 最终全仓 gate：`pnpm lint`、`pnpm typecheck`、`pnpm build`、`pnpm format:check` 通过；标准 Vitest 为 22 个文件通过、1 个 live 文件按环境 gate 跳过，82 项通过、5 项跳过；Playwright 12 项通过；live Vitest 5 项通过。

## 未验证项

- Claude Code 需在镜像内固定安装 `@agentclientprotocol/claude-agent-acp@0.66.0` 后才能验证 auth/session。
- Hermes 需增加覆盖 Project 的部署级 workspace mount 后才能验证项目 Session；本次未修改 Compose。
- OpenClaw 需在原生 Gateway 中批准 scope upgrade 后才能验证 `session/new` 和 prompt；本次未替用户批准授权请求。
- 当前 NAS 无 node-pty ARM64 native binding，Terminal UI 必须显示 capability=false；未伪装 PTY。
- UI 已通过 NAS 本地 Playwright Chromium 四视口验证，但尚未通过 TX5Pro 实机验证。

# 实施进度

最后更新：2026-08-10

## 当前 Goal：绿联 NAS Compose 迁移

- 用户已明确要求把 v0.3.0 从 host-native systemd 改为绿联 Docker Compose，并授权
  `user: 0:0` 与 `privileged: true`；新 durable Goal 已建立。
- 已确认此前 `192.168.5.110:3210` 拒绝连接的直接原因是 systemd 只监听
  `127.0.0.1:3210`，服务本身健康。
- 已新增 ARM64 Compose、固定 digest Dockerfile、root-only token helper、部署/回滚说明和
  ADR-014。镜像 `agenthub:0.3.0-nas.1` 已离线构建并通过隔离 PGlite、token auth、Web、
  Project API 与 host Docker API 烟测。
- 正式冷备份、systemd → Compose 切换、绿联项目列表、LAN/TX5Pro、重启恢复和 GitHub CI
  尚待本 Goal 后续步骤完成；在这些证据完成前不声明 Compose 上线成功。

## v0.3 当前状态

- 已创建新的 durable Goal，范围为 UI/UX 重构、真实浏览器验收、host-native 部署和自身 Project 注册。
- 现场确认重构前 AgentHub 未部署：无进程、Docker 容器、systemd unit 或 `3210` 监听。正式部署固定为 host-native `systemd` 服务、`127.0.0.1:3210`，不会创建 AgentHub Docker。
- 已完成现有 UI 审计和重构：`packages/ui` 从空壳升级为官方 Radix Themes + Phosphor 组件层；移除 Web 的 Lucide 依赖，保留 Tailwind 4、TanStack Query、Monaco 与 react-resizable-panels。
- App Shell 已改为石墨中性色中文工具界面；新增可用的 `Ctrl/Cmd+K` 命令面板、skip link、连接状态和 Radix 移动导航 Dialog。
- 概览、Task、Agent、设置采用连续控制面和 1px 分隔，减少同质卡片墙；Task/Run 使用橙色“运行脊柱”表达执行阶段。
- PromptOS 和 Workspace 使用 Radix Tabs；Remote Node revoke 使用 AlertDialog；Worktree Review 使用 Dialog；重点动作使用标准 Button、Badge、Callout、Skeleton 与 IconButton。
- 移除无行为的 Session 筛选；未支持的新建 Terminal 明确 disabled 并说明 native PTY 限制；Approval 仍只展示 Agent 原始合法选项。
- Web 单元测试 10 项通过；全仓非沙箱 Vitest 33 个文件通过、3 个 live 文件按 gate 跳过，114 项通过、7 项跳过；lint、typecheck 与 production build 通过。
- TX5Pro 最终实机验收 20 项全部通过：1440/1024/768/390、真实 Codex Run、Task 人工确认、命令面板、移动导航、Workspace drawer、0 个 request/console/page/HTTP 错误和 0 外部请求。证据归档于 `docs/qa/tx5pro/2026-08-10-v03-ui/`。
- v0.3.0 已正式部署为 `agenthub.service`：`Kkwans:admin`、`enabled`、`active/running`、仅监听 `127.0.0.1:3210`，健康返回 PGlite/Web 可用；不是 Docker 部署。
- 持久目录为 `/volume2/Project/.agenthub/central/{data,worktrees}`，mode `0700`；env 为 `/etc/agenthub/agenthub.env`，mode `0640`。受控重启后健康与注册记录均恢复。
- 正式数据库已注册 `AgentHub NAS 宿主机`（`LOCAL_HOST/READY`）和 AgentHub 自身 Project（`ACTIVE`）；Project preflight 路径、权限、Git/main、AGENTS.md 与 pnpm 全部 PASS。
- 部署前后 Claude Code、Hermes、OpenClaw 容器保持原 `exited` 状态，未修改 Docker/Compose、镜像或 volume。
- 版本元数据已统一为 v0.3.0；部署证据、校验和和回滚见 `docs/qa/nas/2026-08-10-v03-deployment/`。公开 GitHub `main` 与 annotated tag `v0.3.0` 已推送。
- 最终全仓 gate 遇到 NAS `/tmp` tmpfs 100% 的 `ENOSPC` 后，没有删除其他项目缓存；改用 `/dev/shm/agenthub-test-tmp` 重跑，33 个文件通过、3 个 live 文件按 gate 跳过，114 项通过、7 项跳过。
- GitHub Actions run `31374423006` 用时 2m23s，install、lint、typecheck、test、build 和 Playwright E2E 全部通过。
- 正式服务已设置专用 `TMPDIR=/volume2/Project/.agenthub/central/tmp`，避免 NAS 全局 `/tmp` 100% 影响 Agent 子进程；更新前 env/unit 已备份，重启后进程环境、健康、Project 和容器未变性均通过。
- 设计合同与回滚见 `docs/implementation/V0.3_UI_REDESIGN.md`。

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
- v0.1 与 v0.2 TX5Pro 实机验收均已完成；Remote Node 报告与截图归档于 `docs/qa/tx5pro/2026-08-10-remote-node/`。

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

TX5Pro 实机验收：

- TX5Pro：Windows NT `10.0.26200.0`、Node `24.0.0`、Playwright `1.62.1`、Google Chrome `150.0.7871.182`。
- 通过 SSH local forward 访问仅监听 NAS loopback 的隔离 AgentHub，不创建 token、不复用跨项目凭据、不触碰 Docker/Compose。
- 从空 PGlite 数据库完成 Execution Target → Project → Codex preflight → Goal/Task → Session/Run stream → 待审阅 → 人工确认完成闭环。
- 修复真实 ACP 可选 `externalRunId` 与 context-only `usage_update` 导致的空 Drizzle patch；新增回归测试。
- 修复 Workspace Session 列表状态滞后，并让 App Shell 建立和维持统一全局 `/ws` 连接。
- 修复后最终单次验收 25 项全部通过；1440、1024、768、390 均无根页面横向溢出，全局 WebSocket 已连接。
- 浏览器运行时结果：0 个 request failure、0 个 console error、0 个 page error、0 个 HTTP 4xx/5xx、0 个外部请求。
- TX5Pro 修复后全量 gate：`pnpm lint`、`pnpm typecheck`、`pnpm build`、`pnpm format:check` 通过；非沙箱 Vitest 22 个文件通过、1 个 live 文件按 gate 跳过，84 项通过、5 项跳过；Playwright 12 项通过。
- 最终验收进程与 SSH 隧道已回收，TX5Pro `43210` 和 NAS `3210` 无遗留监听。

v0.2 Worktree Task Runner：

- W1：独立 Execution 状态机、`worktree_executions` migration/repository、partial unique
  index、并发状态移动和 restart recovery 已完成。
- W2：每 Project 单并发 FIFO、managed Git worktree、Agent Session/Run、Approval 等待、
  Review/Rework/Cancel、冲突预检和显式 `--no-ff` Merge Gate 已完成。
- W3：中文 Task 控制面、Execution 轨道、Review evidence、Diff、继续修改、取消和批准合并
  已完成；保留 v0.1“直接运行”入口。
- Worktree UI：单元测试 7 项通过；Playwright 1440、1024、768、390 共 12 项通过。
- Worktree live：独立临时 Git repository + PGlite + 宿主机 pinned Codex 完成真实修改、
  Review Diff、受管 commit 与双亲 merge commit；1 项通过，耗时 64.41 秒。
- Worktree 最终标准 gate：`pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm build`
  通过；Vitest 25 个文件通过、2 个 live 文件按环境 gate 跳过，97 项通过、6 项跳过。
- live fixture 已在独立 Server 关闭后清理；未触碰现有 Project、Agent Docker、Compose、
  镜像或 volume。

v0.2 Remote Node：

- R1：一次性 registration token、Ed25519 设备身份、challenge/signature、revoke、heartbeat、
  reconnect、1 MiB message limit 与 `/node/ws` gateway 已完成。
- R2：`REMOTE_NODE` Execution Target、授权 roots、Agent inventory、远程 Project preflight、
  只读文件，以及 Session/Run/Approval/cancel/close 已完成；Remote Git/Worktree/Terminal 按
  v0.2 范围明确返回 unsupported。
- Remote Node 自动化：协议、identity、gateway、daemon、repository、workflow 与安全边界
  已覆盖；v0.2 最终标准 Vitest 为 33 个文件通过、3 个 live 文件按 gate 跳过，112 项通过、
  7 项跳过。
- Remote Node UI：中文注册、一次性 secret、连接命令、在线状态、fingerprint、roots、
  inventory、诊断与 revoke 完成；Web 单元 8 项、Playwright 四视口 16 项通过。
- 真实 live：临时 PGlite + Central Server + Node daemon + 宿主机 pinned Codex 完成注册、
  远程 Project、preflight、Session stream 与 close；Assistant 返回 `REMOTE_OK`。
- TX5Pro：Windows 10 build 26200、Chrome `150.0.7871.182`，通过 SSH local forward 操作
  中文 UI；26 项检查、1440/1024/768/390、0 request failure、0 console/page error、
  0 HTTP 4xx/5xx、0 外部请求。证据见 `docs/qa/tx5pro/2026-08-10-remote-node/`。
- 验收临时 Server、Node、PGlite 与隧道已回收，NAS `3210`、TX5Pro `43210` 无遗留监听；
  未修改或启停现有 Agent Docker/Compose、镜像或 volume。
- v0.2 最终 gate：`pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm build` 全部通过；
  Playwright 四视口 16 项通过；Remote Node 与 Worktree 真实 Codex live 2 项通过，耗时
  100.08 秒。
- 为遵守“不改动现有 Agent Docker/Compose/数据”的 v0.2 Goal，最终 live 只选择 Remote Node
  与 Worktree 两个临时 fixture；会启动/停止现有 Agent 容器的 `agent-preflight.test.ts` 未重跑。
  v0.1 已归档该容器 live 结果，本次相关 Docker/Agent Profile 代码未修改。
- release gate 后临时 fixture 均已清理，NAS `3210`/TX5Pro `43210` 无遗留监听；Claude、
  Hermes、OpenClaw 容器保持原 `exited` 状态及原完整 container ID。
- v0.2.0 版本元数据、部署/API/数据库/安全/排障/发布说明、公开 GitHub main 与 tag 已完成。

## 未验证项

- Claude Code 需在镜像内固定安装 `@agentclientprotocol/claude-agent-acp@0.66.0` 后才能验证 auth/session。
- Hermes 需增加覆盖 Project 的部署级 workspace mount 后才能验证项目 Session；本次未修改 Compose。
- OpenClaw 需在原生 Gateway 中批准 scope upgrade 后才能验证 `session/new` 和 prompt；本次未替用户批准授权请求。
- 当前 NAS 无 node-pty ARM64 native binding，Terminal UI 必须显示 capability=false；未伪装 PTY。

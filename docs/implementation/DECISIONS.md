# 实施决策

## D-001：合同优先级

状态：已接受。`AgentHub_Codex_Prompt.md` 为执行合同，`AgentHub_PromptOS_MVP_技术方案.md` 为产品/架构合同；冲突时执行合同优先，当前用户指令最高。

## D-002：ACP 版本

状态：已接受。v0.1 使用稳定 ACP v1；v2 只保留隔离扩展点。依赖固定为 `@agentclientprotocol/sdk@1.3.0`、`codex-acp@1.1.14`、`claude-agent-acp@0.66.0`。

## D-003：现有 Docker Agent 接管

状态：已接受。允许显式注册后 inspect/start/stop/exec 固定 Agent 命令；不重建、不修改 Compose、不删除；container ID 每次运行前重验。默认手动启动，逐 Profile 可选按需启动，永不自动停止。

## D-004：OpenClaw 路径

状态：已接受。优先官方 `openclaw acp`，缺失时检测 `openclaw agent exec` 单回合回退。npm Gateway SDK 占位包不进入 v0.1。

## D-005：Terminal 能力分层

状态：已接受。v0.6 交付 Local Project Terminal：能力可用时使用官方 xterm.js + node-pty，
服务端只提供 allow-list shell、root containment、环境白名单和 Project owner UID/GID drop；
Docker/Remote Terminal 不进入本版本。普通构建无法提供 ARM64 native binding 时，运行时必须显示
`PTY_NATIVE_BINDING_UNAVAILABLE`，不安装系统工具，也不以普通子进程管道模拟 PTY；正式 NAS 发布
通过专用 ARM64 native builder 产出可验证的 `pty.node` 后，能力才可标记 `READY`。详细边界见
`docs/ADR/ADR-017-Local-Project-Terminal-Delivery.md` 与 `docs/ADR/ADR-018-ARM64-Native-PTY-Image.md`。

## D-006：UI 语言

状态：已接受。用户操作与解释文案使用简体中文；Agent、PromptOS、Git、Terminal、模型、模式、路径、分支、命令、协议和供应商原始数据保留专业原文。

## D-007：v0.2 实施顺序

状态：已接受。先实现 Worktree Task Runner，再实现 Remote Node。Worktree 先固化任务隔离、
队列、审阅和 merge gate 语义；Remote Node 随后复用这些领域契约，仅替换执行位置与传输层。

## D-008：Worktree 生命周期与合并

状态：已接受。Worktree Execution 使用独立持久状态机，每 Project 单并发，Review 占用
队列槽位。只有用户显式批准后才创建受管 commit 并执行 `--no-ff` merge；不自动清理
worktree 或 task branch。详细依据见 `ADR-012`。

## D-009：Remote Node 身份与传输

状态：已接受。每个 Node 使用一次性 registration token 建立独立 Ed25519 设备身份，并主动连接
中央 `/node/ws`。生产必须使用 `wss://`，仅 loopback 开发允许 `ws://`；provider credential、
private key 与 auth 文件始终留在 Node。中央只发送固定 RPC allow-list，不提供 SSH 或通用 shell。
详细依据见 `ADR-013`。

## D-010：当前 NAS 改用 privileged Compose

状态：已接受。用户明确取代当前 NAS 的 host-native systemd 上线方式，固定使用绿联 Docker
Compose、root 和 privileged；Project/PGlite/worktree/TMPDIR/Codex HOME/Docker socket 均显式
挂载，局域网入口强制认证。首次迁移的 API token 路径已由 D-011 修订为网页管理员账号；
systemd 与冷备份保留为回滚，不修改既有 Agent Compose。
详细依据见 `ADR-014`。

## D-011：网页登录使用本机管理员账号

状态：已接受。用户明确拒绝让普通用户从 NAS secret 文件复制 token。非 loopback 部署保留
`AGENTHUB_AUTH_MODE=token` 配置名和 Bearer token API 兼容性，但 Web 产品路径改为首次创建
唯一管理员、用户名/密码登录和 HttpOnly Cookie。API token 只出现在折叠的外部集成高级区域；
不删除既有 bootstrap secret，以保留已验证的 CLI 与回滚路径。详细依据见 `ADR-015`。

## D-012：v0.5 按真实用户旅程发布

状态：已接受。v0.5 不再以页面存在、空状态截图、fixture Playwright 或 HTTP 200 作为功能完成
证据。发布必须分别通过 fixture 视觉测试、真实后端浏览器测试和真实 Agent runtime，并在正式
Compose 上完成登录 → 准备 Target/Project/Agent → Session/Run → Approval → Git → Task Review 的
可操作旅程。普通用户不得输入 token、Session ID、Task UUID 或执行 NAS 命令；
前端筛选不能替代服务端 Project、cwd、Agent readiness 与 Execution Target 兼容校验。

## D-013：Approval 决定与 Agent 投递分离

状态：已接受。用户决定、Outbox 和审计事件原子写入，同一 option 幂等、不同 option 冲突。
当前 ACP/Remote adapter 没有跨重启的幂等回执，因此只声明用户决定 exactly-once；含糊投递
标记为 `UNKNOWN`，发送前失败标记为 `DEAD`，两者均不自动重投。详细依据见 `ADR-016`。

## D-014：Task 返工创建新 Session 与 Run

状态：已接受。普通 Task 的 `REWORK` 必须携带非空反馈，并创建新的 Session 与 Run；不复用
可能已经关闭、断开或带有旧上下文的原 Session，也不只把 Task 状态翻回 `IN_PROGRESS`。
新 Run 的首条用户消息保存反馈、原 Task 描述与 acceptance criteria。启动失败时 Task 进入
`BLOCKED`，新 Session 保留为可诊断证据。Worktree Execution 继续使用其独立 rework 协议，
不受此决策替换。

## D-015：Monaco 必须本地加载并延后释放 Diff 模型

状态：已接受。Workspace 与 PromptOS 不允许依赖默认 jsDelivr CDN；Monaco 0.56、语言 worker
和编辑器资源由 Vite 路由级按需加载，避免 CSP、离线和供应链路径不一致。为兼容
`@monaco-editor/react@4.7.0` 的 DiffEditor 清理顺序，`SafeDiffEditor` 在组件卸载完成后释放
original/modified model，避免先释放 model 再销毁 editor 的运行时异常。该取舍保留较大的
编辑器懒加载 chunk，但不增加首屏同步依赖；后续性能优化不得恢复外部 CDN。

## D-016：共享表单必须把可访问关系绑定到真实控件

状态：已接受。`@agenthub/ui` 的 `Field` 统一生成说明与错误节点 ID，并将
`aria-describedby`/`aria-invalid` 合并到实际的 input、textarea 或 select，而不是只放在外层布局
容器。`FormTextField`/`FormTextArea` 默认使用 `autocomplete="off"` 和稳定 `name`（显式 `name`
优先，否则回退到 `id`）；认证字段仍由 AccessGate 显式指定 `username`、`current-password` 或
`new-password`。这样不改变业务表单数据，只修复屏幕阅读器、浏览器自动填充和错误定位语义。
回归测试见 `apps/web/src/components/FormFields.test.tsx`。

## D-017：NAS 本地 Playwright 是唯一正式视觉门禁

状态：已接受（2026-08-17）。视觉验收只由 NAS 本地 Playwright Chromium 连接真实部署目标完成，至少覆盖 1440/1024/768/390 四个视口、稳定截图、console/页面错误、横向溢出和关键交互断言。外部设备、人工浏览器和远程桌面不属于验收流程，也不是发布前的可选补充；没有本地浏览器运行能力时，门禁必须明确标记为未验证。旧版本报告和截图目录仅作为历史事实保留，不改变当前门禁。
## D-018：Host ACP 降权写入 Codex Session Store

状态：已接受（2026-08-17）。AgentHub Compose 继续以 root 运行以访问 Docker socket，但 Host
ACP 子进程按 `AGENTHUB_PROJECT_OWNER_UID/GID` 降权，并显式使用 `CODEX_HOME`。这样 Codex
thread JSONL 由实际项目用户创建，桌面 Codex 可以恢复和归档；不会对整个 Codex HOME 做递归
权限改写，历史 session 文件只在部署迁移中按明确清单修复 owner。

## D-019：Docker Agent 可复用映射覆盖的 Host Project

状态：已接受（2026-08-17）。Project 与 Agent 不要求执行目标 ID 完全相同；当 Project 位于
Host target 且 Agent 为 Docker target 时，仅在注册的 workspace mapping 覆盖 canonical cwd 的
情况下允许创建/恢复 Session。服务端再次执行该边界校验，前端筛选只是能力提示，不能替代校验。

## D-020：ACP Session 配置来自 configOptions

状态：已接受（2026-08-17）。model、mode 不猜测供应商 CLI 参数：ACP `session/new` 返回的
`configOptions`/`modes` 是唯一发现来源；预检 smoke 会持久化 model/mode 选项，创建 Session 时
使用 `session/set_config_option` 或 `session/set_mode` 透传用户选择。没有真实选项时保留明确的
Agent 默认状态，不伪造可选值。

## D-021：Codex egress proxy 仅允许按子进程显式启用

状态：已接受（2026-08-17）。NAS 若只能通过本机代理访问 Codex 上游，使用
`AGENTHUB_CODEX_PROXY_URL` 作为可选 Compose 参数，并只注入 Host Codex ACP 子进程；不把
`HTTP_PROXY`/`HTTPS_PROXY` 注入 AgentHub 服务端或 Docker Agent。当前部署默认关闭，启用前需明确
确认该网络外发路径和代理地址。

## D-022：ACP transport warning 不得记为成功

状态：已接受（2026-08-17）。当 ACP assistant stream 仅返回 WebSocket/HTTPS fallback、stream
disconnected、request connection refused 或 transcript save failure 等传输诊断文本时，归一化为
`AGENT_TRANSPORT_FAILED`，并对 URL 脱敏；不能因为 ACP response 的 `stopReason=end_turn` 把 Run
标记为 `COMPLETED`。

## D-023：Session model/mode 只使用运行时真实选项

状态：已接受（2026-08-17）。Session 配置 API 只接受单字段 `model` 或 `mode`，选项来源为 ACP
`configOptions`/`modes`；适配器按 Session 串行处理更新，成功后才持久化并发布
`agent.configuration.updated`。OpenClaw `agent exec` 或无候选项时不显示伪造控件，供应商不支持时返回
`SESSION_CONFIGURATION_UNSUPPORTED`。

## D-024：Codex HTTP-only workaround 不等同于真实 Run 成功

状态：已接受（2026-08-17）。NAS 代理环境下 Codex ACP 通过 scoped `CODEX_CONFIG` 使用
`openai_http`/`supports_websockets=false`，不修改用户 `config.toml`，不设置会改变 ChatGPT OAuth 语义的
`MODEL_PROVIDER`。如果 runtime 仍返回 403、connection refused 或 stream disconnected，只记录
`AGENT_TRANSPORT_FAILED`，继续保留配置读取/切换能力，但不把 Session 创建或 health 200 当成消息链路成功。

## D-025：Host ACP transcript owner 固定为项目用户

状态：已接受（2026-08-17）。Compose 服务可继续 root/privileged 以执行显式 Docker 控制，但 Host ACP
子进程固定以 `AGENTHUB_PROJECT_OWNER_UID/GID` 运行；迁移只修复明确挂载 `.codex` 条目的 owner，不读取、删除或
重写 transcript 内容。旧文件不存在或损坏时仅记录事实。

## D-026：NAS overlay 必须同步运行时 workspace 包

状态：已接受（2026-08-17）。AgentHub server 通过 workspace package 的 `dist` exports 加载
`agent-core`、`adapter-acp`、`adapter-openclaw`、`db` 和 `shared`。NAS native 基础镜像 overlay
不得只覆盖 `apps/server/dist`/`apps/web/dist`，否则会把旧 ACP 实现带入新 server。发布 overlay
必须同步这些 dist；Host ACP 以 `1000:10` 运行时，仅对 pinned ACP/Codex 依赖闭包和 workspace
代码目录开放读取，不触碰 secret、数据卷或用户文件。

## D-027：ACP prompt rejection 统一进入可恢复断线

状态：已接受（2026-08-17）。ACP stdio wrapper 可能在 app-server 子进程退出后继续存活，且 SDK
可能以 plain JSON-RPC object 返回 `stream disconnected`、`connection refused` 或其他 prompt
请求拒绝。此类拒绝不再把 Session 留在 READY 并将 Run 标为普通失败；adapter 发布
`adapter.disconnected`，Server 将 Run 标为 `DISCONNECTED/ADAPTER_DISCONNECTED`，用户可执行
resume。正常 Agent refusal 仍通过成功的 ACP PromptResponse/`run.failed` 语义处理。

## D-028：Codex 权限模式与计划模式分层呈现

状态：已接受（2026-08-17）。Codex ACP 的 `read-only`、`agent`、`agent-full-access` 是权限与沙箱预设，
`collaboration_mode` 的 `default`、`plan` 是后续回合的工作流程模式；两类能力均来自真实 `session/new`
配置，不硬编码供应商选项。核心仍使用供应商无关的 `mode` patch，适配器负责按真实 config ID 调用
`session/set_mode` 或 `session/set_config_option`。Web 对已知值显示中文标签与说明，未知 provider 值保留原文。

## D-029：Composer 斜杠命令使用 ACP available commands

状态：已接受（2026-08-17）。Composer 输入 `/` 时显示本地配置命令和 ACP `available_commands_update` 提供的
Agent 原生命令；本地 `/model`、`/mode`、`/effort`、`/plan`、`/help` 只在明确能力存在时执行，其他命令原样发送
给 Agent。命令元数据只保留名称、说明和 hint，不持久化或展示 ACP 原始 `_meta`。

## D-030：上游 DNS 失败时 Heimdall 使用显式出网代理兜底

状态：已接受（2026-08-18）。NAS 的 UGOS DNS 配置虽包含 `223.6.6.6` 和 `114.114.114.114`，但在
`DH4300Plus` 上对普通域名和 `api.deepseek.com` 的 UDP/TCP 查询均返回 `SERVFAIL`，通过代理访问
DNS-over-HTTPS 和 DeepSeek 正常。AgentHub 不修改 NAS 全局 DNS；Heimdall proxy 仅通过可配置的
`HEIMDALL_EGRESS_PROXY` 访问上游，Compose 内部地址继续由 `NO_PROXY` 直连。这样 DNS 修复后可以将
环境变量置空回归直连，当前不伪称直连已恢复。

## D-031：ACP Prompt 必须有界并在超时后收敛

状态：已接受（2026-08-18）。Gateway-backed ACP 可能发布上游错误但不响应 `session/prompt` JSON-RPC，
因此 adapter 必须设置有界计时器；收到 Session update 时刷新，超时发布稳定的 `ACP_PROMPT_TIMEOUT`、发送
最佳努力 cancel 并关闭 Session。OpenClaw 默认 30 秒，其他本地 ACP 默认 120 秒；不改变正常 Agent 的
streaming、approval 或 cancellation 语义，也不把挂起 Run 伪标记为成功。

## D-032：OpenClaw ACP 异常时显式使用单回合 exec 回退

状态：已接受（2026-08-18）。OpenClaw `2026.5.7` 的 Gateway-backed ACP assistant 事件未稳定回传
终态 `chat` 事件，无法满足 AgentHub 的 streaming Prompt 契约。对该已验证版本，AgentHub 通过部署级
`AGENTHUB_OPENCLAW_TRANSPORT=exec` 选择 `openclaw agent --agent main --message ... --json` 单回合命令，
解析 `result.payloads[].text` 并将能力 truthful 地限制为 text prompt/create/close；不显示 streaming、Approval、
Plan 或 model/mode 控件。Adapter 每次实例化都读取该偏好，避免预检和 Session 创建之间 transport 选择丢失。

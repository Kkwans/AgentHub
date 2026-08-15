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
Compose 上由 TX5Pro 完成登录 → 准备 Target/Project/Agent → Session/Run → Approval → Git →
Task Review 的可操作旅程。普通用户不得输入 token、Session ID、Task UUID 或执行 NAS 命令；
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

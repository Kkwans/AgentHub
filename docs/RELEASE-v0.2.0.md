# AgentHub v0.2.0 发布说明

发布日期：2026-08-10

## 结果

v0.2.0 在 v0.1 控制平面上增加两条完整能力：本机 Worktree Task Runner，以及通过 outbound secure WebSocket 管理 Remote Node。Remote Node 的 Project、只读文件、Agent preflight、Session/Run/Approval/cancel/close 已接入现有核心领域和中文 UI；provider credential 始终留在执行节点。

公开仓库：<https://github.com/Kkwans/AgentHub>

## 主要变化

- Worktree：持久 FIFO、每 Project 单并发、managed worktree、Review/Rework/Cancel、冲突预检和用户显式 `--no-ff` merge gate。
- Remote Node：一次性 registration token、Ed25519 设备身份、challenge/signature、revoke、heartbeat、断线状态与指数退避 reconnect。
- Remote 执行：授权 repository roots、Agent inventory、Project preflight、只读文件、真实 ACP Session stream、Approval、cancel 与 close。
- 中文 UI：注册码一次性警告、连接命令、在线/离线/revoked、fingerprint、roots、inventory、诊断与响应式 Workspace。
- 数据库：新增 `0001_tidy_kinsey_walden.sql` 与 `0002_certain_squadron_supreme.sql`，保持向前追加。

## 验证证据

- 最终标准 Vitest：33 个文件通过、3 个 live 文件按 gate 跳过，112 项通过、7 项跳过；Web 单元 8 项通过。
- Playwright：Remote Node 中文 UI 在 1440、1024、768、390 共 16 项通过。
- Worktree live：临时 Git repository + PGlite + pinned Codex 完成真实修改、Review Diff、受管 commit 与双亲 merge commit。
- Remote Node live：临时 Central Server + PGlite + Node identity + pinned Codex 完成注册、Project、preflight、Session stream 与 close，Assistant 返回 `REMOTE_OK`。
- 最终选定 live：Remote Node 与 Worktree 2 项通过，耗时 100.08 秒。为保持现有 Agent Docker 状态，本轮未重跑会启动/停止容器的 `agent-preflight.test.ts`；v0.1 已归档该容器 live 结果，本次未修改 Docker/Agent Profile 代码。
- TX5Pro：Google Chrome `150.0.7871.182`，26 项真实浏览器检查通过；四视口无根页面横向溢出，0 request failure、0 console/page error、0 HTTP 4xx/5xx、0 外部请求。报告和截图见 [`qa/tx5pro/2026-08-10-remote-node/`](qa/tx5pro/2026-08-10-remote-node/README.md)。
- TX5Pro 与 Remote Node live 的临时 Server、daemon、数据库和隧道均已回收；未修改或启停现有 Agent Docker/Compose、镜像或 volume。

`pnpm format:check`、`pnpm lint`、`pnpm typecheck` 与 `pnpm build` 全部通过。最终计数同时记录于 [`implementation/PROGRESS.md`](implementation/PROGRESS.md)。

## 安全与部署

- Central Server 默认仍为 `127.0.0.1 + local_trusted`；非 loopback 必须使用 token auth 和 TLS reverse proxy。
- Remote Node 只主动连接 `/node/ws`；非 loopback 必须使用 `wss://`，明文 `ws://` 仅允许 loopback。
- registration token 明文只显示一次，中央只存 hash；private key 只在 Node 数据目录以 `0600` 保存。
- roots 必须在中央和 Node 两端匹配，所有路径在执行端重新做 containment 与 symlink escape 检查。
- 升级前备份 PGlite/PostgreSQL，依次应用 migration `0001`、`0002`；完整步骤见 [`DEPLOYMENT.md`](DEPLOYMENT.md)。

## 明确不包含

- Remote Git、Remote Worktree merge、远程 Terminal、远程 Docker 管理；
- SSH target、任意 command/shell API、provider credential 复制；
- 离线命令重放、透明 Session resume、多中央服务器与 Node 高可用；
- 自动 worktree/branch 删除、reset、rebase、force push。

这些操作会返回明确的 unsupported/offline 状态，不以本机能力或 mock 结果代替。

## 已知环境限制

- Claude Code 容器缺少固定 `claude-agent-acp@0.66.0`，当前为 `BROKEN`。
- Hermes 容器缺少覆盖 `/volume2/Project` 的 workspace mount，相关 Project 为 `WORKSPACE_UNMAPPED`。
- OpenClaw Gateway 仍需原生批准 scope upgrade；AgentHub 未替用户批准。
- OpenCode 未安装时为 `MISSING`。
- NAS 当前没有 `node-pty` ARM64 native binding，Terminal capability=false，不使用普通 shell 模拟。

## 回滚

1. 优雅停止 Central Server 与本版本部署的 Node daemon；不要停止或删除 Agent 容器。
2. 记录 Remote Node、Worktree Execution、branch/worktree path 和 commit SHA，保留现场。
3. 切回已验证的 v0.1.0 commit 并重新安装锁定依赖；若旧代码与已执行 migration 不兼容，恢复升级前数据库备份，不手工删 migration 记录或 v0.2 表。
4. 停止 Node daemon只会使设备离线，不删除远程 Project、Agent auth 或 identity；设备退役时在中央 revoke，身份目录由设备管理员处理。
5. AgentHub 不自动删除 managed worktree、task branch、Remote Node identity、容器、镜像或 volume。

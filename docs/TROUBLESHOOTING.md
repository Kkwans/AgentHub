# 故障排查

## 服务无法启动

- `INVALID_SERVER_PORT`：检查 `AGENTHUB_PORT` 是否为 `0..65535` 的整数。
- `AUTH_MODE_REQUIRED` / `INSECURE_NON_LOOPBACK_BIND`：非 loopback 必须设置 `AGENTHUB_AUTH_MODE=token`。
- `AUTH_SETUP_REQUIRED`：当前还没有管理员账号，请直接在首次使用页面创建账号。
- PGlite 失败：检查 `AGENTHUB_DATA_DIR` 的父目录权限和剩余空间；不要删除现有数据库目录。
- PostgreSQL 失败：检查 `DATABASE_URL`、网络、证书与 migration 权限。
- Compose 报端口占用：确认 `agenthub.service` 已停止，且只有一个 AgentHub 进程打开 PGlite；
  不要让 systemd 与 Compose 同时监听 `3210` 或访问同一 data 目录。
- Compose health 为 `unhealthy`：先看 `docker compose logs --tail=100 agenthub`，再核验 data、
  worktree、TMPDIR、Codex HOME、Docker socket 和 `/usr/bin/docker` bind mount；不要删除数据。
- 绿联项目列表没有 AgentHub：确认从 `/volume2/DockerProject/agenthub/docker-compose.yml` 以
  project name `agenthub` 启动，并用 `docker compose ls --all` 核验 Compose labels。

## Web 页面不可用

- `/api/v1/health` 的 `web=false`：先执行 `pnpm build`，或用 `AGENTHUB_WEB_DIST` 指向包含 `index.html` 的绝对/可解析目录。
- API 正常但前端路由 404：确认请求由 AgentHub Server 处理，而不是直接用没有代理配置的静态服务器。
- 页面持续显示登录：确认用户名和密码正确、浏览器允许当前站点 Cookie，并检查系统时间；
  不需要从 NAS 读取 token。连续输错 5 次会冷却 15 分钟。
- 登录后 API 返回 401 或 `/ws` 断开：刷新页面并重新登录；若仍复现，检查响应是否设置
  `agenthub_session` HttpOnly Cookie，以及反向代理是否透传 Cookie 与 WebSocket upgrade。
- LAN 拒绝连接：核验 Compose container health、`192.168.5.110:3210` published port 与 NAS
  实际地址；旧 systemd 仅监听 `127.0.0.1`，不能直接作为 LAN 部署。
- HTTP HTML 能打开但 JS/CSS 请求被升级到 `https://...:3210`：确认运行版本已移除 CSP 的
  `upgrade-insecure-requests`，且 HTTP LAN 使用 `AGENTHUB_SECURE_TRANSPORT=false`。
- `/ws` 断开：确认反向代理允许 WebSocket upgrade，并透传同源 Cookie；API token 客户端的
  兼容 subprotocol 仅用于外部集成，不是浏览器登录步骤。

## Agent preflight

- `MISSING`：目标运行环境没有固定命令；AgentHub 不会临时安装 `latest`。
- `BROKEN`：命令存在但 adapter/协议启动失败。当前 Claude Code 容器需要固定安装 `claude-agent-acp@0.66.0`。
- `AUTH_REQUIRED`：在 Agent 原生运行时完成授权。AgentHub 不读取或复制凭据。
- `WORKSPACE_UNMAPPED`：Docker mount 未覆盖 Project root。修改部署前先评估 Compose/volume 影响并取得单独授权。
- `CONTAINER_REPLACED`：同名容器 ID 已变化；重新人工核验并显式注册完整 ID。

## Run、Approval 与 Task

- `SESSION_NOT_READY`：等待当前 Run 结束或恢复断开的 Session。
- `APPROVAL_OPTION_INVALID`：只能提交 Agent 原始返回的合法 option ID。
- Approval 重复提交返回同一已决结果，不会再次发送给 Agent。
- Run 完成而 Task 未完成是正常门禁：Task 会进入“待审阅”，必须由用户确认。
- Run 失败/取消会把关联 Task 标为“受阻”，修复原因后再设为“就绪”。

## Project、Git 与 Terminal

- `PATH_TRAVERSAL` / symlink escape：目标路径超出 Project root，服务按安全边界拒绝。
- Git selected-files commit 不会自动包含其他文件；检查所选路径和 staged 状态。
- `PTY_NATIVE_BINDING_UNAVAILABLE`：当前平台没有可用 `node-pty` native binding。AgentHub 不使用普通 shell 模拟 PTY。

## Worktree Task Runner

- `WORKTREE_QUEUE_CONFLICT`：Task 已存在活跃隔离执行，或队列状态被并发请求改变；刷新 Task
  和 Worktree Execution 后重试，不要直接操作数据库。
- `WORKTREE_EXECUTION_CONCURRENT_UPDATE`：另一个请求已移动 Execution 状态；以 Server 最新
  状态为准。
- `WORKTREE_IDENTITY_MISMATCH` / 路径 containment 错误：磁盘 worktree、task branch 或
  common dir 与登记信息不一致。保留现场，使用 `git worktree list --porcelain` 只读核验。
- `PRIMARY_WORKTREE_DIRTY` / `PRIMARY_BRANCH_MISMATCH`：主工作区有未提交变更或不在记录的
  base branch；处理用户自己的变更后再批准，不要让 AgentHub reset。
- base ancestry 失效或 merge conflict：Execution 会回到 `REVIEW` 并保留 worktree；先人工
  决定 rework/取消/更新策略，AgentHub 不自动 rebase 或解冲突。
- Server 重启时 `QUEUED` 会恢复调度；原本正在设置、运行、等待批准、审阅或合并的项会标为
  `BLOCKED` 并保留路径，避免盲目续跑。

## Remote Node

- daemon 启动时报“生产连接必须使用 `wss://`”：非 loopback 不能使用明文 `ws://`；为 Central Server 配置受信 TLS 与 WebSocket reverse proxy。loopback 开发连接可继续用 `ws://127.0.0.1`。
- `REMOTE_NODE_REGISTRATION_TOKEN_EXPIRED` / `REMOTE_NODE_REGISTRATION_TOKEN_USED`：注册码已过期或已消费，不能复用；在中央重新创建一次性注册码。不要删除已有设备身份尝试绕过校验。
- `REMOTE_NODE_SIGNATURE_INVALID` / `REMOTE_NODE_PUBLIC_KEY_INVALID`：本地 identity 与中央登记不一致或文件损坏。先核对页面 fingerprint 与 Node 数据目录归属；不要复制其他设备的 private key。确需重新注册时先 revoke 旧设备。
- `REMOTE_NODE_ROOTS_MISMATCH`：中央注册码 roots 与 Node 上报的 absolute realpath roots 没有交集；同时核对 `allowedRoots` 与 `AGENTHUB_NODE_ROOTS_JSON`，不要扩大到 `/`、HOME 或不必要的父目录。
- `REMOTE_NODE_ROOT_TOO_BROAD` / `REMOTE_ROOT_NOT_ALLOWED` / `REMOTE_SYMLINK_ESCAPE`：路径超出授权 root、root 过宽或 symlink 逃逸。修正最小授权 root/Project path，不关闭 containment。
- `REMOTE_NODE_OFFLINE` / `REMOTE_NODE_DISCONNECTED`：检查 daemon 进程、DNS/TLS、反向代理 `/node/ws` upgrade 和中央诊断中的 `lastSeenAt`。未决 RPC 会失败，不会自动重放 prompt。
- `REMOTE_NODE_RPC_TIMEOUT`：Node 在 deadline 内未返回固定命令结果；检查 Node 日志、Agent 进程与目标文件系统，但不要改成通用 shell 进行旁路执行。
- Agent 显示 `REMOTE_AGENT_MISSING` 或 `BROKEN`：以 Node inventory 与远程 preflight 为准，在 Node 本机安装/修复固定版本运行时并重新连接；中央不会复制 credential 或执行 `npx latest`。
- Remote Project 的 Git/Worktree/Terminal 操作显示 unsupported 是 v0.2 设计边界，不是连接故障。

## Docker 安全诊断

- 只核验显式注册的 container name 与完整 ID。
- 活动 Session 会阻止停止容器；先取消 Run 并关闭 Session。
- 不使用 `docker compose down`，不删除容器、镜像或 volume 作为排障步骤。

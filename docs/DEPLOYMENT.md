# 部署与升级

AgentHub v0.6 由 Central Server 与可选的 host-native Remote Node daemon 组成。当前绿联 NAS
的 Central Server 已由用户明确要求改为 root/privileged Docker Compose；既有 Agent 容器仍
只允许显式接管，不修改它们的 Compose、镜像或 volume。

## 运行要求

- Linux ARM64/x64
- Node.js 24
- pnpm 11.11.0（通过 Corepack）
- 可选 PostgreSQL；未配置时使用 PGlite
- 可选 Docker CLI/socket；仅在接管 Docker Agent 时需要

## 当前绿联 NAS Compose

仓库配置位于 `deploy/compose/`，NAS 项目配置安装到
`/volume2/DockerProject/agenthub/docker-compose.yml`。当前入口为
`http://192.168.5.110:3210`，当前镜像为 `agenthub:0.6.0-nas.32`，强制认证。首次打开页面创建唯一管理员账号，之后使用用户名和
密码登录；浏览器凭据由 Server 通过 HttpOnly Cookie 管理。Compose 显式配置：

- ARM64 Node.js 24 固定 digest 与版本化镜像 tag；
- `user: 0:0`、`privileged: true`、`restart: unless-stopped` 和 healthcheck；
- `/volume2/Project`、PGlite、worktree、专用 TMPDIR、`/home/Kkwans/.codex` 和只读
  `/home/Kkwans/.gitconfig`；
- `/var/run/docker.sock` 与匹配 host Engine 的 `/usr/bin/docker`；
- 只向 NAS 地址 `192.168.5.110` 发布 `3210`，不使用 host network。
- `AGENTHUB_RUN_CANCEL_TIMEOUT_MS` 控制取消收敛等待时间（1000-120000 毫秒，默认 10000）。
- `AGENTHUB_APPROVAL_DELIVERY_TIMEOUT_MS` 控制等待 Agent 确认收到 Approval 决定的时间
  （1000-120000 毫秒，默认 10000）。超时后状态记为 `UNKNOWN`，系统不会盲目重发。
  HTTP 取消请求不会等待 Agent；若 Agent 没有返回终态事件，超时任务会原子地收敛为
  `CANCELED`，记录 `CANCEL_CONFIRMATION_TIMEOUT`，关闭当前激活并将 Session 标记为
  `DISCONNECTED`。取消与完成/失败/断开事件竞争时，以数据库原子状态转换的先写入者为准。

完整构建、切换和回滚步骤见 [`deploy/compose/README.md`](../deploy/compose/README.md)。上述挂载
与 privileged 等同 NAS root 权限，不是安全隔离；跨不可信网络必须增加 TLS 反向代理。
root 进程使用 `SUDO_UID=1000` 识别 Kkwans-owned Project，避免放宽到 `safe.directory=*`。
HTTP LAN 保持 `AGENTHUB_SECURE_TRANSPORT=false`；TLS 反向代理上线后设为 `true` 恢复 COOP。

## 安装与构建

```bash
cd /volume2/Project/AgentHub
corepack pnpm install --frozen-lockfile
corepack pnpm build
```

Server production 进程会自动托管 `apps/web/dist`，因此不需要额外运行 Vite。默认地址为 `http://127.0.0.1:3210`。

```bash
cp .env.example .env
set -a
. ./.env
set +a
corepack pnpm --filter @agenthub/server start
```

v0.2 Worktree Task Runner 默认把 managed worktree 放在数据库目录同级的 `worktrees/`。
生产环境建议显式设置一个仅供 AgentHub 使用的绝对目录：

```bash
AGENTHUB_WORKTREE_ROOT=/volume2/Project/.agenthub/worktrees
```

该目录必须与业务 Project 分离并允许 AgentHub 用户创建目录。AgentHub 不自动清理已完成、
受阻或取消的 worktree；清理前必须逐项核验数据库状态、Git worktree identity 和分支保留需求。

## Remote Node daemon

Remote Node 无需开放入站管理端口。先在中央“设置 → Remote Node”创建一次性注册码，再在目标主机使用与中央相同的 v0.6.0 代码和锁定依赖：

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @agenthub/node build

AGENTHUB_NODE_SERVER_URL=wss://agenthub.example.com/node/ws \
AGENTHUB_NODE_NAME='开发节点 A' \
AGENTHUB_NODE_ROOTS_JSON='["/srv/projects"]' \
AGENTHUB_NODE_DATA_DIR=/var/lib/agenthub-node \
AGENTHUB_NODE_REGISTRATION_TOKEN='<一次性注册码>' \
corepack pnpm --filter @agenthub/node start
```

- `AGENTHUB_NODE_ROOTS_JSON` 必须包含 1..32 个绝对目录；中央注册码的 roots 与 Node 本地 realpath roots 至少有一个精确匹配。
- 首次成功注册后移除 `AGENTHUB_NODE_REGISTRATION_TOKEN`。Node 使用数据目录中的 `device-private-key.pem` 和 `device.json` 重连；目录权限为 `0700`，身份文件为 `0600`。
- 数据目录是设备身份，不要复制到另一台机器或提交 Git。备份/恢复时将其视为 secret；设备退役时先在中央 revoke。
- 非 loopback 只接受 `wss://`；`ws://` 仅允许 `localhost`、`127.0.0.1` 或 `::1` 开发连接。
- 反向代理必须同时转发 `/ws` 与 `/node/ws` 的 WebSocket upgrade，并对外提供 TLS。Node 只执行协议 allow-list，不提供 SSH 或任意 shell。

`.env` 不提交 Git。以下 systemd 方式是当前 NAS 的保留回滚路径，也是其他 host-native
部署的模板；当前 NAS 正常运行时不得与 Compose 同时启动：

```bash
sudo install -d -m 0700 -o Kkwans -g admin \
  /volume2/Project/.agenthub \
  /volume2/Project/.agenthub/central \
  /volume2/Project/.agenthub/central/data \
  /volume2/Project/.agenthub/central/worktrees \
  /volume2/Project/.agenthub/central/tmp \
  /volume2/Project/.agenthub/central/deployments
sudo install -d -m 0750 -o root -g admin /etc/agenthub
sudo install -m 0640 -o root -g admin \
  deploy/systemd/agenthub.env.example /etc/agenthub/agenthub.env
sudo install -m 0644 -o root -g root \
  deploy/systemd/agenthub.service /etc/systemd/system/agenthub.service
sudo systemctl daemon-reload
sudo systemctl enable --now agenthub.service
```

运行状态与日志：

```bash
systemctl status agenthub.service
journalctl -u agenthub.service -n 100 --no-pager
curl -fsS http://127.0.0.1:3210/api/v1/health
```

其他主机必须先核验实际路径、Node 位置、用户和进程监管器，不能直接照搬 NAS unit。

## 本地可信访问

默认只监听 loopback，并使用 `local_trusted`。远程工作站推荐通过 SSH port forwarding 访问：

```bash
ssh -L 3210:127.0.0.1:3210 Kkwans@NAS_HOST
```

然后访问 `http://127.0.0.1:3210`。该模式不向局域网直接暴露服务。

## 非 loopback 与账号登录

如果确需监听局域网地址，必须配置：

```bash
AGENTHUB_HOST=0.0.0.0
AGENTHUB_AUTH_MODE=token
```

`AGENTHUB_AUTH_MODE=token` 是为兼容既有部署保留的内部模式名；面向浏览器的产品行为是
账号密码登录，不要求用户取得或粘贴 token。未启用认证时服务会在监听端口前拒绝启动。
首次访问页面时创建唯一管理员账号，用户名至少 3 个字符、密码至少 6 个字符且不要求复杂度；之后浏览器使用 7 天有效的
HttpOnly、SameSite=Strict Cookie。远程访问必须在反向代理层启用 TLS。

CLI、自动化脚本或外部服务确需调用 API 时，管理员可以在“设置 → 高级功能 → 外部集成”
创建 API token。它只显示一次，并且不用于网页登录。为旧部署和灾难恢复保留的可选
bootstrap token 仍可通过 secret manager 注入：

```bash
AGENTHUB_BOOTSTRAP_TOKEN=<至少 32 字节高熵随机值>
```

普通部署不需要 bootstrap token 即可完成首次账号设置。已有 Compose secret 暂时保留以兼容
现行回滚路径，不向浏览器或普通设置页面展示。

## 数据库与备份

- PGlite：`AGENTHUB_DATA_DIR` 指向数据库目录。备份前先优雅停止 AgentHub，再复制整个目录。
- PostgreSQL：设置 `DATABASE_URL`，使用现有 PostgreSQL 备份工具和策略。
- migration 只向前追加。升级前必须备份；v0.2 不提供破坏性 down migration。
- Artifact、日志和 Agent 原生配置不应与数据库目录混为同一清理目标。

## 升级

1. 记录当前 commit、环境变量和服务健康状态。
2. 优雅停止 AgentHub，不停止其接管的 Agent 容器。
3. 备份 PGlite 目录或 PostgreSQL。
4. 获取目标版本后执行 `pnpm install --frozen-lockfile`、`pnpm build`；从 v0.1 升级到 v0.2 会
   依次向前应用 `0001_tidy_kinsey_walden.sql` 与 `0002_certain_squadron_supreme.sql`。v0.2 升级
   到最初的 v0.3 不增加 migration；账号登录更新会继续应用 `0003_sweet_owl.sql`，新增
   `local_accounts` 与 `browser_sessions`，不改写现有 Project、Agent 或 Session 数据。v0.5
   继续向前应用 `0004_freezing_speed.sql`，为 Approval outbox 与投递审计增加可查询状态；
   migration 不删除或重写既有 Project、Agent、Session、Run、Task、Prompt 或账号记录。
5. 运行 release gate，再启动 production Server。
6. 检查 `/api/v1/health`、中文 Web Shell、Agent preflight 和现有 Session 历史。

## 回滚

- 代码：停止服务，切回已验证 commit，重新安装锁定依赖并 build。
- 数据库：只有新版本 migration 已执行且旧代码不兼容时，恢复升级前备份；不要手工删除 migration 记录。
- Worktree：代码回退不会删除 managed worktree 或 task branch；人工回退前先记录其路径、
  Execution 状态与 commit SHA，保留现场。
- Remote Node：停止 daemon 不会删除远程 Project 或 Agent auth；中央会将 Node 标为离线。退役设备应先 revoke，再由设备管理员决定是否保留其身份目录。代码回退不删除 `remote_nodes` 或注册码历史。
- Docker：AgentHub 回滚不修改 Compose、镜像或 volume，只确认明确接管容器仍保持升级前启动状态。
- 当前 NAS Compose 回滚：先 `docker compose stop agenthub`，确认 `3210` 已释放，再
  `sudo systemctl enable --now agenthub.service`；必须保留 `/volume2/Project/.agenthub/central`，
  不得把停止服务理解为删除数据库或 worktree 的授权。

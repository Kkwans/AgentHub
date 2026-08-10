# 部署与升级

AgentHub v0.2 由 host-native Central Server 与可选的 host-native Remote Node daemon 组成。Docker 只用于显式接管已有 Agent 容器；不要为部署 AgentHub 修改这些容器的 Compose、镜像或 volume。

## 运行要求

- Linux ARM64/x64
- Node.js 24
- pnpm 11.11.0（通过 Corepack）
- 可选 PostgreSQL；未配置时使用 PGlite
- 可选 Docker CLI/socket；仅在接管 Docker Agent 时需要

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

Remote Node 无需开放入站管理端口。先在中央“设置 → Remote Node”创建一次性注册码，再在目标主机使用与中央相同的 v0.2.0 代码和锁定依赖：

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

`.env` 不提交 Git。生产进程应由 NAS 已有的进程监管器托管；本项目不擅自安装或修改 systemd/开机任务。

## 本地可信访问

默认只监听 loopback，并使用 `local_trusted`。远程工作站推荐通过 SSH port forwarding 访问：

```bash
ssh -L 3210:127.0.0.1:3210 Kkwans@NAS_HOST
```

然后访问 `http://127.0.0.1:3210`。该模式不向局域网直接暴露服务。

## 非 loopback 与 token auth

如果确需监听局域网地址，必须配置：

```bash
AGENTHUB_HOST=0.0.0.0
AGENTHUB_AUTH_MODE=token
AGENTHUB_BOOTSTRAP_TOKEN=<至少 32 字节高熵随机值>
```

未配置 token auth 时服务会在监听端口前拒绝启动。远程访问必须在反向代理层启用 TLS；不要通过 query string 传 token。

首次启动后可使用 bootstrap token 创建数据库 token：

```bash
curl -X POST http://127.0.0.1:3210/api/v1/auth/tokens \
  -H 'Authorization: Bearer <bootstrap-token>' \
  -H 'Content-Type: application/json' \
  --data '{"name":"NAS 控制端"}'
```

响应中的 token 只显示一次。验证新 token 可用并安全保存后，重启时可以移除 `AGENTHUB_BOOTSTRAP_TOKEN`；服务会使用数据库内有效 token。

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
   依次向前应用 `0001_tidy_kinsey_walden.sql` 与 `0002_certain_squadron_supreme.sql`。
5. 运行 release gate，再启动 production Server。
6. 检查 `/api/v1/health`、中文 Web Shell、Agent preflight 和现有 Session 历史。

## 回滚

- 代码：停止服务，切回已验证 commit，重新安装锁定依赖并 build。
- 数据库：只有新版本 migration 已执行且旧代码不兼容时，恢复升级前备份；不要手工删除 migration 记录。
- Worktree：代码回退不会删除 managed worktree 或 task branch；人工回退前先记录其路径、
  Execution 状态与 commit SHA，保留现场。
- Remote Node：停止 daemon 不会删除远程 Project 或 Agent auth；中央会将 Node 标为离线。退役设备应先 revoke，再由设备管理员决定是否保留其身份目录。代码回退不删除 `remote_nodes` 或注册码历史。
- Docker：AgentHub 回滚不修改 Compose、镜像或 volume，只确认明确接管容器仍保持升级前启动状态。

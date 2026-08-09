# 部署与升级

AgentHub v0.1 是 host-native Node.js 应用。Docker 只用于显式接管已有 Agent 容器；不要为部署 AgentHub 修改这些容器的 Compose、镜像或 volume。

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
- migration 只向前追加。升级前必须备份；v0.1 不提供破坏性 down migration。
- Artifact、日志和 Agent 原生配置不应与数据库目录混为同一清理目标。

## 升级

1. 记录当前 commit、环境变量和服务健康状态。
2. 优雅停止 AgentHub，不停止其接管的 Agent 容器。
3. 备份 PGlite 目录或 PostgreSQL。
4. 获取目标版本后执行 `pnpm install --frozen-lockfile`、`pnpm build`。
5. 运行 release gate，再启动 production Server。
6. 检查 `/api/v1/health`、中文 Web Shell、Agent preflight 和现有 Session 历史。

## 回滚

- 代码：停止服务，切回已验证 commit，重新安装锁定依赖并 build。
- 数据库：只有新版本 migration 已执行且旧代码不兼容时，恢复升级前备份；不要手工删除 migration 记录。
- Docker：AgentHub 回滚不修改 Compose、镜像或 volume，只确认明确接管容器仍保持升级前启动状态。

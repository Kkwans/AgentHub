# AgentHub v0.6 NAS Compose 部署

该配置用于当前 ARM64 绿联 NAS，当前正式镜像为 `agenthub:0.6.0-nas.33`。它按用户明确授权以 root/privileged 运行，并拥有 Project
读写、Codex HOME、Git identity 配置、Docker socket 和 host Docker CLI。该能力等同 NAS root，
只能运行可信镜像。

## 构建前门禁

镜像复制当前 workspace 已安装依赖与 production dist，不在构建时访问 npm：

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
docker compose --env-file deploy/compose/.env.example \
  -f deploy/compose/docker-compose.yml build agenthub
```

基础镜像固定为 ARM64 Node 24 Bookworm digest。部署 tag 不使用 `latest`。

## NAS 安装位置

绿联 Docker 项目目录固定为：

```text
/volume2/DockerProject/agenthub/
├── docker-compose.yml
├── .env
└── secrets/browser-token
```

`.env` 不含 AgentHub API token；现有 `0600 root:root` 的 `browser-token` 只作为旧版回滚和
外部 API 兼容 secret 保留，不是浏览器登录凭据。数据库中的密码、浏览器会话和 API token
均只保存 hash。Compose 以固定 project name `agenthub` 启动后，应同时出现在
`docker compose ls` 和绿联 Docker 的“项目”列表。

## v0.6 升级顺序

1. 记录旧 image、Compose、`.env`、data/worktrees、健康、Project/Execution Target 和既有 Agent 容器状态。
2. 只停止 `agenthub` service，备份正式 Compose、`.env`、兼容 token 和 PGlite data/worktrees。
3. 使用固定 tag 构建并执行 `docker compose up -d --no-build agenthub`；不执行 `compose down`。
4. 核验 container health、账号登录、Cookie WebSocket、Project/Git、Docker preflight、重启恢复、
   `192.168.5.110:3210` 和绿联项目列表。

本次 v0.6 发布备份：

```text
/volume2/Project/.agenthub/central/deployments/20260814T045513Z-pre-v06/
/volume2/Project/.agenthub/central/deployments/20260814T054956Z-v06-data-backup/
/volume2/Project/.agenthub/central/deployments/20260814T064756Z-pre-nas2/
```

普通用户不需要执行上述命令；打开 Web 后只使用管理员账号密码登录。

容器以 root 运行，但 `SUDO_UID=1000` 明确告诉 Git 原始 Project owner 是 `Kkwans`，避免
`dubious ownership`；不会配置 `safe.directory=*`。只读挂载 `.gitconfig` 用于保留原 Git
identity，AgentHub 不提供 push，因此不会把 credential helper 当作远端发布能力。

首次浏览器访问会显示“创建管理员账号”，用户只需自行设置至少 3 个字符的用户名和至少 6 个字符的密码，不要求密码复杂度；以后
只使用账号密码登录。不要向普通用户展示 `browser-token`、Session、命令行或 secret 文件路径。

当前 LAN 入口是 HTTP，因此 `.env` 保持 `AGENTHUB_SECURE_TRANSPORT=false`，Server 不发送会被
Chrome 忽略的 COOP，也不会用 CSP 把相对静态资源强制升级到 HTTPS。将来由可信反向代理提供
HTTPS 后可设为 `true` 恢复 COOP；登录密码、Cookie 与 API token 跨不可信网络必须使用 TLS。

## 回滚

```bash
cd /volume2/DockerProject/agenthub
docker compose stop agenthub
sudo cp /volume2/Project/.agenthub/central/deployments/20260814T045513Z-pre-v06/compose/docker-compose.yml ./docker-compose.yml
sudo cp /volume2/Project/.agenthub/central/deployments/20260814T045513Z-pre-v06/compose/.env ./.env
docker compose up -d --no-build agenthub
curl -fsS http://192.168.5.110:3210/api/v1/health
```

旧镜像 `agenthub:0.5.0-nas.1` 保留。只有确认新进程写入导致旧代码不兼容时，才在停止单个
`agenthub` service 后恢复 `central-data-worktrees.tar.gz`；回滚不执行 `compose down`，不删除
容器、镜像、token 文件、Project、worktree、Agent 容器或 volume。

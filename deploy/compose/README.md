# AgentHub NAS Compose 部署

该配置用于当前 ARM64 绿联 NAS。它按用户明确授权以 root/privileged 运行，并拥有 Project
读写、Codex HOME、Docker socket 和 host Docker CLI。该能力等同 NAS root，只能运行可信镜像。

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

`.env` 不含 AgentHub API token；token 明文只保存在 `0600 root:root` 的 `browser-token`。
数据库只保存 hash。Compose 以固定 project name `agenthub` 启动后，应同时出现在
`docker compose ls` 和绿联 Docker 的“项目”列表。

## 切换顺序

1. 在仍为 loopback/local_trusted 的旧服务上运行 `create-deployment-token.mjs`，将明文直接
   写入 root-only 文件，不把 token 打印到日志。
2. 记录旧 systemd、健康、Project/Execution Target 和既有 Agent 容器状态。
3. 优雅停止 systemd，确认 PGlite 没有打开句柄后，冷备份整个 data 目录以及 unit/env。
4. 禁用但保留 systemd，执行 `docker compose up -d --no-build`。
5. 核验 container health、token API、WebSocket、Project/Git、Docker preflight、重启恢复、
   `192.168.5.110:3210` 和绿联项目列表。

首次浏览器访问会进入认证状态。在“设置”中输入 `browser-token` 的内容；浏览器只保存到
当前 `sessionStorage`。不要通过 URL query、聊天或日志传递 token。

## 回滚

```bash
cd /volume2/DockerProject/agenthub
docker compose stop agenthub
sudo systemctl enable --now agenthub.service
curl -fsS http://127.0.0.1:3210/api/v1/health
```

正常回滚继续使用同一 PGlite 数据，不恢复备份。只有确认新进程写入导致旧代码不兼容时才
停止所有 AgentHub 进程并恢复冷备份。回滚不执行 `compose down`，不删除容器、镜像、token
文件、Project、worktree、Agent 容器或 volume。

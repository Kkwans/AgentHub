# AgentHub v0.6 nas.26 发布核验

日期：2026-08-16

## 目标

验证 Workspace Session 运行状态展示和 Composer 输入门禁在正式 ARM64 NAS Compose 上可加载，确认非
`READY` Session 不会继续发送消息，并保留现有 Terminal、Runtime capability 与受保护容器边界。

## 发布边界

- 主机：`DH4300Plus`，`aarch64`
- Compose：`/volume2/DockerProject/agenthub/docker-compose.yml`
- Docker project：`agenthub`
- 服务：仅 `agenthub`
- 端口：`192.168.5.110:3210`
- 新镜像：`agenthub:0.6.0-nas.26`
- 基础镜像：已验证的 `agenthub:0.6.0-nas.25`
- revision：`939d3cc`
- 发布前备份：`/volume2/Project/.agenthub/central/deployments/20260816T100058Z-pre-nas26/`

发布前已备份 Compose、`.env`、browser-token 校验值、agenthub inspect 和受保护容器状态；没有复制
browser-token 内容。发布只执行 `docker compose config --quiet` 与
`docker compose up -d --no-build agenthub`，没有执行 `docker compose down`，没有删除镜像、卷、用户数据
或其他 Agent 容器。

## 结果

- 镜像：`sha256:5b044df0c7a49584ae31b828ec6ca781daf7ae6cf6ec6eb73a03509d4c8df3d0`，`linux/arm64`，revision `939d3cc`
- 容器：`ebf9032ccf010a7b5d4be404dce71db7aa52e52d0745239a4e1e3367d8a00d47`，`running/healthy`
- `/api/v1/health`：HTTP 200，`status=ok`、`version=0.6.0`、`database=pglite`、`web=true`
- 根页面：HTTP 200，`lang="zh-CN"`
- 静态资源：运行容器中的 Web bundle 包含 `run-state-banner` 与 Workspace 状态文案
- 授权 capability：`terminal.available=true`、`code=READY`、`linux/arm64`；Remote Node transport 为 `outbound_websocket`
- 容器内 `node-pty`：在 `/opt/agenthub/apps/server` 加载成功
- Terminal API smoke：现有 AgentHub Project 上 `open=201`、`input=200`、`resize=200`、`close=200`；仅输出命令，未写入项目文件
- 受保护容器：`claude-code`、`hermes`、`openclaw-official`、`openclaw-custom` 的 name、完整 ID、image、状态与发布前基线一致
- 回滚镜像：`agenthub:0.6.0-nas.25` 仍保留
- `.tmp-v05`：不存在

## 自动化证据

- 非沙箱全仓 Vitest：51 个文件通过、4 个 live 文件跳过；`219 passed / 9 skipped`
- `corepack pnpm lint`：通过
- `corepack pnpm typecheck`：通过
- `corepack pnpm build`：通过，Web `1716 modules transformed`
- `corepack pnpm test:e2e`：`24 passed`，覆盖 1440/1024/768/390 fixture、键盘和 axe；不替代人工视觉验收

## 配置校验

- Compose SHA-256：`0e3e92b7078a4a6cfde4fa8c5493539ffac0e238f1aa570ff689606a095f27ff`（与发布前一致）
- 当前 `.env` SHA-256：`c8744e55c51f56a6309c44d30c3865090a363ce3139336feb970d1581fa2028c`
- browser-token SHA-256：`d1e3d6d77a351bd669f975c32b414d8c9cd581e2e8fe87a11a4e0a64290db087`（仅记录校验值）
- `docker compose config --quiet`：通过

## 未验证项

当前没有授权的浏览器/Computer Use/TX5Pro 通道；本记录不声明 1440、1024、768、390 的人工视觉验收，
也不把本地 Playwright fixture、NAS `curl` 或静态 bundle 结果提升为人工可用性结论。

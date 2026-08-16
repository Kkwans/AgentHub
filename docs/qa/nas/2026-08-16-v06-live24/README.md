# AgentHub v0.6 nas.24 发布核验

日期：2026-08-16

## 目标

验证 `refactor(web): 将 Runtime 管理接入设置` 在正式 ARM64 NAS Compose 上的部署结果：
Runtime discovery 是否已进入设置页、Agent 页面是否复用同一面板、服务健康与 Terminal 能力是否保持，
以及现有 Agent 容器是否未发生变更。

## 发布边界

- 主机：`DH4300Plus`，`aarch64`
- Compose：`/volume2/DockerProject/agenthub/docker-compose.yml`
- Docker project：`agenthub`
- 服务：仅 `agenthub`
- 端口：`192.168.5.110:3210`
- 新镜像：`agenthub:0.6.0-nas.24`
- 基础镜像：已验证的 `agenthub:0.6.0-nas.23`
- revision：`971f863`
- 发布前备份：`/volume2/Project/.agenthub/central/deployments/20260816T085653Z-pre-nas24/`

发布前已备份 Compose、`.env`、browser-token 校验值、agenthub inspect 和受保护容器状态；没有复制
browser-token 内容。发布只执行 `docker compose config --quiet` 与
`docker compose up -d --no-build agenthub`，没有执行 `docker compose down`，没有删除镜像、卷、用户数据
或其他 Agent 容器。

## 结果

- 镜像：`sha256:9083ef1895d15c628044d605d5af13eea1b4572c173b0d43a005408fa637c59f`，`linux/arm64`，revision `971f863`
- 容器：`b8b19fe759f3ed3db985b4c2d9784bd5255e8e645c50ce0b6143d4401ffe1675`，`running/healthy`
- `/api/v1/health`：HTTP 200，`status=ok`、`version=0.6.0`、`database=pglite`、`web=true`
- 根页面：HTTP 200
- 静态资源：包含 `RuntimeDiscoveryPanel-*.js` 与 `SettingsPage-*.js`
- 授权 capability：`terminal.available=true`、`code=READY`、`linux/arm64`；Remote Node transport 为 `outbound_websocket`
- 容器内 `node-pty`：在 `/opt/agenthub/apps/server` 加载成功
- Terminal API smoke：现有 AgentHub Project 上 `open=201`、`input=200`、`resize=200`、`close=200`；仅输出命令，未写入项目文件
- 受保护容器：`claude-code`、`hermes`、`openclaw-official`、`openclaw-custom` 的 name、完整 ID、image、状态与发布前基线一致
- 回滚镜像：`agenthub:0.6.0-nas.23` 仍保留
- `.tmp-v05`：不存在

## 配置校验

- Compose SHA-256：`0e3e92b7078a4a6cfde4fa8c5493539ffac0e238f1aa570ff689606a095f27ff`（与发布前一致）
- 当前 `.env` SHA-256：`d6d0405801ac6622fa77e2703a5743b277b2729f276fa0fac4f5fdad404f708e`
- browser-token SHA-256：`d1e3d6d77a351bd669f975c32b414d8c9cd581e2e8fe87a11a4e0a64290db087`（仅记录校验值）
- `docker compose config --quiet`：通过

## 未验证项

当前没有授权的浏览器/Computer Use/TX5Pro 通道；本记录不声明 1440、1024、768、390 的人工视觉验收，
也不把本地 Playwright fixture 结果提升为人工可用性结论。

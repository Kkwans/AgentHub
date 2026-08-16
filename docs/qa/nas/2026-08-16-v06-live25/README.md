# AgentHub v0.6 nas.25 发布核验

日期：2026-08-16

## 目标

验证 Session 创建模型/模式渐进式配置在正式 ARM64 NAS Compose 上的部署结果：有候选时使用下拉选择，
没有候选时只显示 Agent 默认值；同时确认 nas.24 的 Runtime 设置入口、Terminal 能力和受保护容器基线不变。

## 发布边界

- 主机：`DH4300Plus`，`aarch64`
- Compose：`/volume2/DockerProject/agenthub/docker-compose.yml`
- Docker project：`agenthub`
- 服务：仅 `agenthub`
- 端口：`192.168.5.110:3210`
- 新镜像：`agenthub:0.6.0-nas.25`
- 基础镜像：已验证的 `agenthub:0.6.0-nas.24`
- revision：`b3ab86c`
- 发布前备份：`/volume2/Project/.agenthub/central/deployments/20260816T092116Z-pre-nas25/`

发布前已备份 Compose、`.env`、browser-token 校验值、agenthub inspect 和受保护容器状态；没有复制
browser-token 内容。发布只执行 `docker compose config --quiet` 与
`docker compose up -d --no-build agenthub`，没有执行 `docker compose down`，没有删除镜像、卷、用户数据
或其他 Agent 容器。

## 结果

- 镜像：`sha256:2343c1d25aee0060e0d9b7ccd2715b4014a462a9d1748199516fcade8ba388ad`，`linux/arm64`，revision `b3ab86c`
- 容器：`21ef57e7321691e5a2e3f3a0c7890665b82c84ff2c0c7b683b35035e7eca74bb`，`running/healthy`
- `/api/v1/health`：HTTP 200，`status=ok`、`version=0.6.0`、`database=pglite`、`web=true`
- 根页面：HTTP 200
- 静态资源：包含 `SessionsPage-*.js`；bundle 包含“使用 Agent 默认模型”文案
- 授权 capability：`terminal.available=true`、`code=READY`、`linux/arm64`；Remote Node transport 为 `outbound_websocket`
- 容器内 `node-pty`：在 `/opt/agenthub/apps/server` 加载成功
- Terminal API smoke：现有 AgentHub Project 上 `open=201`、`input=200`、`resize=200`、`close=200`；仅输出命令，未写入项目文件
- 受保护容器：`claude-code`、`hermes`、`openclaw-official`、`openclaw-custom` 的 name、完整 ID、image、状态与发布前基线一致
- 回滚镜像：`agenthub:0.6.0-nas.24` 仍保留
- `.tmp-v05`：不存在

## 配置校验

- Compose SHA-256：`0e3e92b7078a4a6cfde4fa8c5493539ffac0e238f1aa570ff689606a095f27ff`（与发布前一致）
- 当前 `.env` SHA-256：`88b705c4eddd7da80fce213bae924543256bd86cf264cb739bf5de34482c715d`
- browser-token SHA-256：`d1e3d6d77a351bd669f975c32b414d8c9cd581e2e8fe87a11a4e0a64290db087`（仅记录校验值）
- `docker compose config --quiet`：通过

## 未验证项

当前没有授权的浏览器/Computer Use/TX5Pro 通道；本记录不声明 1440、1024、768、390 的人工视觉验收，
也不把本地 Playwright fixture 结果提升为人工可用性结论。

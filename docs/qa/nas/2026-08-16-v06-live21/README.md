# AgentHub v0.6 nas.21 发布验收

日期：2026-08-16

## 范围

- 变更提交：`7a11215`（普通页面隐藏 Run/Session/Agent 内部对象 ID，显示会话名称、Agent 名称和运行序号）。
- 目标主机：DH4300Plus，`aarch64`。
- Compose：`/volume2/DockerProject/agenthub/docker-compose.yml`，Docker project `agenthub`。
- 访问地址：`192.168.5.110:3210`。
- 升级前备份：`/volume2/Project/.agenthub/central/deployments/20260816T074428Z-pre-nas21/`。

## 构建与运行

- 首次尝试的常规 `Dockerfile` 镜像 `agenthub:0.6.0-nas.20` 被保留但未作为正式版本：它把宿主机缺少 ARM64
  `pty.node` 的 `node_modules` 复制进镜像，导致 Terminal capability 回退为不可用。
- 已用 `deploy/compose/Dockerfile.nas-overlay` 基于已验证的 `agenthub:0.6.0-nas.19` 重新构建 nas.21，
  仅覆盖 `apps/server/dist` 与 `apps/web/dist`；构建阶段 `require('node-pty').spawn` 检查通过。
- 镜像：`agenthub:0.6.0-nas.21`，Image ID：
  `sha256:64c64d49b0159050f0927218136c60fdbdefe8d44215bca2415b314e92c67b8d`。
- Container ID：`6b4a9815032a3fe1e047c5adbdceafb62025b593e2ba22a524accde3edf9f1c1`；OCI revision `7a11215`；
  容器用户 `0:0`、`privileged=true`、`restart=unless-stopped`；最终状态 `running / healthy`。

## 验证结果

| 检查                     | 结果                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------- |
| `GET /api/v1/health`     | `status=ok`、`version=0.6.0`、`database=pglite`、`web=true`                            |
| 根页面                   | HTTP `200`                                                                             |
| 授权 capability          | `terminal=READY`（linux/arm64）、`remoteNode=outbound_websocket`                       |
| `node-pty` runtime smoke | 容器内 `/opt/agenthub/apps/server` 的 `typeof require('node-pty').spawn` 为 `function` |
| Terminal API smoke       | 现有 AgentHub Project 执行 `open/input/resize/close`，HTTP `201/200/200/200`           |
| 静态 bundle              | 新的会话名称、运行序号文案存在；`PTY_NATIVE_BINDING_UNAVAILABLE` 不存在                |
| Compose                  | `config --quiet` 通过；`.env` 指向 `agenthub:0.6.0-nas.21` / `7a11215`                 |
| `.tmp-v05`               | 不存在                                                                                 |

nas.20 的失败尝试没有修改数据库、Project 文件或其他容器；nas.19、nas.20、nas.21 镜像均保留，便于回滚和诊断。

## 受保护容器不变性

- `claude-code`：`9d8cbc9b82062c31d962c3829a49afe931087edef5691b96f96ba1ec5c339281`，`claude-code:2026.6.8`，`exited`。
- `hermes`：`cdcfb3fe1b1a542160b8e9d74725aa54a8da6a2f31f7cad2448ae9141b6799d0`，`ugreen/hermes-agent:v1`，`exited`。
- `openclaw-official`：`433abd2cfd7687ca393ae5de4f3458959a29746a2a8130bcb39e1e3bb96a571e`，
  `ghcr.io/openclaw/openclaw:2026.6.11`，`exited`。
- `openclaw-custom`：`633495c2f6aa29bc704d558d3ed147667b447cb4451b78aee51679dc84981566`，
  `openclaw-custom:2026.5.7`，`running`。

本轮只执行 AgentHub service 的 `docker compose up -d --no-build`，没有执行 `docker compose down`，没有删除镜像、卷、用户数据或其他 Agent 容器。

## 配置校验和与回滚

nas.21 当前校验和：

```text
.env                fb1a5a4b0f33e1dc6aef84641e28fad2d660e78e9f56aac1253d4966054a77b7
docker-compose.yml  0e3e92b7078a4a6cfde4fa8c5493539ffac0e238f1aa570ff689606a095f27ff
browser-token       d1e3d6d77a351bd669f975c32b414d8c9cd581e2e8fe87a11a4e0a64290db087
```

回滚时恢复备份目录中的 `.env`，确认 Compose 配置后仍只执行同一 service 的
`docker compose up -d --no-build agenthub`；不删除 nas.20/nas.21、卷或用户数据。

## 未验证项

当前执行环境没有授权的 TX5Pro/浏览器/Computer Use 通道。本记录不把 NAS `curl`、静态 bundle 或 Playwright
fixture 等同于 1440、1024、768、390 的人工视觉验收；`VISUAL_GATE_PENDING` 保持不变。

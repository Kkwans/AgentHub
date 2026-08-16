# AgentHub v0.6 nas.22 发布验收

日期：2026-08-16

## 范围

- 变更提交：`ea32533`（匿名 Docker Runtime 不再把截断 container ID 作为普通用户展示名）。
- 目标主机：DH4300Plus，`aarch64`。
- Compose：`/volume2/DockerProject/agenthub/docker-compose.yml`，Docker project `agenthub`。
- 访问地址：`192.168.5.110:3210`。
- 升级前备份：`/volume2/Project/.agenthub/central/deployments/20260816T081436Z-pre-nas22/`。

## 构建与运行

- 基于已验证的 `agenthub:0.6.0-nas.21` 使用 `deploy/compose/Dockerfile.nas-overlay` 构建，
  仅覆盖 `apps/server/dist` 与 `apps/web/dist`；构建阶段和运行时 `require('node-pty').spawn` 检查通过。
- 镜像：`agenthub:0.6.0-nas.22`，Image ID：
  `sha256:2df68a357f33ecc3b8f5b3b20602dd06711e6d5b0916a583a0bbb76f92acf744`。
- Container ID：`b6ac554545ee2bb61eacfbd78a3a022d679a4925cace28c3d63a510443e2da70`；OCI revision `ea32533`；
  容器用户 `0:0`、`privileged=true`、`restart=unless-stopped`；最终状态 `running / healthy`。

## 验证结果

| 检查                     | 结果                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------- |
| `GET /api/v1/health`     | `status=ok`、`version=0.6.0`、`database=pglite`、`web=true`                            |
| 根页面 GET                | HTTP `200`，返回 `lang=zh-CN` 的 AgentHub HTML                                        |
| 授权 capability          | `terminal=READY`（linux/arm64）、`remoteNode=outbound_websocket`                       |
| `node-pty` runtime smoke | 容器内 `/opt/agenthub/apps/server` 的 `typeof require('node-pty').spawn` 为 `function` |
| Terminal API smoke       | 现有 AgentHub Project 执行 `open/input/resize/close`，HTTP `201/200/200/200`           |
| Runtime discovery        | 真实接口返回普通用户 `displayName/state/adoptable`；内部 ID 未作为展示字段输出          |
| Compose                  | `config --quiet` 通过；`.env` 指向 `agenthub:0.6.0-nas.22` / `ea32533`                 |
| `.tmp-v05`               | 不存在                                                                                 |

本轮只执行 AgentHub service 的 `docker compose up -d --no-build`，没有执行 `docker compose down`，没有删除镜像、
卷、用户数据或其他 Agent 容器。旧 nas.21 和 nas.22 均保留，便于回滚和诊断。

## 受保护容器不变性

- `claude-code`：`9d8cbc9b82062c31d962c3829a49afe931087edef5691b96f96ba1ec5c339281`，`claude-code:2026.6.8`，`exited`。
- `hermes`：`cdcfb3fe1b1a542160b8e9d74725aa54a8da6f2a31f7cad2448ae9141b6799d0`，镜像 digest
  `sha256:c622b4cb7d4b232e3c12bd8f3c991dbaeebe5a70b87f941ce8951403e5e0f9d5`，`exited`。
- `openclaw-official`：`433abd2cfd7687ca393ae5de4f3458959a29746a2a8130bcb39e1e3bb96a571e`，
  `ghcr.io/openclaw/openclaw:2026.6.11`，`exited`。
- `openclaw-custom`：`633495c2f6aa29bc704d558d3ed147667b447cb4451b78aee51679dc84981566`，
  `openclaw-custom:2026.5.7`，`running`。

## 配置校验和与回滚

```text
.env                fad77e6292785494177dd0b361bb69ae64e07142a4e9f375521c5008f8db27f7
docker-compose.yml  0e3e92b7078a4a6cfde4fa8c5493539ffac0e238f1aa570ff689606a095f27ff
browser-token       d1e3d6d77a351bd669f975c32b414d8c9cd581e2e8fe87a11a4e0a64290db087
```

回滚时恢复备份目录中的 `.env`，确认 Compose 配置后仍只执行同一 service 的
`docker compose up -d --no-build agenthub`；不删除 nas.21/nas.22、卷或用户数据。

## 未验证项

当前执行环境没有授权的 TX5Pro/浏览器/Computer Use 通道。本记录不把 NAS `curl`、静态 bundle 或 Playwright
fixture 等同于 1440、1024、768、390 的人工视觉验收；`VISUAL_GATE_PENDING` 保持不变。

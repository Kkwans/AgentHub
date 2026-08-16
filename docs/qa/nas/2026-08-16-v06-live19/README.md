# AgentHub v0.6 nas.19 发布验收

日期：2026-08-16

## 范围

- 变更提交：`a38901b`（隐藏 Terminal 内部能力码并统一 Radix 文本控件焦点样式）。
- 目标主机：DH4300Plus，`aarch64`。
- Compose：`/volume2/DockerProject/agenthub/docker-compose.yml`，Docker project `agenthub`。
- 访问地址：`192.168.5.110:3210`。
- 升级前备份：`/volume2/Project/.agenthub/central/deployments/20260816T070856Z-pre-nas19/`。

## 构建与运行

- 镜像：`agenthub:0.6.0-nas.19`，基于已验证 `agenthub:0.6.0-nas.18` 通过
  `deploy/compose/Dockerfile.nas-overlay` 仅覆盖 `apps/server/dist` 与 `apps/web/dist`。
- Image ID：`sha256:4fabe7d5f77c35e44f523e8789d3c295037b81e721450eb2a8155eb49cd89165`。
- Container ID：`1e43233d25834749096220e90fe91292ead5c3f9555ccdd2260e78947964cfcb`。
- OCI revision：`a38901b`；容器用户 `0:0`；`privileged=true`；`restart=unless-stopped`。
- 状态：`running / healthy`。
- `node-pty` native binding：在 `/opt/agenthub/apps/server` 工作目录执行 smoke，返回
  `typeof spawn === "function"`。

升级前只备份 Compose、`.env` 和 `browser-token`，不输出凭据内容。备份摘要：

```text
docker-compose.yml  0e3e92b7078a4a6cfde4fa8c5493539ffac0e238f1aa570ff689606a095f27ff
.env                703f7ab6d8c85c8f82cb33a34351a422e19b9873838d7c0c9c64f22987c4c190
browser-token       d1e3d6d77a351bd669f975c32b414d8c9cd581e2e8fe87a11a4e0a64290db087
```

## 验证结果

| 检查                 | 结果                                                                               |
| -------------------- | ---------------------------------------------------------------------------------- |
| `GET /api/v1/health` | `status=ok`、`version=0.6.0`、`database=pglite`、`web=true`                        |
| 根页面               | HTTP `200`                                                                         |
| 授权 capability      | `terminal=READY`（linux/arm64）、`remoteNode=outbound_websocket`                   |
| 静态 bundle          | 完整旧 Remote Node 文案不存在；新文案存在；`PTY_NATIVE_BINDING_UNAVAILABLE` 不存在 |
| Compose              | `config --quiet` 通过；`.env` 指向 `agenthub:0.6.0-nas.19` / `a38901b`             |
| `.tmp-v05`           | 不存在                                                                             |

本次只执行 `docker compose up -d --no-build agenthub`，没有执行 `docker compose down`，没有删除
镜像、卷、用户数据或其他 Agent 容器。受保护容器的完整 ID、image 和运行状态保持不变：

- `claude-code`：`9d8cbc9b82062c31d962c3829a49afe931087edef5691b96f96ba1ec5c339281`，`exited`。
- `hermes`：`cdcfb3fe1b1a542160b8e9d74725aa54a8da6a2f31f7cad2448ae9141b6799d0`，`exited`。
- `openclaw-official`：`433abd2cfd7687ca393ae5de4f3458959a29746a2a8130bcb39e1e3bb96a571e`，`exited`。
- `openclaw-custom`：`633495c2f6aa29bc704d558d3ed147667b447cb4451b78aee51679dc84981566`，`running`。

## 回滚

保留 `agenthub:0.6.0-nas.18` 和备份目录。回滚时恢复备份 `.env`，确认 Compose 配置后仅执行
`docker compose -p agenthub -f /volume2/DockerProject/agenthub/docker-compose.yml up -d --no-build agenthub`；
不删除 nas.19、卷或用户数据。

## 未验证项

当前执行环境没有授权的 TX5Pro/浏览器/Computer Use 通道。本记录不把 NAS `curl`、静态 bundle 或
Playwright fixture 等同于 1440、1024、768、390 的人工视觉验收；`VISUAL_GATE_PENDING` 保持不变。

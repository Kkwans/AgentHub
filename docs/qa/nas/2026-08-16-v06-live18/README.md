# AgentHub v0.6 nas.18 发布验收

日期：2026-08-16

## 范围

- 变更提交：`e98c65b`（收口 Remote Node 与后端 AppError 的中文错误提示）。
- 目标主机：DH4300Plus，`aarch64`。
- Compose：`/volume2/DockerProject/agenthub/docker-compose.yml`，Docker project `agenthub`。
- 访问地址：`192.168.5.110:3210`。
- 升级前备份：`/volume2/Project/.agenthub/central/deployments/20260816T064912Z-pre-nas18/`。

## 构建与运行

- 镜像：`agenthub:0.6.0-nas.18`，基于已验证 `agenthub:0.6.0-nas.17` 通过
  `deploy/compose/Dockerfile.nas-overlay` 仅覆盖 `apps/server/dist` 与 `apps/web/dist`。
- Image ID：`sha256:f343a3054c39a266d84e6b2d03cf8cdb6136038ad986ae6ce74cb800d11567e4`。
- Container ID：`817bf63e4afeec8f1241cc1d58e3f20212ed499900a1c959d0f9327cf64dff95`。
- OCI revision：`e98c65b`；容器用户 `0:0`；`privileged=true`；`restart=unless-stopped`。
- 状态：`running / healthy`。
- `node-pty` native binding：在 `/opt/agenthub/apps/server` 工作目录执行 smoke，返回
  `typeof spawn === "function"`。

升级前只备份 Compose、`.env` 和 `browser-token`，不输出凭据内容。备份摘要：

```text
docker-compose.yml  0e3e92b7078a4a6cfde4fa8c5493539ffac0e238f1aa570ff689606a095f27ff
.env                4e3f1f608e54d3428ab6d9a64c02a0f9dfe66ac16ec6e249de4474fee63a3a8a
browser-token       d1e3d6d77a351bd669f975c32b414d8c9cd581e2e8fe87a11a4e0a64290db087
```

## 验证结果

| 检查                 | 结果                                                                   |
| -------------------- | ---------------------------------------------------------------------- |
| `GET /api/v1/health` | `status=ok`、`version=0.6.0`、`database=pglite`、`web=true`            |
| 根页面               | HTTP `200`                                                             |
| 授权 capability      | `terminal=READY`（linux/arm64）、`remoteNode=outbound_websocket`       |
| 静态 bundle 文案     | 完整旧文案不存在；本次完整新文案存在                                   |
| Compose              | `config --quiet` 通过；`.env` 指向 `agenthub:0.6.0-nas.18` / `e98c65b` |
| `.tmp-v05`           | 不存在                                                                 |

本次只执行 `docker compose up -d --no-build agenthub`，没有执行 `docker compose down`，没有删除
镜像、卷、用户数据或其他 Agent 容器。受保护容器的完整 ID、image 和运行状态保持不变：

- `claude-code`：`9d8cbc9b82062c31d962c3829a49afe931087edef5691b96f96ba1ec5c339281`，`exited`。
- `hermes`：`cdcfb3fe1b1a542160b8e9d74725aa54a8da6a2f31f7cad2448ae9141b6799d0`，`exited`。
- `openclaw-official`：`433abd2cfd7687ca393ae5de4f3458959a29746a2a8130bcb39e1e3bb96a571e`，`exited`。
- `openclaw-custom`：`633495c2f6aa29bc704d558d3ed147667b447cb4451b78aee51679dc84981566`，`running`。

## 回滚

保留 `agenthub:0.6.0-nas.17` 和备份目录。回滚时恢复备份 `.env`，确认 Compose 配置后仅执行
`docker compose -p agenthub -f /volume2/DockerProject/agenthub/docker-compose.yml up -d --no-build agenthub`；
不删除 nas.18、卷或用户数据。

## 未验证项

当前执行环境没有授权的 TX5Pro/浏览器/Computer Use 通道。本记录不把 NAS `curl`、静态 bundle 或
Playwright fixture 等同于 1440、1024、768、390 的人工视觉验收；`VISUAL_GATE_PENDING` 保持不变。

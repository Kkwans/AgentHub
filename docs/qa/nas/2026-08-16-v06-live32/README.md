# AgentHub v0.6 Remote Node Git 提示 nas.32 发布记录

日期：2026-08-16

## 范围

- `de4ecd7`：修复 Web 稳定错误映射中遗留的“暂不提供 Git 控制”旧版本文案，并补充版本无关的能力边界回归。
- 基于已验证的 `agenthub:0.6.0-nas.31` 构建 `agenthub:0.6.0-nas.32` overlay；不重建基础依赖，不改变 Compose 权限和挂载。

## NAS 结果

| 检查项                  | 结果                                                     |
| ----------------------- | -------------------------------------------------------- |
| 主机 / 架构             | `DH4300Plus` / `aarch64`                                 |
| Compose 项目 / 服务     | `agenthub` / `agenthub`                                  |
| 访问地址                | `http://192.168.5.110:3210/`                             |
| 镜像 / revision         | `agenthub:0.6.0-nas.32` / `de4ecd7`                      |
| 容器状态                | `running/healthy`                                        |
| 健康接口                | HTTP 200，`version=0.6.0`、`database=pglite`、`web=true` |
| 根页面                  | HTTP 200                                                 |
| 旧 Git 能力文案残留     | `0`                                                      |
| 当前中文能力边界文案    | 存在“当前 Remote Node 不支持 Git 控制”                   |
| Terminal native binding | `node-pty=READY`（在 `/opt/agenthub/apps/server` 核验）  |

## 变更边界与回滚

- 升级前备份：`/volume2/Project/.agenthub/central/deployments/20260816T112000Z-pre-nas32/`。
- 仅更新 `agenthub` service；没有执行 `docker compose down`，没有删除镜像、卷、用户数据，也没有触碰其他 Agent 容器。
- nas.31 镜像保留作为回滚点。

## 未验证项

- 当前环境没有授权浏览器/Computer Use 通道，TX5Pro 人工视觉验收仍为 `VISUAL_GATE_PENDING`。
- 全仓 Vitest、Playwright E2E、`test:live` 最终门禁按收尾阶段执行；本次已完成 typecheck、lint、build、聚焦 feature boundary 回归和 NAS smoke。

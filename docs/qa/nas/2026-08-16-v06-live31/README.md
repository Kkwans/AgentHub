# AgentHub v0.6 Remote Node 文案与 nas.31 发布记录

日期：2026-08-16

## 范围

- `7951c62`：收口 Remote Node Worktree/Git 能力边界，移除面向用户的 v0.2/“下一阶段启用”过期提示。
- `9a39480`：修复 NAS overlay 发布时目录合并造成的旧 `server/web dist` 残留；每次 overlay 会先清理目标 dist，再复制当前构建产物。

## NAS 结果

| 检查项                  | 结果                                                     |
| ----------------------- | -------------------------------------------------------- |
| 主机 / 架构             | `DH4300Plus` / `aarch64`                                 |
| Compose 项目 / 服务     | `agenthub` / `agenthub`                                  |
| 访问地址                | `http://192.168.5.110:3210/`                             |
| 镜像 / revision         | `agenthub:0.6.0-nas.31` / `9a39480`                      |
| 容器状态                | `running/healthy`                                        |
| 健康接口                | HTTP 200，`version=0.6.0`、`database=pglite`、`web=true` |
| 根页面                  | HTTP 200                                                 |
| 旧 Remote Node 文案残留 | `0`                                                      |
| 当前中文下一步文案      | 存在“请改用普通 Session”                                 |
| 静态资源目录            | `137` 个资源，overlay 清洁检查通过                       |
| Terminal native binding | `node-pty=READY`                                         |

## 变更边界与回滚

- 升级前备份：`/volume2/Project/.agenthub/central/deployments/20260816T111414Z-pre-nas31/`。
- 仅更新 `agenthub` service；没有执行 `docker compose down`，没有删除镜像、卷、用户数据，也没有触碰 Claude Code、Hermes、OpenClaw 等其他 Agent 容器。
- nas.30 镜像仍保留，可在需要时按单 service 回滚；nas.31 的 overlay Dockerfile 不会删除宿主机数据，只清理新镜像内的 `/opt/agenthub/apps/server/dist` 和 `/opt/agenthub/apps/web/dist`。

## 未验证项

- 当前环境没有授权浏览器/Computer Use 通道，TX5Pro 人工视觉验收仍为 `VISUAL_GATE_PENDING`。
- 全仓 Vitest、Playwright E2E、`test:live` 最终门禁按当前执行策略留到收尾阶段；本次已完成 typecheck、lint、build 和聚焦 Remote Node/feature boundary 回归。

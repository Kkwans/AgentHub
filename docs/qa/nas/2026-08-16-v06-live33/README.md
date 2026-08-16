# AgentHub v0.6 Workspace Composer 无障碍与 nas.33 发布记录

日期：2026-08-16

## 范围

- `b4ec7d0`：为 Workspace Composer 补齐 `aria-label`、稳定 `name` 和 `autocomplete="off"`，避免普通用户和辅助技术无法识别消息输入框。
- 基于已验证的 `agenthub:0.6.0-nas.32` 构建 `agenthub:0.6.0-nas.33` overlay；不改变基础依赖、Compose 权限或挂载。

## NAS 结果

| 检查项                  | 结果                                                     |
| ----------------------- | -------------------------------------------------------- |
| 主机 / 架构             | `DH4300Plus` / `aarch64`                                 |
| Compose 项目 / 服务     | `agenthub` / `agenthub`                                  |
| 访问地址                | `http://192.168.5.110:3210/`                             |
| 镜像 / revision         | `agenthub:0.6.0-nas.33` / `b4ec7d0`                      |
| 容器状态                | `running/healthy`                                        |
| 健康接口                | HTTP 200，`version=0.6.0`、`database=pglite`、`web=true` |
| 根页面                  | HTTP 200                                                 |
| Composer 无障碍文案     | bundle 中存在 `给 Agent 发送工程指令`                    |
| Terminal native binding | `node-pty=READY`（在 `/opt/agenthub/apps/server` 核验）  |

## 变更边界与回滚

- 升级前备份：`/volume2/Project/.agenthub/central/deployments/20260816T115844Z-pre-nas33/`。
- 仅更新 `agenthub` service；没有执行 `docker compose down`，没有删除镜像、卷、用户数据，也没有触碰其他 Agent 容器。
- nas.32 镜像保留作为回滚点。

## 未验证项

- 当前环境没有授权浏览器/Computer Use 通道，TX5Pro 人工视觉验收仍为 `VISUAL_GATE_PENDING`。

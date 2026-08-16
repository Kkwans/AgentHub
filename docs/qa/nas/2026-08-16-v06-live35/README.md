# AgentHub v0.6 对称表面与统一圆角 nas.35 发布记录

日期：2026-08-16

## 范围

- 提交：`cd4c606`。
- Web：移除共享 `warning-surface` 的单边 `inset` 强调条；统一控制层按钮、面板、统计徽标和图标容器的圆角 token 与卡片阴影。
- 回归：新增 feature-boundary 约束，防止恢复单边强调条或清空共享卡片阴影。
- 部署：基于已验证的单层 `agenthub:0.6.0-nas.34` 构建 `agenthub:0.6.0-nas.35` overlay，仅更新 server/web dist。

## NAS 结果

| 检查项              | 结果                                                         |
| ------------------- | ------------------------------------------------------------ |
| 主机 / 架构         | `DH4300Plus` / `aarch64`                                     |
| Compose 项目 / 服务 | `agenthub` / `agenthub`                                      |
| 访问地址            | `http://192.168.5.110:3210/`                                 |
| 镜像 / revision     | `agenthub:0.6.0-nas.35` / `cd4c606`                          |
| 容器状态            | `running/healthy`                                            |
| 健康接口            | HTTP 200，`version=0.6.0`、`database=pglite`、`web=true`     |
| 根页面              | HTTP 200                                                     |
| 样式契约            | 生产 bundle 未发现 `inset 3px 0` 单边强调条                  |
| Terminal native     | 在 `/opt/agenthub/apps/server` 工作目录加载 `node-pty=READY` |
| 镜像层              | 6 层；基于 nas.34 单层基底，未再次触发 daemon `max depth`    |

## 变更边界与回滚

- 升级前备份：`/volume2/Project/.agenthub/central/deployments/20260816T124717Z-pre-nas35/`。
- 先执行 Compose config 校验，再执行 `docker compose up -d --no-build agenthub`；没有执行 `compose down`。
- nas.34 镜像保留作为回滚点；未删除镜像、卷、用户数据或其他 Agent 容器。
- Claude Code、Hermes、OpenClaw 容器仅做只读状态核对，不在本次变更范围内。

## 验证边界

- 聚焦 feature-boundary 9/9、lint、typecheck、build 已通过。
- 当前环境没有授权浏览器/Computer Use/TX5Pro 通道，本记录不声明 1440/1024/768/390 人工视觉验收通过。

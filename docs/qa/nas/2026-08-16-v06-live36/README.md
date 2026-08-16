# AgentHub v0.6 统一输入框焦点样式 nas.36 发布记录

日期：2026-08-16

## 范围

- 提交：`ac20416`。
- Web：删除旧 CSS 中会与 Radix focus 叠加的蓝色 `:has()` fallback；按钮和链接焦点统一使用当前 accent token，避免输入框出现蓝色+橙色双层边框。
- 回归：feature-boundary 继续约束旧蓝色 literal 和旧 Radix fallback 不得恢复。
- 部署：基于已验证的 `agenthub:0.6.0-nas.35` 构建 `agenthub:0.6.0-nas.36` overlay，仅更新 server/web dist。

## NAS 结果

| 检查项              | 结果                                                         |
| ------------------- | ------------------------------------------------------------ |
| 主机 / 架构         | `DH4300Plus` / `aarch64`                                     |
| Compose 项目 / 服务 | `agenthub` / `agenthub`                                      |
| 访问地址            | `http://192.168.5.110:3210/`                                 |
| 镜像 / revision     | `agenthub:0.6.0-nas.36` / `ac20416`                          |
| 容器状态            | `running/healthy`                                            |
| 健康接口            | HTTP 200，`version=0.6.0`、`database=pglite`、`web=true`     |
| 根页面              | HTTP 200                                                     |
| 样式契约            | 生产 bundle 未发现 `inset 3px 0` 或 `#5c8df6` 旧焦点 literal |
| Terminal native     | 在 `/opt/agenthub/apps/server` 工作目录加载 `node-pty=READY` |
| 镜像层              | 11 层；基于 nas.35 overlay，未触发 daemon `max depth`        |

## 变更边界与回滚

- 升级前备份：`/volume2/Project/.agenthub/central/deployments/20260816T125608Z-pre-nas36/`。
- 先执行 Compose config 校验，再执行 `docker compose up -d --no-build agenthub`；没有执行 `compose down`。
- nas.35 镜像保留作为回滚点；未删除镜像、卷、用户数据或其他 Agent 容器。

## 验证边界

- feature-boundary 9/9、lint、typecheck、build 已通过。
- 当前环境没有授权浏览器/Computer Use/TX5Pro 通道，本记录不声明 1440/1024/768/390 人工视觉验收通过。

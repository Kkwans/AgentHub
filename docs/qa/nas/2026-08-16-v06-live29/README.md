# AgentHub v0.6 Remote Node 授权目录与 nas.29 发布记录

日期：2026-08-16

## 本次范围

- 提交：`ebb49ee`、`70c6095`
- Web：Remote Node 注册表单将多行 `allowed roots` 改为中文“授权目录”添加器；支持绝对路径即时校验、重复/数量限制、Chip 展示和单项移除。
- 协议/后端：未改变一次性注册码、roots 规范化、设备签名或权限边界。
- 部署：仅更新 Docker Compose 的 `agenthub` service，使用已验证 `agenthub:0.6.0-nas.28` 作为 overlay 基底生成 `agenthub:0.6.0-nas.29`。

## NAS 结果

| 检查项           | 结果                                                              |
| ---------------- | ----------------------------------------------------------------- |
| 主机             | `DH4300Plus` / `aarch64`                                          |
| Compose 项目     | `agenthub`                                                        |
| 入口             | `http://192.168.5.110:3210/`                                      |
| 镜像             | `agenthub:0.6.0-nas.29` / revision `70c6095`                      |
| 容器             | `running/healthy`                                                 |
| `/api/v1/health` | HTTP 200，`version=0.6.0`、`database=pglite`、`web=true`          |
| 根页面           | HTTP 200                                                          |
| 静态 bundle      | 包含“授权目录”文案                                                |
| node-pty         | 在 `/opt/agenthub/apps/server` 工作目录加载成功，`node-pty=READY` |

## 发布边界

- 升级前备份：`/volume2/Project/.agenthub/central/deployments/20260816T105434Z-pre-nas29/`。
- 先执行 Compose config 校验，再执行 `docker compose up -d --no-build agenthub`。
- 未执行 `docker compose down`；未删除镜像、卷、用户数据或其他 Agent 容器。
- `claude-code`、`hermes`、`openclaw-official`、`openclaw-custom` 不在本次变更范围内。

## 未验证项

当前环境没有授权浏览器/Computer Use/TX5Pro 通道，因此本记录不声明 1440/1024/768/390 人工视觉验收通过。完整 Vitest、Playwright 和 live gate 按用户要求留到最终集中回归。

# AgentHub v0.6 错误信封边界 nas.42 发布记录

日期：2026-08-16

## 范围

- 提交：`b3d1cac`。
- `error: null` 或缺少稳定 `code` 的 API 错误响应统一降级为 `HTTP_ERROR`，避免客户端读取错误字段时产生二次异常。
- 新增回归测试，覆盖非法错误 envelope。
- 部署：基于已验证的 `agenthub:0.6.0-nas.41` 构建 `agenthub:0.6.0-nas.42` overlay，仅更新 server/web dist。

## 验证

| 检查项 | 结果 |
| --- | --- |
| 聚焦 Vitest | API、realtime 2 files，8/8 passed |
| typecheck / build | 通过；Web 1716 modules transformed |
| NAS 主机 / 架构 | `DH4300Plus` / `aarch64` |
| Compose 服务 | `agenthub`，`running/healthy` |
| 镜像 / revision | `agenthub:0.6.0-nas.42` / `b3d1cac` |
| 访问地址 | `http://192.168.5.110:3210/` |
| 健康接口 | HTTP 200，`version=0.6.0`、`database=pglite`、`web=true` |
| 根页面 | HTTP 200 |
| Terminal native | `/opt/agenthub/apps/server` 工作目录加载 `node-pty=READY` |
| Compose config | 通过 |

## 变更边界与回滚

- 升级前备份：`/volume2/Project/.agenthub/central/deployments/20260816T141924Z-pre-nas42/`。
- 仅执行 `docker compose up -d --no-build agenthub`，没有执行 `compose down`。
- nas.41 镜像保留作为回滚点；未删除镜像、卷、用户数据或其他 Agent 容器。
- 受保护 Agent 容器只读核验完成，状态未被本次发布改变。

## 验证边界

- 当前环境没有授权浏览器/Computer Use/TX5Pro 通道，本记录不声明 1440、1024、768、390 人工视觉验收通过。

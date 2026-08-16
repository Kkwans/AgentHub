# AgentHub v0.6 用户错误边界 nas.39 发布记录

日期：2026-08-16

## 范围

- 提交：`cbd3044`。
- Web API 在网络失败或响应不是 JSON 时统一抛出稳定 `HTTP_ERROR`，普通错误卡片只显示中文下一步提示。
- ErrorState/InlineError 不再把浏览器原始异常直接展示给普通用户；原始细节留在诊断边界。
- 新增 `apps/web/src/lib/api.test.ts`，覆盖网络失败与非 JSON 响应归一化。
- 部署：基于已验证的 `agenthub:0.6.0-nas.38` 构建 `agenthub:0.6.0-nas.39` overlay，仅更新 server/web dist。

## 验证

| 检查项 | 结果 |
| --- | --- |
| 聚焦 Vitest | API、Form/Dialog、v0.6 feature-boundary 4 files，18/18 passed |
| lint / typecheck / build | 通过；Web 1716 modules transformed |
| NAS 主机 / 架构 | `DH4300Plus` / `aarch64` |
| Compose 服务 | `agenthub`，`running/healthy` |
| 镜像 / revision | `agenthub:0.6.0-nas.39` / `cbd3044` |
| 访问地址 | `http://192.168.5.110:3210/` |
| 健康接口 | HTTP 200，`version=0.6.0`、`database=pglite`、`web=true` |
| 根页面 | HTTP 200 |
| Terminal native | `/opt/agenthub/apps/server` 工作目录加载 `node-pty=READY` |
| Compose config | 通过 |

## 变更边界与回滚

- 升级前备份：`/volume2/Project/.agenthub/central/deployments/20260816T135155Z-pre-nas39/`。
- 仅执行 `docker compose up -d --no-build agenthub`，没有执行 `compose down`。
- nas.38 镜像保留作为回滚点；未删除镜像、卷、用户数据或其他 Agent 容器。
- 受保护 Agent 容器只读核验完成，状态未被本次发布改变。

## 验证边界

- 当前环境没有授权浏览器/Computer Use/TX5Pro 通道，本记录不声明 1440、1024、768、390 人工视觉验收通过。

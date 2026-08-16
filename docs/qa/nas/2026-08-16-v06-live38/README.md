# AgentHub v0.6 概览 Project 仓库类型中文展示 nas.38 发布记录

日期：2026-08-16

## 范围

- 提交：`a935a0f`。
- Web：概览页 Project 列表将原始 `repoKind` 映射为“Git / 非 Git”，不再把 `GIT` 枚举直接展示给普通用户。
- 回归：feature-boundary 增加概览仓库类型展示契约。
- 部署：基于已验证的 `agenthub:0.6.0-nas.37` 构建 `agenthub:0.6.0-nas.38` overlay，仅更新 server/web dist。

## 验证

| 检查项 | 结果 |
| --- | --- |
| 聚焦 Vitest | Overview/feature-boundary 2 files，14/14 passed |
| lint / typecheck / build | 通过；Web 1716 modules transformed |
| NAS 主机 / 架构 | `DH4300Plus` / `aarch64` |
| Compose 服务 | `agenthub`，`running/healthy` |
| 镜像 / revision | `agenthub:0.6.0-nas.38` / `a935a0f` |
| 访问地址 | `http://192.168.5.110:3210/` |
| 健康接口 | HTTP 200，`version=0.6.0`、`database=pglite`、`web=true` |
| 根页面 | HTTP 200 |
| Terminal native | `/opt/agenthub/apps/server` 工作目录加载 `node-pty=READY` |
| Compose config | 通过 |

## 变更边界与回滚

- 升级前备份：`/volume2/Project/.agenthub/central/deployments/20260816T133714Z-pre-nas38/`。
- 仅执行 `docker compose up -d --no-build agenthub`，没有执行 `compose down`。
- nas.37 镜像保留作为回滚点；未删除镜像、卷、用户数据或其他 Agent 容器。
- 受保护 Agent 容器只读核验完成，状态未被本次发布改变。

## 验证边界

- 当前环境没有授权浏览器/Computer Use/TX5Pro 通道，本记录不声明 1440/1024/768 人工视觉验收通过。

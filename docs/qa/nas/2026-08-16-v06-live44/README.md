# AgentHub v0.6 项目预检重试 nas.44 发布记录

日期：2026-08-16

## 范围

- 提交：`3b01c6a`。
- Project 预检失败时提供“重新检查目录”入口，重试期间明确显示检查中。
- 发布镜像：`agenthub:0.6.0-nas.44`，revision `3b01c6a`。
- nas.44 基于已验证的 nas.43 overlay，仅覆盖 `apps/web/dist`，保留 ARM64 `node-pty` native binding。

## 验证

| 检查项 | 结果 |
| --- | --- |
| 聚焦 Vitest | `apps/web/src/pages/v06/DiscoveryPages.test.tsx`，1 file / 1 passed |
| typecheck / lint / build | 通过；Web 1716 modules transformed |
| NAS 主机 / 架构 | `DH4300Plus` / `aarch64` |
| Compose 服务 | `agenthub`，`running/healthy` |
| 镜像 / revision | `agenthub:0.6.0-nas.44` / `3b01c6a` |
| 访问地址 | `http://192.168.5.110:3210/` |
| 健康接口 | HTTP 200，`version=0.6.0`、`database=pglite`、`web=true` |
| 根页面 | HTTP 200 |
| Terminal native | server 工作目录加载 `node-pty=READY` |
| Compose config | 通过 |

## 变更边界与回滚

- 升级前备份：`/volume2/Project/.agenthub/central/deployments/20260816T1445Z-pre-nas44/`。
- 仅执行 `docker compose up -d --no-build agenthub`，没有执行 `compose down`。
- nas.43 镜像保留作为回滚点；未删除镜像、卷、用户数据或其他 Agent 容器。
- 受保护 Agent 容器只读核验完成，状态未被本次发布改变。

## 验证边界

- 当前环境没有授权浏览器/Computer Use/TX5Pro 通道，本记录不声明 1440、1024、768、390 人工视觉验收通过。

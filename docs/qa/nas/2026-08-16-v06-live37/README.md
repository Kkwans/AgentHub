# AgentHub v0.6 普通 Agent 页面隐藏 adapter 细节 nas.37 发布记录

日期：2026-08-16

## 范围

- 提交：`42bf4a2`。
- Web：普通 Agent 发现页与 Remote Node inventory 不再显示 `ACP/adapter` 实现细节；保留 Agent 类型、版本、状态和诊断入口。
- 回归：新增 feature-boundary 约束，防止普通用户入口重新泄漏 adapter 标签。
- 部署：基于已验证的 `agenthub:0.6.0-nas.36` 构建 `agenthub:0.6.0-nas.37` overlay，仅更新 server/web dist。

## 验证

| 检查项 | 结果 |
| --- | --- |
| 聚焦 Vitest | Discovery/feature-boundary 2 files，11/11 passed |
| lint / typecheck / build | 通过；Web 1716 modules transformed |
| NAS 主机 / 架构 | `DH4300Plus` / `aarch64` |
| Compose 服务 | `agenthub`，`running/healthy` |
| 镜像 / revision | `agenthub:0.6.0-nas.37` / `42bf4a2` |
| 访问地址 | `http://192.168.5.110:3210/` |
| 健康接口 | HTTP 200，`version=0.6.0`、`database=pglite`、`web=true` |
| 根页面 | HTTP 200 |
| Terminal native | `/opt/agenthub/apps/server` 工作目录加载 `node-pty=READY` |
| Compose config | 通过 |

## 变更边界与回滚

- 升级前备份：`/volume2/Project/.agenthub/central/deployments/20260816T130838Z-pre-nas37/`。
- 仅执行 `docker compose up -d --no-build agenthub`，没有执行 `compose down`。
- nas.36 镜像保留作为回滚点；未删除镜像、卷、用户数据或其他 Agent 容器。
- 受保护 Agent 容器只读核验完成，状态未被本次发布改变。

## 验证边界

- 当前环境没有授权浏览器/Computer Use/TX5Pro 通道，本记录不声明 1440/1024/768 人工视觉验收通过。

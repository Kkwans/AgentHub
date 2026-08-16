# AgentHub v0.6 项目目录选择器错误恢复 nas.43 发布记录

日期：2026-08-16

## 范围

- 提交：`4a0a73a`。
- Project PathPicker 对目录范围、当前目录和工程扫描分别展示 loading/error 状态，并提供对应重试入口；请求失败不再伪装成空目录。
- 发布镜像：`agenthub:0.6.0-nas.43`，revision `4a0a73a`。
- nas.43 基于已验证的 nas.42 overlay，仅覆盖 `apps/web/dist`，保留 nas.42 的 ARM64 `node-pty` native binding。

## 验证

| 检查项 | 结果 |
| --- | --- |
| 聚焦 Vitest | `apps/web/src/pages/v06/DiscoveryPages.test.tsx`，1 file / 1 passed |
| typecheck / lint / build | 通过；Web 1716 modules transformed |
| NAS 主机 / 架构 | `DH4300Plus` / `aarch64` |
| Compose 服务 | `agenthub`，`running/healthy` |
| 镜像 / revision | `agenthub:0.6.0-nas.43` / `4a0a73a` |
| 访问地址 | `http://192.168.5.110:3210/` |
| 健康接口 | HTTP 200，`version=0.6.0`、`database=pglite`、`web=true` |
| 根页面 | HTTP 200 |
| Terminal native | server 工作目录加载 `node-pty=READY` |
| Compose config | 通过 |

## 变更边界与回滚

- 升级前备份：`/volume2/Project/.agenthub/central/deployments/20260816T1432Z-pre-nas43/`。
- 首次完整镜像构建因 NAS Dockerfile frontend 返回 HTTP 429 未采用；最终使用 nas.42 overlay，未修改基础依赖。
- 仅执行 `docker compose up -d --no-build agenthub`，没有执行 `compose down`。
- nas.42 镜像保留作为回滚点；未删除镜像、卷、用户数据或其他 Agent 容器。
- 受保护 Agent 容器只读核验完成，状态未被本次发布改变。

## 验证边界

- 当前环境没有授权浏览器/Computer Use/TX5Pro 通道，本记录不声明 1440、1024、768、390 人工视觉验收通过。

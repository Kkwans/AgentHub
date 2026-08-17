# AgentHub v0.6 nas.52 发布记录

日期：2026-08-17

提交：`e00c668`

镜像：`agenthub:0.6.0-nas.52`（`linux/arm64`，image ID `sha256:158f19c9501c8dc8f7966818b2cc2821dc64f81372fe55f2cb2801a930b81f62`）

入口：`http://192.168.5.110:3210/`

## 发布内容

- Task 看板在 390px 下保持单列可读宽度，用户通过横向滚动查看其他状态，并显示中文操作提示。
- Agent 实时连接失败不再直接展示 WebSocket 或供应商原始异常；普通用户看到中文下一步，脱敏诊断放在可展开的调试区域。
- 基于已验证的 `agenthub:0.6.0-nas.51` 构建 overlay，仅覆盖 `apps/server/dist` 与 `apps/web/dist`，保留 ARM64 `node-pty` native binding。

## 发布证据

| 检查项 | 结果 |
| --- | --- |
| NAS 主机 / 架构 | `DH4300Plus` / `aarch64` |
| Container | `agenthub` `running/healthy` |
| 端口 | `192.168.5.110:3210->3210/tcp` |
| Revision label | `e00c668` |
| Health | `GET /api/v1/health` HTTP 200，`version=0.6.0`、`database=pglite`、`web=true` |
| 根页面 | `GET /` HTTP 200 |
| Terminal native | server 工作目录加载 `node-pty=READY` |
| Compose config | 通过 |
| 受保护 Agent 容器 | `openclaw-custom` 仍 `running/healthy`；`openclaw-official`、`claude-code`、`hermes-dashboard`、`hermes` 状态未改变 |

## 验证命令

- 聚焦 Vitest（Workspace、错误 Presentation、feature-boundary 与 Agent 相关回归）：4 files / 47 passed。
- `corepack pnpm --filter @agenthub/web build`：通过，1716 modules transformed。
- `corepack pnpm typecheck`：通过。
- `corepack pnpm test:e2e`：24/24 passed，覆盖 1440/1024/768/390 fixture 回归；fixture 只用于隔离回归，不替代真实部署门禁。
- `sudo -n env PLAYWRIGHT_BROWSERS_PATH=/home/Kkwans/.cache/ms-playwright AGENTHUB_BASE_URL=http://192.168.5.110:3210 AGENTHUB_BROWSER_TOKEN_FILE=/volume2/DockerProject/agenthub/secrets/browser-token AGENTHUB_VISUAL_OUTPUT=docs/qa/visual/2026-08-17-v06 corepack pnpm test:visual:real`：真实 Compose 七页、四视口，console/page/request error `0`，横向溢出 `0`。
- `/tasks` 与真实 Workspace 会话的 1440/390 核心复核：console/page/request error `0`，`scrollWidth === clientWidth`；截图与机器结果见 [`docs/qa/visual/2026-08-17-v06/`](../../visual/2026-08-17-v06/)。

## 变更边界与回滚

- 升级前备份：`/volume2/Project/.agenthub/central/deployments/20260817T061748Z-pre-nas52/`。
- 只执行了 `docker compose up -d --no-build agenthub`，没有执行 `compose down`。
- 未删除容器、镜像、卷、Project、PGlite 数据、worktree 或其他 Agent 数据；nas.51 镜像保留为回滚点。
- 当前唯一正式视觉门禁是 NAS 本地 Playwright Chromium 对真实 Compose 部署的自动化验收；不依赖 TX5Pro、外部设备、人工浏览器或 fixture 页面。历史 TX5Pro 报告仅作为旧版本归档，不再是门禁或可选补充。

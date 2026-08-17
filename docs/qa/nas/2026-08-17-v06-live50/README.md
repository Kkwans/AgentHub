# AgentHub v0.6 nas.50 发布记录

日期：2026-08-17

提交：`4c0331f`

镜像：`agenthub:0.6.0-nas.50`

入口：`http://192.168.5.110:3210/`

## 发布内容

- 390px Agent 发现列表隐藏与标题重复的 Agent 类型标签，保留短名称、运行环境和状态信息。
- 390px 缺少依赖/运行环境停止的错误提示统一放到 Agent 内容列，避免错误文案落在图标列造成视觉错位。
- 基于已验证的 `agenthub:0.6.0-nas.49` 构建 overlay，仅覆盖 `apps/server/dist` 与 `apps/web/dist`，保留 ARM64 `node-pty` native binding。

## 发布证据

| 检查项 | 结果 |
| --- | --- |
| NAS 主机 / 架构 | `DH4300Plus` / `aarch64` |
| Container | 发布后 `running/healthy` |
| Image ID | `sha256:21431bce2abcacc9a375be4027a8de6e31f7575b22747e92f74371bc23bef5a7` |
| Revision label | `4c0331f` |
| Health | `/api/v1/health` HTTP 200，`version=0.6.0`、`database=pglite`、`web=true` |
| 根页面 | HTTP 200 |
| Terminal native | server 工作目录加载 `node-pty=READY` |
| Compose config | 通过 |

## 验证命令

- `corepack pnpm exec vitest run apps/web/src/pages/v06/DiscoveryPages.test.tsx`：1 file / 1 passed。
- `corepack pnpm --filter @agenthub/web build`：通过，1716 modules transformed。
- Docker overlay build：通过；`node-pty` native smoke 通过。
- Playwright Chromium 真实 NAS Agent 页面：1440、1024、768、390 四视口稳定截图，console error `0`。
- 390px 截图确认：重复类型标签消失，错误提示与 Agent 内容列对齐，页面无横向溢出。

## 变更边界与回滚

- 升级前备份：`/volume2/Project/.agenthub/central/deployments/20260817T045811Z-pre-nas50/`。
- 只执行了 `docker compose up -d --no-build agenthub`，没有执行 `compose down`。
- 未删除容器、镜像、卷、Project、PGlite 数据、worktree 或其他 Agent 数据；nas.49 镜像保留为回滚点。
- 本记录是自动化 Chromium 视觉验收，不等同于 TX5Pro 人工浏览器验收。

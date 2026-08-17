# AgentHub v0.6 nas.45 发布记录

日期：2026-08-17

提交：`a5903c5`

镜像：`agenthub:0.6.0-nas.45`

入口：`http://192.168.5.110:3210/`

## 发布内容

- 修复 768/390 宽度下移动菜单覆盖页头标题的问题；菜单回到页头布局流并统一控件尺寸。
- 修复 Project 手机卡片“开始会话”与“编辑/归档”操作项重叠的问题，窄屏下改为独立操作行。
- 使用已验证的 `agenthub:0.6.0-nas.44` 作为 overlay base，仅覆盖 `apps/server/dist` 与 `apps/web/dist`，保留 ARM64 `node-pty` native binding。

## 发布证据

| 检查项            | 结果                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| NAS 主机 / 架构   | `DH4300Plus` / `aarch64`                                                                          |
| Container         | `e6b81bb2eb9e...`，`running/healthy`                                                              |
| Image ID          | `sha256:b3f1793db2a3bd057b44ce8aa2ea6a7de19c25e7d268be37d8ada540b8de9fe8`                         |
| Revision label    | `a5903c5`                                                                                         |
| Health            | HTTP 200，`version=0.6.0`、`database=pglite`、`web=true`                                          |
| 根页面            | HTTP 200                                                                                          |
| Terminal native   | server 工作目录加载 `node-pty=READY`                                                              |
| Compose config    | 通过                                                                                              |
| 受保护 Agent 容器 | `claude-code`、`hermes`、`openclaw-official` 保持 stopped；`openclaw-custom` 保持 running/healthy |

## 验证命令

- `corepack pnpm --filter @agenthub/web build`：通过，1716 modules transformed。
- `corepack pnpm exec vitest run apps/web/src/pages/v06/DiscoveryPages.test.tsx`：1 file / 1 passed。
- Playwright Chromium 自动化视觉：六个主要页面 × 1440/1024/768/390，console error `0`。
- 横向溢出扫描：24 组 `scrollWidth === clientWidth`，全部通过。
- 视觉截图及判定：[`docs/qa/visual/2026-08-17-v06/README.md`](../../visual/2026-08-17-v06/README.md)。

## 变更边界与回滚

- 升级前备份：`/volume2/Project/.agenthub/central/deployments/20260817T040419Z-pre-nas45/`。
- 只执行了 `docker compose up -d --no-build agenthub`，没有执行 `compose down`。
- 未删除容器、镜像、卷、Project、PGlite 数据、worktree 或其他 Agent 数据；nas.44 镜像保留为回滚点。
- 本记录的 NAS 本地 Chromium 自动化视觉 gate 就是正式视觉验收；不依赖外部设备或人工浏览器。

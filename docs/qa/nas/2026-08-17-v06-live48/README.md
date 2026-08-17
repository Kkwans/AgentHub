# AgentHub v0.6 nas.48 发布记录

日期：2026-08-17

提交：`96e683d`

镜像：`agenthub:0.6.0-nas.48`

入口：`http://192.168.5.110:3210/`

## 发布内容

- Agent 发现列表将短 Agent 名称与 `运行环境` 分成独立层级，避免手机宽度下把容器名挤进标题并造成多行折返。
- 保留供应商原始 Agent 名称、容器名和版本等专业数据；普通用户仍只看到中文状态与下一步操作。
- 基于已验证的 `agenthub:0.6.0-nas.47` 构建 overlay，仅覆盖 `apps/server/dist` 与 `apps/web/dist`，保留 ARM64 `node-pty` native binding。

## 发布证据

| 检查项            | 结果                                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------- |
| NAS 主机 / 架构   | `DH4300Plus` / `aarch64`                                                                                                  |
| Container         | `268c5d429bcb...`，`running/healthy`                                                                                      |
| Image ID          | `sha256:e273874f5e2d7161a921443ae092312776f78ef07c99bce0f879061846fd16bb`                                                 |
| Revision label    | `96e683d`                                                                                                                 |
| Health            | `/api/v1/health` HTTP 200，`version=0.6.0`、`database=pglite`、`web=true`                                                 |
| 根页面            | HTTP 200                                                                                                                  |
| Terminal native   | server 工作目录加载 `node-pty=READY`                                                                                      |
| Compose config    | 通过                                                                                                                      |
| 受保护 Agent 容器 | `openclaw-custom` 保持 running/healthy；`openclaw-official`、`claude-code`、`hermes-dashboard`、`hermes` 未被本次发布启动 |

## 验证命令

- `corepack pnpm exec vitest run apps/web/src/pages/v06/DiscoveryPages.test.tsx`：1 file / 1 passed。
- `corepack pnpm --filter @agenthub/web build`：通过，1716 modules transformed。
- Docker overlay build：通过；`node-pty` native smoke 通过。
- Playwright Chromium 真实 NAS 页面：Agent 页面 1440、1024、768、390 四视口稳定截图，console error `0`。
- 390px DOM 回归：`scrollWidth=clientWidth=390`，`bodyScrollWidth=390`，Agent 名称与运行环境分层存在。

## 变更边界与回滚

- 升级前备份：`/volume2/Project/.agenthub/central/deployments/20260817T044150Z-pre-nas48/`。
- 只执行了 `docker compose up -d --no-build agenthub`，没有执行 `compose down`。
- 未删除容器、镜像、卷、Project、PGlite 数据、worktree 或其他 Agent 数据；nas.47 镜像保留为回滚点。
- 本记录是 NAS 本地 Chromium 对真实部署执行的正式自动化视觉验收，不依赖外部设备或人工浏览器。

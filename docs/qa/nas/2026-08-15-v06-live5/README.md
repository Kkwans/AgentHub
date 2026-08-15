# AgentHub v0.6 Terminal UI 与 NAS nas.5 发布验收

日期：2026-08-15

结果：`PASS / VISUAL_GATE_PENDING`

代码：`a6f5c16`（`feat(workspace): 交付 Local Project Terminal`）

访问地址：`http://192.168.5.110:3210`

## 代码与自动化证据

- `corepack pnpm lint`：通过。
- `corepack pnpm typecheck`：通过。
- `corepack pnpm test`：非沙箱环境通过 45 个文件，`184 passed / 9 skipped / 193 total`。
- `corepack pnpm build`：通过；Web `1715 modules transformed`。保留已知大 chunk warning，不影响退出码。
- `corepack pnpm test:e2e`：24/24 通过，覆盖 1440/1024/768/390 fixture、URL 恢复、键盘与 axe；该自动化结果不替代 TX5Pro 人工视觉验收。
- Terminal 聚焦测试：TerminalDock 2/2 通过；Server Terminal 生命周期覆盖 `terminal.closed`。
- GitHub Actions run `31889417182`（commit `a6f5c16`）：`verify` job 成功。
- v0.6 既有真实 live gate（4 个文件、9 个测试）保持通过，覆盖真实 Codex、Remote Node、Worktree 与供应商能力差异；本次 Terminal UI 不伪称 NAS PTY 已可用。

## NAS 发布证据

- 目标已核验：`DH4300Plus`、`aarch64`、Compose project `agenthub`，正式 Compose
  `/volume2/DockerProject/agenthub/docker-compose.yml`，端口 `192.168.5.110:3210`。
- 发布前备份：`/volume2/Project/.agenthub/central/deployments/20260815T141727Z-pre-nas5/`。
  - Compose SHA-256：`2404f8b90d5b305dd53a7c0799c4b68dc9f135f682debe10fa3c54b1095376f3`
  - `.env` SHA-256：`cc3cabd97520b598888066af8d2921bc56fcaf042eb64c81b23128ef21154181`
  - browser-token 仅备份并校验 hash：`d1e3d6d77a351bd669f975c32b414d8c9cd581e2e8fe87a11a4e0a64290db087`
- 新镜像：`agenthub:0.6.0-nas.5`，ARM64，image ID
  `sha256:0c30d4eb70b396febf273c86b9a7d8373a054cb4bb9aea9baff88cd15fd7ec09`，OCI revision `a6f5c16`。
  镜像以已验证 `agenthub:0.6.0-nas.4` 为基底，仅 overlay 本次 server/web dist；旧镜像保留。
- 新容器：`c519db777442eb0276cec5f5971b681f939558408688edaeeaf5e82b293264eb`，最终
  `running/healthy`、`user=0:0`、`privileged=true`、`restart=unless-stopped`；`AGENTHUB_PROJECT_OWNER_UID/GID`
  为 `1000:10`。
- `GET /api/v1/health` 返回 `status=ok`、`version=0.6.0`、`database=pglite`、`web=true`；根页面 HTTP `200`。
- `GET /api/v1/settings/capabilities`（授权请求）如实返回：
  `terminal.available=false`、`code=PTY_NATIVE_BINDING_UNAVAILABLE`、`platform=linux`、`arch=arm64`。
  Workspace 因此显示中文不可用原因并禁用打开动作，不使用普通 Shell 模拟 PTY。
- `claude-code`、`hermes`、`openclaw-official` 仍保持原 stopped 状态，`openclaw-custom` 保持原 running/healthy；
  未修改其他 Agent 容器。

## 安全边界与回滚

- 只执行了 `docker compose up -d --no-build agenthub`；没有执行 `docker compose down`。
- 没有删除镜像、卷、用户数据或其他 Compose project/Agent 容器；旧 nas.4 镜像和发布前备份保留。
- `.tmp-v05` 原本不存在，因此没有删除；本轮 overlay Dockerfile 与 staging context 已在构建后清理。
- 回滚：恢复备份目录中的 Compose/`.env`，将 `AGENTHUB_IMAGE`/`AGENTHUB_REVISION` 恢复为 nas.4 值，再执行
  `docker compose up -d --no-build agenthub`；不执行 `compose down`，不清理镜像或卷。

## 未验证项

当前没有可用浏览器/Computer Use/TX5Pro 通道，因此 1440、1024、768、390 的人工视觉与人工可用性 checklist
仍为 `PENDING_BROWSER_CHANNEL`。Playwright、curl、静态构建和服务器健康均不替代该人工 gate。

# AgentHub v0.6 UI/可访问性修复发布验收

日期：2026-08-14
结果：`PASS / VISUAL_GATE_PENDING`
部署目录：`/volume2/DockerProject/agenthub`
访问地址：`http://192.168.5.110:3210`

## 代码与 UI 变更

- commit：`1ad230e`，已推送 `origin/main`。
- 将旧 `styles.css` 尾部的 v4 补丁块收敛到
  `apps/web/src/styles/design-system.css`，主入口保持明确的共享层 → feature 层导入顺序。
- 为 Radix `orange-9` solid controls 设置可访问的深暖色对比文字；不通过 axe ignore 掩盖问题。
- 删除 `v4` CSS 命名；没有新增 feature 内复制的 form 基础样式或单边强调线体系。

## 自动化证据

- `corepack pnpm lint`：通过。
- `corepack pnpm typecheck`：通过。
- `corepack pnpm build`：通过，Web 转换 1711 modules；保留既有大 chunk warning。
- `TMPDIR=/dev/shm/agenthub-v06-css-test corepack pnpm test`：44 个文件通过、3 个跳过；182 passed、7 skipped。
- `corepack pnpm exec playwright test --grep 'axe'`：四视口 4/4 通过。
- `corepack pnpm test:e2e`：24/24 通过，覆盖 1440/1024/768/390、URL 恢复、键盘和核心页面 axe。
- GitHub Actions run `31777520674`（commit `1ad230e`）：lint、typecheck、test、build 与 Playwright E2E 全绿；
  Node.js 20 action deprecation 仅为 annotation。
- 本地 fixture 的 `/ws` → `127.0.0.1:3210` `ECONNREFUSED` 是无真实 Server 的预期隔离噪声，不等同生产故障。

## NAS 升级

- 升级前 root-only 备份：
  `/volume2/Project/.agenthub/central/deployments/20260814T064756Z-pre-nas2/`。
- 备份文件 SHA-256：Compose `2404f8b90d5b305dd53a7c0799c4b68dc9f135f682debe10fa3c54b1095376f3`；
  `.env` `16c6ae7e2a2e0fea07811ad72cf228a32e964b5db289b89682c19a0ae8e7836d`；
  browser-token `d1e3d6d77a351bd669f975c32b414d8c9cd581e2e8fe87a11a4e0a64290db087`。
- 新镜像：`agenthub:0.6.0-nas.2`，Linux ARM64，image ID
  `sha256:8314c0a6d3bc4532d74f2b37c45166215bd4669256db6d7311b14d5d3e040e3e`，OCI revision `1ad230e`。
- 仅执行 `docker compose up -d --no-build agenthub`；没有执行 `docker compose down`，没有删除镜像、卷、用户数据，
  没有操作其他 Compose project 或 Agent 容器。
- 当前容器：`8499e9c847b060b116906178c7b0444fdc11977f4a3f27f6a528740c5c9aa3c7`，
  `running/healthy`、`user=0:0`、`privileged=true`、`restart=unless-stopped`。
- 健康接口：`status=ok`、`version=0.6.0`、`database=pglite`、`web=true`；根页面 `200` 且 `lang=zh-CN`。
- Compose project `agenthub` 仍登记在 Docker project 列表；入口继续监听 `192.168.5.110:3210`。
- 已授权删除的 `.tmp-v05` 在 `/volume2/Project` 与 `/tmp` 均未发现，因此未执行删除。

## 未验证与回滚

- 当前没有可用浏览器/Computer Use 通道；TX5Pro 1440/1024/768/390 人工视觉和人工可用性 checklist 仍未声明通过。
- 本次只验证 UI fixture 与自动化浏览器；真实 Codex/Remote Node/Worktree/Docker live gate 证据沿用上一条发布记录，未将其冒充本次 CSS 的 live smoke。
- 回滚使用上述 root-only 备份恢复 `.env`/Compose，并通过 `docker compose up -d --no-build agenthub` 回到旧 image；必要时再使用既有 data/worktrees 归档。

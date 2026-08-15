# AgentHub v0.6 discovery/live 与 NAS nas.4 发布验收

日期：2026-08-15

结果：`PASS / VISUAL_GATE_PENDING`

代码：`e11eed7`（`test(live): 覆盖真实 discovery 与 Codex 接管闭环`）

访问地址：`http://192.168.5.110:3210`

## 代码与自动化证据

- `corepack pnpm lint`：通过。
- `corepack pnpm typecheck`：通过。
- `corepack pnpm build`：通过；Web `1711 modules transformed`。生产构建保留已知大 chunk
  warning，不影响退出码。
- `TMPDIR=/volume2/Project/AgentHub/tmp-v06-release-test15 corepack pnpm test`：44 个文件通过，
  `182 passed / 9 skipped / 191 total`。
- `TMPDIR=/volume2/Project/AgentHub/tmp-v06-live-final4 AGENTHUB_E2E_LIVE=1 corepack pnpm test:live`：
  4 个文件、9 个测试全部通过。live gate 已串行化，覆盖真实 Codex preflight/session/cancel、
  一次性 Git 仓库文件变更、工作区 Diff、selected-file stage/commit、Remote Node、Worktree
  Review/Merge、Claude Code 固定 adapter 缺失的 `BROKEN`、Hermes workspace 未映射和 OpenClaw
  Gateway-backed ACP。
- 新增 discovery live 闭环实际执行 `discovery → Runtime adopt → Agent adopt/preflight → Project
→ Session → Run → Message → close`；服务端返回 adopt 后的最新 Agent 快照，避免把已通过的
  `preflight=READY` 与旧 `status=UNVERIFIED` 混在一起。
- GitHub Actions run `31886283190`（head `e11eed73924ec31d3cc23369755f3d78ab7111f`）：
  lint、typecheck、test、build、Playwright E2E 全绿。Node.js 20 action deprecation 仅为 annotation。

## NAS 发布证据

- 目标已核验：`DH4300Plus`、`aarch64`、Compose project `agenthub`，正式 Compose
  `/volume2/DockerProject/agenthub/docker-compose.yml`，端口 `192.168.5.110:3210`。
- 发布前备份：`/volume2/Project/.agenthub/central/deployments/20260815T130846Z-pre-nas4/`。
  - Compose SHA-256：`2404f8b90d5b305dd53a7c0799c4b68dc9f135f682debe10fa3c54b1095376f3`
  - `.env` SHA-256：`03d720bff68965e52ed3a09c358a22bda2f4c36d9017daa01d68ba0623a05224`
  - browser-token 仅备份并校验 hash：`d1e3d6d77a351bd669f975c32b414d8c9cd581e2e8fe87a11a4e0a64290db087`
- 新镜像：`agenthub:0.6.0-nas.4`，ARM64，image ID
  `sha256:d5a7745b70667521ac86243984013c6a3b37b8adb88efd33bd0a0680eb9b2cca`，OCI revision
  `e11eed7`。
- 新容器：`3d9ba293780758b66497987855240ab494bed68e8efe92f7645ef9c4b19ac7ec`，
  `running/healthy`、`user=0:0`、`privileged=true`、`restart=unless-stopped`。
- 健康接口：`GET /api/v1/health` 返回 `status=ok`、`version=0.6.0`、`database=pglite`、
  `web=true`；根页面 HTTP `200`。升级后容器内 `apps/server/dist/index.js` 与
  `packages/adapter-acp/dist/acp-adapter.js` 均与主机构建产物 SHA-256 一致：
  `2939e93fd75f0aebe576f4968b5edf4e837145d42c1dd9a67a4bcee566b7e3fe`、
  `ac635258bfd1cea7825433a0c1a44f121e06b95698f8f5621d7189c72d9e78ae`。
- `docker compose ps` 与 `docker compose ls` 均显示 `agenthub` 项目运行；`.env` 当前为
  `AGENTHUB_IMAGE=agenthub:0.6.0-nas.4`、`AGENTHUB_REVISION=e11eed7`。
- `claude-code`、`hermes`、`openclaw-official` 仍为原 stopped 容器，`openclaw-custom` 仍为原
  running 容器；容器 ID、镜像和状态未因 AgentHub 升级改变。旧 `agenthub:0.6.0-nas.3` 镜像
  保留，可作为回滚点。

标准 Compose BuildKit 构建仍被 NAS registry mirror 对 `docker/dockerfile:1.7` 返回的
`429 Too Many Requests` 阻断。本次使用已验证的 `nas.3` ARM64 镜像作为基底，仅 overlay
`e11eed7` 的 `apps/server/dist`；ACP dist 未改变但已逐字节核验。临时 overlay Dockerfile 与
staging context 已在构建和核验后删除。待 mirror 恢复后仍应执行一次完整 pinned image build，
并保留 nas.4 作为当前回滚点。

## 安全边界与回滚

- 只执行了 `docker compose up -d --no-build agenthub`；没有执行 `docker compose down`。
- 没有删除镜像、卷、用户数据或其他 Compose project/Agent 容器；`.tmp-v05` 在目标路径不存在，
  因此没有删除；本轮 overlay staging 临时目录已清理。
- 回滚：恢复备份目录中的 Compose/`.env`，把 `AGENTHUB_IMAGE`/`AGENTHUB_REVISION` 恢复为旧值，
  再执行 `docker compose up -d --no-build agenthub`；不执行 `compose down`，不清理镜像或卷。

## 未验证项

当前没有可用浏览器/Computer Use/TX5Pro 通道，因此 1440、1024、768、390 的人工视觉与人工可用性
checklist 仍为 `PENDING_BROWSER_CHANNEL`。Playwright、curl、静态构建和服务器健康均不替代该人工 gate。

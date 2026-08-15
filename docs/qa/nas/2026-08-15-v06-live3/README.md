# AgentHub v0.6 ACP/live 与 NAS nas.3 发布验收

日期：2026-08-15
结果：`PASS / VISUAL_GATE_PENDING`
代码：`4eb548d`（`feat(live): 完成真实 Codex 变更与 ACP 事件闭环`）
访问地址：`http://192.168.5.110:3210`

## 代码与自动化证据

- `corepack pnpm lint`：通过。
- `corepack pnpm typecheck`：通过。
- `corepack pnpm build`：通过；Web `1711 modules transformed`。生产构建仍保留已知大 chunk
  warning，不影响退出码。
- `TMPDIR=/volume2/Project/AgentHub/tmp-v06-release-test13 corepack pnpm test`：44 个文件通过，
  `182 passed / 8 skipped / 190 total`。
- `TMPDIR=/volume2/Project/AgentHub/tmp-v06-live-final2 AGENTHUB_E2E_LIVE=1 corepack pnpm test:live`：
  3 个文件、8 个测试全部通过。覆盖真实 Codex preflight/session/cancel、一次性 Git 仓库文件变更、
  工作区 Diff、selected-file stage/commit、Remote Node、Worktree Review/Merge、Claude Code
  固定 adapter 缺失的 `BROKEN`、Hermes workspace 未映射和 OpenClaw Gateway-backed ACP。
- GitHub Actions run `31884092817`（head `4eb548d1203f3874ad5f917e6eca0490d7107496`）：
  lint、typecheck、test、build、Playwright E2E 全绿。Node.js 20 action deprecation 仅为 annotation。
- ACP 归一化回归：当合法的 `tool_call_update` 省略 `kind`、`locations` 或 `title` 时，继承初始
  `tool_call` 元数据；fixture 已验证该 partial update 行为。

## NAS 发布证据

- 目标已核验：`aarch64`、Docker `29.4.3`、Compose project `agenthub`，正式 Compose
  `/volume2/DockerProject/agenthub/docker-compose.yml`，端口 `192.168.5.110:3210`。
- 发布前备份：
  `/volume2/Project/.agenthub/central/deployments/20260815T122000Z-pre-nas3/`。
  - Compose SHA-256：`2404f8b90d5b305dd53a7c0799c4b68dc9f135f682debe10fa3c54b1095376f3`
  - `.env` SHA-256：`f75e8cfb305aaf973aa6116cb22ac291f58ce8a1d876c2f2de76f2e0c4ef06bf`
  - browser-token 仅备份并校验 hash：`d1e3d6d77a351bd669f975c32b414d8c9cd581e2e8fe87a11a4e0a64290db087`
- 新镜像：`agenthub:0.6.0-nas.3`，ARM64，image ID
  `sha256:36c54094d81b9c43ed2302593ad25464105f11fb7cc7e437ef1a87ca3cd2ce9c`，OCI revision
  `4eb548d`。
- 新容器：`f704fc2270ab15afd49ef9df9c7b184b543445a49f8592f1beef475536c5d1e9`，
  `running/healthy`、`user=0:0`、`privileged=true`、`restart=unless-stopped`。
- 健康接口：`GET /api/v1/health` 返回 `status=ok`、`version=0.6.0`、`database=pglite`、
  `web=true`；根页面 HTTP `200`。升级后容器内 `apps/server/dist/index.js` 与
  `packages/adapter-acp/dist/acp-adapter.js` 均与主机当前构建产物 SHA-256 一致。
- 三个既有 Agent 容器的 ID、镜像和运行状态未被 AgentHub 升级改变：`claude-code`、`hermes`、
  `openclaw-official` 保持 stopped，`openclaw-custom` 保持 running；旧 `agenthub:0.6.0-nas.2`
  镜像保留。

标准 Compose BuildKit 构建第一次被 NAS registry mirror 对 `docker/dockerfile:1.7` 返回的
`429 Too Many Requests` 阻断。由于 pinned ARM64 Node 基础镜像已在本机，发布使用旧的已验证
`nas.2` 镜像作为基底，仅 overlay 当前 commit 生成的 server/ACP production dist；overlay
Dockerfile 和 staging context 已在构建后删除，且运行时 hash 已核验。下一次完整镜像构建仍应在
mirror 恢复后执行并保留 `nas.3` 作为回滚点。

## 安全边界与回滚

- 只执行了 `docker compose up -d --no-build agenthub`；没有执行 `docker compose down`。
- 没有删除镜像、卷、用户数据或其他 Compose project/Agent 容器；旧 `nas.2` 和既有回滚备份均保留。
- `.tmp-v05` 在 `/volume2/Project` 与 `/tmp` 未发现，因此没有删除；本轮测试产生的、可明确归属本轮的
  `tmp-v06-*` 临时目录已逐个清理。
- 回滚：恢复备份目录中的 Compose/`.env`，把 `AGENTHUB_IMAGE`/`AGENTHUB_REVISION` 恢复为旧值，
  再执行 `docker compose up -d --no-build agenthub`；不执行 `compose down`，不清理镜像或卷。

## 未验证项

当前没有可用浏览器/Computer Use/TX5Pro 通道，因此 1440、1024、768、390 的人工视觉与人工可用性
checklist 仍为 `PENDING_BROWSER_CHANNEL`。Playwright、curl、静态构建和服务器健康均不替代该人工 gate。

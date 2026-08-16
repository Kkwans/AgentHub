# AgentHub v0.6 Agent 状态修正与 NAS nas.14 发布验收

日期：2026-08-16

结果：`PASS / VISUAL_GATE_PENDING`

代码：`37ebaa89f32326c254ac4a9b81977f551cf32716`

访问地址：`http://192.168.5.110:3210`

## 本次用户体验修复

- 固定 `@agentclientprotocol/codex-acp@1.1.14` 存在时，宿主 Codex discovery 显示 `INSTALLED`，不再因为宿主机没有 `codex` CLI 而误报缺依赖。
- 宿主 Agent 缺依赖、异常或不支持时，服务端不再返回误导性的可接入动作，并提供稳定 reason code。
- Agent 页面过滤 `UNKNOWN` 普通 Docker 容器；仍保留受支持的 Agent 候选，并显示隐藏数量和“先配置支持的 Agent Profile”的中文说明。

## 自动化证据

- `corepack pnpm lint`：通过。
- `corepack pnpm typecheck`：通过。
- `corepack pnpm build`：通过；Web `1715 modules transformed`。
- `corepack pnpm exec vitest run --maxWorkers=1 --pool=forks --reporter=dot`：49 个非 live 文件，`205 passed / 9 skipped`。
- `corepack pnpm test:e2e`：24/24 通过，覆盖 1440/1024/768/390 fixture、URL 恢复、键盘、无横向溢出与 axe；fixture 的 `/ws` `ECONNREFUSED` 是无本地后端时的隔离噪声，不替代人工视觉验收。
- `AGENTHUB_E2E_LIVE=1 TMPDIR=/tmp corepack pnpm test:live`：4 个文件、9 个测试全部通过；真实 Codex preflight/session/stream/cancel、Git 文件变更/Diff/commit、Claude Code adapter 缺失、Hermes workspace 未映射、OpenClaw ACP 和 OpenCode 缺失分支均按实际状态记录。
- GitHub Actions run `31926163032`（commit `37ebaa8`）：`verify` 成功，lint、typecheck、test、build、Playwright E2E 全部通过；Node.js 20 action deprecation 仅为 annotation。

## NAS 发布证据

- 目标：`DH4300Plus`、`aarch64`；Compose project `agenthub`；正式 Compose `/volume2/DockerProject/agenthub/docker-compose.yml`；端口 `192.168.5.110:3210`。
- 发布前备份：`/volume2/Project/.agenthub/central/deployments/20260816T041830Z-pre-nas14/`。
  Compose SHA-256 `0e3e92b7078a4a6cfde4fa8c5493539ffac0e238f1aa570ff689606a095f27ff`；旧 `.env` SHA-256
  `b59bebead2befb58f506e8bd904f58442fde5608ee565f2a6d5a78cdaa01fc9d`；发布后 `.env` SHA-256
  `dc4c6bba69133174d1da09ea7df9975c4344a4617df481513b6bb2dcd8c11ff3`；browser-token 仅保留 hash
  `d1e3d6d77a351bd669f975c32b414d8c9cd581e2e8fe87a11a4e0a64290db087`。
- 镜像：`agenthub:0.6.0-nas.14`，Linux ARM64，image ID
  `sha256:d96ce748d45bbe48cb904bf70c33ee39e0127ec152b54098ebfaaac6b190d1c2`，OCI revision
  `37ebaa89f32326c254ac4a9b81977f551cf32716`；基于已验证 `agenthub:0.6.0-nas.13`，通过
  `deploy/compose/Dockerfile.nas-overlay` 仅覆盖 server/web dist。
- 构建时和运行时 `node-pty` 检查通过：`spawn=function`、`platform=linux`、`arch=arm64`。
- 容器：`5bb92c59564f1575e94411837f7301f16963b19fe970242846e2e76cc43b9f4b`，最终
  `running/healthy`、`user=0:0`、`privileged=true`、`restart=unless-stopped`。
- `/api/v1/health` 返回 `status=ok`、`version=0.6.0`、`database=pglite`、`web=true`。
- 授权 `/api/v1/settings/capabilities` 返回 `terminal.available=true`、`code=READY`、
  `platform=linux`、`arch=arm64`；`remoteNode.available=true`、`transport=outbound_websocket`。
- Agent discovery API 返回 75 个候选：8 个受支持 Agent、67 个 `UNKNOWN` 普通容器；Codex 为
  `INSTALLED`/可接入，OpenCode 为 `MISSING_DEPENDENCY`/不可接入。
- 真实 Terminal/WS smoke：Project `6d1ca2e6-f1a2-4250-a1ae-1e4e962272a0` 完成 API open、统一 `/ws`
  `terminal:2ae4d3f0-6e2b-4b7a-8044-d7467e40f409` 订阅、输入 marker `nas14-pty-ok`、收到 output、API close。
- Claude Code、Hermes、OpenClaw（`openclaw-official`、`openclaw-custom`）发布前后 name/ID/image 一致；live smoke 后
  stopped/running 状态恢复为原状态。本次仅更新 AgentHub service。

## 安全边界与回滚

- 只执行 `docker compose -f /volume2/DockerProject/agenthub/docker-compose.yml up -d --no-build agenthub`；没有执行 `docker compose down`。
- 没有删除镜像、卷、用户数据或其他 Agent 容器；`agenthub:0.6.0-nas.13` 保留作为回滚点。
- `.tmp-v05` 不存在，因此没有删除。
- 回滚：恢复备份目录中的 `.env`，使 `AGENTHUB_IMAGE=agenthub:0.6.0-nas.13`、`AGENTHUB_REVISION=2fbc3dc`，然后执行同一 Compose service 的 `up -d --no-build agenthub`；不执行 `compose down`。

## 未验证项

当前没有可用浏览器/Computer Use/TX5Pro 通道，因此 1440、1024、768、390 的人工视觉与人工可用性 checklist 仍为 `PENDING_BROWSER_CHANNEL`。Playwright、curl、Terminal API/WS smoke、静态构建和服务器健康均不替代该人工 gate。

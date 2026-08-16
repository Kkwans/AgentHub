# AgentHub v0.6 discovery 边界修复与 NAS nas.12 发布验收

日期：2026-08-16

结果：`PASS / VISUAL_GATE_PENDING`

代码：`123af329e1a578f6f235ed4a6a251db3d9de528b`

访问地址：`http://192.168.5.110:3210`

## 本次用户体验与后端切片

- Docker/Runtime 停止、未识别或不支持时，Agent discovery 候选保持可见但不再提供“接入并检查”。
- Server 以稳定 `AGENT_CANDIDATE_NOT_ADOPTABLE` 错误码拒绝不安全接入，并返回状态与原因码；Web 映射为中文下一步提示。
- 新增 `AgentDiscoveryService` 单元契约和 discovery HTTP route 契约，覆盖状态映射、停止竞态、幂等接入、参数校验和稳定错误信封。

## 自动化证据

- `corepack pnpm lint`：通过。
- `corepack pnpm typecheck`：通过。
- `corepack pnpm build`：通过；Web `1715 modules transformed`。
- `corepack pnpm exec vitest run --maxWorkers=1 --pool=forks --reporter=dot`：53 个文件，`200 passed / 9 skipped`。
  本地默认并发曾出现资源竞争超时；GitHub CI 默认门禁已对同一 commit 通过。
- `corepack pnpm test:e2e`：24/24 通过，覆盖 1440/1024/768/390 fixture、URL 恢复、键盘、无横向溢出与 axe。
  fixture 的 `/ws` `ECONNREFUSED` 是没有本地后端时的预期隔离噪声，不替代人工视觉验收。
- GitHub Actions run `31923237501`（commit `123af32`）：`verify` 成功，lint、typecheck、test、build、Playwright E2E 全部通过。

## NAS 发布证据

- 目标：`DH4300Plus`、`aarch64`；Compose project `agenthub`；正式 Compose
  `/volume2/DockerProject/agenthub/docker-compose.yml`；端口 `192.168.5.110:3210`。
- 发布前备份：`/volume2/Project/.agenthub/central/deployments/20260816T030407Z-pre-nas12/`。
  Compose SHA-256 `0e3e92b7078a4a6cfde4fa8c5493539ffac0e238f1aa570ff689606a095f27ff`；旧 `.env`
  SHA-256 `3bb6d6f8d6bf7f8a0b44d096a7dc4b7e0da7b3e9b528f7da98d05c39ade00397`；发布后 `.env`
  SHA-256 `f56fad7d044ae1f5efaed0314616bf8728dcd8f02fd66eefc4af50f9d8fdf648`；browser-token 仅保留 hash
  `d1e3d6d77a351bd669f975c32b414d8c9cd581e2e8fe87a11a4e0a64290db087`。
- 镜像：`agenthub:0.6.0-nas.12`，Linux ARM64，image ID
  `sha256:2c51ef8148565bd6390c5f8938d4deeecd5c77234294d68976ab65f8db3db3d3`，OCI revision
  `123af329e1a578f6f235ed4a6a251db3d9de528b`；基于已验证 `agenthub:0.6.0-nas.11`，通过
  `deploy/compose/Dockerfile.nas-overlay` 仅覆盖 server/web dist。
- 构建时和运行时 `node-pty` 检查通过：`spawn=function`、`platform=linux`、`arch=arm64`。
- 容器：`7181e640ac0aff13a5863c8f5698d481710e67ead1f06aa8d3403f47fe11cb6f`，最终
  `running/healthy`、`user=0:0`、`privileged=true`、`restart=unless-stopped`。
- `/api/v1/health` 返回 `status=ok`、`version=0.6.0`、`database=pglite`、`web=true`。
- 授权 `/api/v1/settings/capabilities` 返回 `terminal.available=true`、`code=READY`、
  `platform=linux`、`arch=arm64`；`remoteNode.available=true`、`transport=outbound_websocket`。
- 真实 Terminal/WS smoke：Project `6d1ca2e6-f1a2-4250-a1ae-1e4e962272a0` 完成 API open、统一 `/ws`
  `terminal:405103b9-e836-43ef-a9a5-f515aae4f8bd` 订阅、input `printf nas12-pty-ok\\n`、收到 output、API close。
- Claude Code、Hermes、OpenClaw（`openclaw-official`、`openclaw-custom`）在发布前后 name/ID/image 一致。
  全量 Docker 快照期间观察到其他项目容器的外部漂移；本次没有操作这些容器，也没有执行 Compose 全局操作。

## 安全边界与回滚

- 只执行 `docker compose -p agenthub -f /volume2/DockerProject/agenthub/docker-compose.yml up -d --no-build agenthub`；没有执行 `docker compose down`。
- 没有删除镜像、卷、用户数据或其他 Agent 容器；`agenthub:0.6.0-nas.11` 保留作为回滚点。
- `.tmp-v05` 不存在，因此没有删除。
- 回滚：恢复备份目录中的 `.env`，使 `AGENTHUB_IMAGE=agenthub:0.6.0-nas.11`、
  `AGENTHUB_REVISION=3508d22`，然后执行同一 Compose service 的 `up -d --no-build agenthub`；不执行 `compose down`。

## 未验证项

当前没有可用浏览器/Computer Use/TX5Pro 通道，因此 1440、1024、768、390 的人工视觉与人工可用性
checklist 仍为 `PENDING_BROWSER_CHANNEL`。Playwright、curl、Terminal API/WS smoke、静态构建和服务器健康
均不替代该人工 gate。

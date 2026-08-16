# AgentHub v0.6 Remote Node inventory 与 NAS nas.13 发布验收

日期：2026-08-16

结果：`PASS / VISUAL_GATE_PENDING`

代码：`2fbc3dc18a60be3fbaf7a07bb4fe46d15303bc56`

访问地址：`http://192.168.5.110:3210`

## 本次用户旅程与后端切片

- 统一 Agent discovery 合并已注册 Remote Node 的 `inventoryJson`，不再让远程 Agent 只存在于设置页清单。
- Remote Node 候选按 `inventoryKey` 保留稳定身份；已注册同类 Agent 会去重，接入时精确选择请求的 inventory 项。
- `ONLINE/OFFLINE/REVOKED` 与 `AVAILABLE/MISSING/BROKEN` 映射为 READY、STOPPED、MISSING_DEPENDENCY、BROKEN 或 UNKNOWN；不可接入状态不显示误导性的接入动作。
- 远程 Agent 接入与 preflight 使用 Remote Node 的允许 root 作为 cwd，并在前端提供离线、撤销、缺依赖和 inventory 无效的中文下一步提示。

## 自动化证据

- `corepack pnpm lint`：通过。
- `corepack pnpm typecheck`：通过。
- `corepack pnpm build`：通过；Web `1715 modules transformed`。
- `corepack pnpm exec vitest run --maxWorkers=1 --pool=forks --reporter=dot`：53 个文件，`203 passed / 9 skipped`。
- `corepack pnpm test:e2e`：24/24 通过，覆盖 1440/1024/768/390 fixture、URL 恢复、键盘、无横向溢出与 axe；fixture 的 `/ws` `ECONNREFUSED` 仍是无本地后端时的隔离噪声，不替代人工视觉验收。
- GitHub Actions run `31924583891`（commit `2fbc3dc`）：`verify` 成功，lint、typecheck、test、build、Playwright E2E 全部通过。

## NAS 发布证据

- 目标：`DH4300Plus`、`aarch64`；Compose project `agenthub`；正式 Compose `/volume2/DockerProject/agenthub/docker-compose.yml`；端口 `192.168.5.110:3210`。
- 发布前备份：`/volume2/Project/.agenthub/central/deployments/20260816T034029Z-pre-nas13/`。
  Compose SHA-256 `0e3e92b7078a4a6cfde4fa8c5493539ffac0e238f1aa570ff689606a095f27ff`；旧 `.env`
  SHA-256 `f56fad7d044ae1f5efaed0314616bf8728dcd8f02fd66eefc4af50f9d8fdf648`；发布后 `.env`
  SHA-256 `b59bebead2befb58f506e8bd904f58442fde5608ee565f2a6d5a78cdaa01fc9d`；browser-token 仅保留 hash
  `d1e3d6d77a351bd669f975c32b414d8c9cd581e2e8fe87a11a4e0a64290db087`。
- 镜像：`agenthub:0.6.0-nas.13`，Linux ARM64，image ID
  `sha256:44c4049fc919957c6e3a45356ba433d7650468d1ed9a032e13835bbcd4b4442f`，OCI revision
  `2fbc3dc18a60be3fbaf7a07bb4fe46d15303bc56`；基于已验证 `agenthub:0.6.0-nas.12`，通过
  `deploy/compose/Dockerfile.nas-overlay` 仅覆盖 server/web dist。
- 构建时和运行时 `node-pty` 检查通过：`spawn=function`、`platform=linux`、`arch=arm64`。
- 容器：`cda2a499d7770e3db8aaa0f11e476a0b71b1ddb863d1c2cd1053ef75de339ee0`，最终
  `running/healthy`、`user=0:0`、`privileged=true`、`restart=unless-stopped`。
- `/api/v1/health` 返回 `status=ok`、`version=0.6.0`、`database=pglite`、`web=true`。
- 授权 `/api/v1/settings/capabilities` 返回 `terminal.available=true`、`code=READY`、
  `platform=linux`、`arch=arm64`；`remoteNode.available=true`、`transport=outbound_websocket`。
- 真实 Terminal/WS smoke：Project `6d1ca2e6-f1a2-4250-a1ae-1e4e962272a0` 完成 API open、统一 `/ws`
  `terminal:c1b0f42f-8b6e-4094-99b8-410545308fea` 订阅、输入 marker `nas13-pty-ok`、收到 output、API close。
- Claude Code、Hermes、OpenClaw（`openclaw-official`、`openclaw-custom`）发布前后 name/ID/image 一致；本次仅更新 AgentHub service。

## 安全边界与回滚

- 只执行 `docker compose -p agenthub -f /volume2/DockerProject/agenthub/docker-compose.yml up -d --no-build agenthub`；没有执行 `docker compose down`。
- 没有删除镜像、卷、用户数据或其他 Agent 容器；`agenthub:0.6.0-nas.12` 保留作为回滚点。
- `.tmp-v05` 不存在，因此没有删除。
- 回滚：恢复备份目录中的 `.env`，使 `AGENTHUB_IMAGE=agenthub:0.6.0-nas.12`、`AGENTHUB_REVISION=123af329`，然后执行同一 Compose service 的 `up -d --no-build agenthub`；不执行 `compose down`。

## 未验证项

当前没有可用浏览器/Computer Use/TX5Pro 通道，因此 1440、1024、768、390 的人工视觉与人工可用性 checklist 仍为 `PENDING_BROWSER_CHANNEL`。Playwright、curl、Terminal API/WS smoke、静态构建和服务器健康均不替代该人工 gate。

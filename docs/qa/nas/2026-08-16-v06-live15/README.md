# AgentHub v0.6 PromptOS Binding UX 与 nas.15 发布验收

日期：2026-08-16

结果：`PASS / VISUAL_GATE_PENDING`

代码：`29d475cf723ed53eb21ec701a40287c7785bc253`

访问地址：`http://192.168.5.110:3210`

## 本次用户体验修复

- PromptOS Binding 列表不再显示内部版本 UUID 或英文 `priority`。
- 固定版本显示为“固定版本 vN”，标签显示为“标签：label”，缺失对象显示中文删除状态。
- 优先级显示为“优先级：N”，保留排序语义但不泄漏内部字段命名。
- App 回归 fixture 覆盖标签绑定、固定版本绑定、UUID 不出现和中文优先级。

## 自动化证据

- `corepack pnpm lint`：通过。
- `corepack pnpm typecheck`：通过。
- `corepack pnpm build`：通过；Web `1715 modules transformed`。
- `corepack pnpm exec vitest run --maxWorkers=1 --pool=forks --reporter=dot`：49 个测试文件通过、4 个按环境跳过；205 passed、9 skipped。
- `corepack pnpm test:e2e`：24/24 通过，覆盖 1440/1024/768/390 fixture、URL 恢复、键盘、无横向溢出与 axe；fixture `/ws` `ECONNREFUSED` 是无本地后端时的隔离噪声，不替代人工视觉验收。
- GitHub Actions run `31927521417`（commit `29d475c`）：`verify` 成功，lint、typecheck、test、build、Playwright E2E 全部通过。

## NAS 发布证据

- 目标：`DH4300Plus`、`aarch64`；Compose project `agenthub`；正式 Compose `/volume2/DockerProject/agenthub/docker-compose.yml`；端口 `192.168.5.110:3210`。
- 发布前备份：`/volume2/Project/.agenthub/central/deployments/20260816T045503Z-pre-nas15/`。
  Compose SHA-256 `0e3e92b7078a4a6cfde4fa8c5493539ffac0e238f1aa570ff689606a095f27ff`；旧 `.env` SHA-256 `dc4c6bba69133174d1da09ea7df9975c4344a4617df481513b6bb2dcd8c11ff3`；新 `.env` SHA-256 `adc70e2446d59af428e0e0d44c1aef75448297e98edfac17536f1c0f62efa541`；browser-token 仅保留 hash `d1e3d6d77a351bd669f975c32b414d8c9cd581e2e8fe87a11a4e0a64290db087`。
- 镜像：`agenthub:0.6.0-nas.15`，Linux ARM64，image ID `sha256:23213a07b30f6abbe84566f820657af8598b9ab0299aa2d8bf7f32f8f1610820`，OCI revision `29d475cf723ed53eb21ec701a40287c7785bc253`。
- 构建时 overlay `node-pty` 检查通过；运行时容器为 `running/healthy`、`user=0:0`、`privileged=true`、`restart=unless-stopped`，容器 ID `3b89e27d871bed8a911bd2390678986b5fc6639b57760620599548bf9706dedc`。
- `/api/v1/health` 返回 `status=ok`、`version=0.6.0`、`database=pglite`、`web=true`；根页面 HTTP 200。
- 授权 `/api/v1/settings/capabilities` 返回 `terminal.available=true`、`code=READY`、`platform=linux`、`arch=arm64`；`remoteNode.available=true`、`transport=outbound_websocket`。
- 运行镜像内包含 PromptOS 更新 bundle：`/opt/agenthub/apps/web/dist/assets/PromptOsPage-DAW91LK5.js` 含“固定版本 v…”文案。
- 真实 Terminal/WS smoke：Project `6d1ca2e6-f1a2-4250-a1ae-1e4e962272a0` 完成 API open、统一 `/ws` `terminal:baf32fe4-56b9-4a4b-a0cb-818112e7d95d` 订阅、输入 marker `nas15-pty-ok`、收到 output、API close。
- 受保护 Agent 容器发布前后 name/ID/image/status 未变：`claude-code`、`hermes`、`openclaw-official`、`openclaw-custom`；本次仅更新 `agenthub` service。

## 安全边界与回滚

- 只执行 `docker compose up -d --no-build agenthub`；没有执行 `docker compose down`。
- 没有删除镜像、卷、用户数据或其他 Agent 容器；`agenthub:0.6.0-nas.14` 保留作为回滚点。
- `.tmp-v05` 不存在，因此没有删除。
- 回滚：恢复备份目录中的 `.env`，使 `AGENTHUB_IMAGE=agenthub:0.6.0-nas.14`、`AGENTHUB_REVISION=37ebaa89f32326c254ac4a9b81977f551cf32716`，然后执行同一 Compose service 的 `up -d --no-build agenthub`；不执行 `compose down`。

## 未验证项

当前没有可用浏览器/Computer Use/TX5Pro 通道，因此 1440、1024、768、390 的人工视觉与人工可用性 checklist 仍为 `PENDING_BROWSER_CHANNEL`。Playwright、curl、Terminal API/WS smoke、静态构建和服务器健康均不替代该人工 gate。

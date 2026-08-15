# AgentHub v0.6 ARM64 native PTY 与 NAS nas.7 发布验收

日期：2026-08-15

结果：`PASS / VISUAL_GATE_PENDING`

代码：`a6f5c16`（`feat(workspace): 交付 Local Project Terminal`）

访问地址：`http://192.168.5.110:3210`

## 自动化证据

- `corepack pnpm lint`：通过。
- `corepack pnpm typecheck`：通过。
- `corepack pnpm test`：非沙箱环境通过 45 个文件，`184 passed / 9 skipped / 193 total`。
- `corepack pnpm build`：通过；Web `1715 modules transformed`。
- `corepack pnpm test:e2e`：24/24 通过，覆盖 1440/1024/768/390 fixture、URL 恢复、键盘与 axe；
  自动化结果不替代 TX5Pro 人工视觉验收。
- GitHub Actions run `31889417182`（commit `a6f5c16`）：`verify` job 成功。
- v0.6 既有真实 live gate（4 个文件、9 个测试）保持通过，覆盖真实 Codex、Remote Node、
  Worktree 与供应商能力差异。

## NAS 发布证据

- 目标：`DH4300Plus`、`aarch64`、Compose project `agenthub`；正式 Compose
  `/volume2/DockerProject/agenthub/docker-compose.yml`，端口 `192.168.5.110:3210`。
- 发布前备份：`/volume2/Project/.agenthub/central/deployments/20260815T144927Z-pre-nas7/`。
  Compose SHA-256 `0e3e92b7078a4a6cfde4fa8c5493539ffac0e238f1aa570ff689606a095f27ff`；
  `.env` SHA-256 `603ab5803ee99f7d675f6f4b8da58748db2e8f71702c6d03a82efa553f566e70`；
  browser-token 仅保留 hash `d1e3d6d77a351bd669f975c32b414d8c9cd581e2e8fe87a11a4e0a64290db087`。
- 镜像：`agenthub:0.6.0-nas.7`，Linux ARM64，image ID
  `sha256:df5e1c3a5e120e2604f8677cd4bd43a371c24d68b9135ccd82bee37cb3b4ecb9`，OCI revision `a6f5c16`。
  以已验证 `agenthub:0.6.0-nas.4` 为 base，通过 `Dockerfile.nas-native` 构建 `node-pty@1.1.0`
  native binding；旧镜像保留。
- 容器：`cc11ab51e1e31a7bdd4b30f31dcff89efa2d39ff8dd50550d2a563a7f7c2b528`，最终
  `running/healthy`、`user=0:0`、`privileged=true`、`restart=unless-stopped`；
  `AGENTHUB_PROJECT_OWNER_UID/GID=1000:10`。
- `/api/v1/health` 返回 `status=ok`、`version=0.6.0`、`database=pglite`、`web=true`；根页面 HTTP `200`。
- `/api/v1/settings/capabilities`（授权请求）返回 `terminal.available=true`、`code=READY`、
  `platform=linux`、`arch=arm64`。
- 真实 Terminal API smoke：Project `6d1ca2e6-f1a2-4250-a1ae-1e4e962272a0` 完成 open、
  input `printf live-pty-ok\\n`、close；Terminal ID `df9abc0e-642e-47eb-abca-eb3dae3618d0`。
- 容器内 `require('node-pty').spawn` 返回 `function`；独立 real spawn 输出 `node-pty-ok "pty-ok" 0`。
- `claude-code`、`hermes`、`openclaw-official` 保持原 stopped 状态，`openclaw-custom` 保持原
  running/healthy；未修改其他 Agent 容器。

## 安全边界与回滚

- 只执行了 `docker compose up -d --no-build agenthub`；没有执行 `docker compose down`。
- 没有删除镜像、卷、用户数据或其他 Compose project/Agent 容器；nas.4、nas.5、nas.6 与
  native test image 均保留。
- `.tmp-v05` 原本不存在，因此没有删除；本轮 native build context 在证据固化后清理。
- 回滚：恢复备份目录中的 Compose/`.env`，恢复旧 `AGENTHUB_IMAGE`/`AGENTHUB_REVISION`，
  再执行 `docker compose up -d --no-build agenthub`；不执行 `compose down`，不清理镜像或卷。

## 未验证项

当前没有可用浏览器/Computer Use/TX5Pro 通道，因此 1440、1024、768、390 的人工视觉与人工可用性
checklist 仍为 `PENDING_BROWSER_CHANNEL`。Playwright、curl、Terminal API smoke、静态构建和
服务器健康均不替代该人工 gate。

# AgentHub v0.6 FormDialog 焦点修复与 NAS nas.11 发布验收

日期：2026-08-16

结果：`PASS / VISUAL_GATE_PENDING`

代码：`3508d22`（`fix(ui): 完善 Dialog 焦点与关闭控件`）

访问地址：`http://192.168.5.110:3210`

## 本次用户体验切片

- 共享 `FormDialog` 打开时优先聚焦首个 `aria-invalid`/`:invalid` 控件；没有错误时聚焦首个可用表单控件。
- 关闭 Dialog 时恢复到打开它的触发按钮；触发按钮已经卸载时交回 Radix 默认行为。
- Radix Dialog 的关闭图标改为真实 `button`，避免普通用户和键盘/读屏用户遇到只有 SVG、没有可操作语义的关闭控件。
- 新增 `apps/web/src/components/FormDialog.test.tsx`，覆盖“首个错误控件聚焦”和“关闭后恢复触发按钮焦点”。

## 自动化证据

- `corepack pnpm lint`：通过。
- `corepack pnpm typecheck`：通过。
- `corepack pnpm build`：通过；Web `1715 modules transformed`；保留既有 chunk-size advisory。
- `corepack pnpm test`：非沙箱环境通过 48 个文件，`192 passed / 9 skipped / 201 total`。
- `corepack pnpm test:e2e`：24/24 通过，覆盖 1440/1024/768/390 fixture、URL 恢复、键盘、无横向溢出与 axe；
  fixture 的 `/ws` `ECONNREFUSED` 是没有本地后端时的预期隔离噪声，不替代人工视觉验收。
- GitHub Actions run `31897639717`（commit `3508d22`）：`verify` 成功，lint、typecheck、test、build、Playwright
  E2E 全部通过；Node.js 20 action deprecation 仅为 GitHub annotation。

## NAS 发布证据

- 目标：`DH4300Plus`、`aarch64`；Compose project `agenthub`；正式 Compose
  `/volume2/DockerProject/agenthub/docker-compose.yml`；端口 `192.168.5.110:3210`。
- 发布前备份：`/volume2/Project/.agenthub/central/deployments/20260815T171733Z-pre-nas11/`。
  Compose SHA-256 `0e3e92b7078a4a6cfde4fa8c5493539ffac0e238f1aa570ff689606a095f27ff`；旧 `.env` SHA-256
  `2dac8995a2581a09e4ecaa01c9f2256c606c99138480c06f55c17cac8440f3ba`；发布后 `.env` SHA-256
  `3bb6d6f8d6bf7f8a0b44d096a7dc4b7e0da7b3e9b528f7da98d05c39ade00397`；browser-token 仅保留 hash
  `d1e3d6d77a351bd669f975c32b414d8c9cd581e2e8fe87a11a4e0a64290db087`。
- 镜像：`agenthub:0.6.0-nas.11`，Linux ARM64，image ID
  `sha256:013e01d5d93b1f32131795bedde4a7b46f02ba46b819747b379ab74969d664a1`，OCI revision
  `3508d2216939c7db19908118eb48e34f8b5a00d9`；基于已验证 `agenthub:0.6.0-nas.10`，通过
  `deploy/compose/Dockerfile.nas-overlay` 仅覆盖 server/web dist。
- 构建时 `node-pty` 检查通过；独立容器运行时 smoke 返回 `spawn=function`、`platform=linux`、`arch=arm64`。
- 容器：`0db954ef887a897203eb5a6d86a16bc16f8bd36e54c340461633fa102ac0cc7e`，最终
  `running/healthy`、`user=0:0`、`privileged=true`、`restart=unless-stopped`；
  `AGENTHUB_PROJECT_OWNER_UID/GID=1000:10`。
- `/api/v1/health` 返回 `status=ok`、`version=0.6.0`、`database=pglite`、`web=true`。
- 授权 `/api/v1/settings/capabilities` 返回 `terminal.available=true`、`code=READY`、
  `platform=linux`、`arch=arm64`；`remoteNode.available=true`、`transport=outbound_websocket`。
- 真实 Terminal/WS smoke：Project `6d1ca2e6-f1a2-4250-a1ae-1e4e962272a0` 完成 API open、统一 `/ws`
  `terminal:<id>` 订阅、input `printf pty-nas11-ok\\n`、收到输出、API close；Terminal ID
  `992ef01b-99e0-44be-b16c-e7bb36b6ae9e`，输出包含 `pty-nas11-ok`。
- 以完整 container ID 和名称对比发布前后，除 `agenthub` 外其他容器均未变化；运行时长文字变化不视为
  容器状态变更。`claude-code`、`hermes`、`openclaw-official` 继续保持 stopped，`openclaw-custom` 继续运行。

## 安全边界与回滚

- 只执行 `docker compose -p agenthub -f /volume2/DockerProject/agenthub/docker-compose.yml up -d --no-build agenthub`；
  没有执行 `docker compose down`。
- 没有删除镜像、卷、用户数据或其他 Agent 容器；`agenthub:0.6.0-nas.10` 保留作为回滚点。
- `.tmp-v05` 不存在，因此没有删除。
- 回滚：恢复备份目录中的 `.env`，使 `AGENTHUB_IMAGE=agenthub:0.6.0-nas.10`、
  `AGENTHUB_REVISION=ea51790`，然后执行：

  ```bash
  sudo -n docker compose -p agenthub -f /volume2/DockerProject/agenthub/docker-compose.yml up -d --no-build agenthub
  ```

  不执行 `compose down`，不清理镜像、卷或数据。

## 未验证项

当前没有可用浏览器/Computer Use/TX5Pro 通道，因此 1440、1024、768、390 的人工视觉与人工可用性
checklist 仍为 `PENDING_BROWSER_CHANNEL`。Playwright、curl、Terminal API/WS smoke、静态构建和服务器
健康均不替代该人工 gate。

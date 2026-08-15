# AgentHub v0.6 共享表单修复与 NAS nas.8 发布验收

日期：2026-08-15

结果：`PASS / VISUAL_GATE_PENDING`

代码：`23205f3`（`fix(ui): 绑定共享表单的可访问语义`）

访问地址：`http://192.168.5.110:3210`

## 自动化证据

- `corepack pnpm lint`：通过。
- `corepack pnpm typecheck`：通过。
- `corepack pnpm test`：非沙箱环境通过 46 个文件，`188 passed / 9 skipped / 197 total`。
- `corepack pnpm build`：通过；Web `1715 modules transformed`；保留既有 chunk-size advisory。
- `corepack pnpm test:e2e`：24/24 通过，覆盖 1440/1024/768/390 fixture、URL 恢复、键盘、无横向溢出与 axe；
  自动化结果不替代 TX5Pro 人工视觉验收。
- 聚焦共享字段测试：`apps/web/src/components/FormFields.test.tsx`，4/4 通过。
- GitHub Actions run `31892637869`（commit `23205f3`）：`verify` job 成功；Node.js 20 action deprecation
  仅为 annotation。

## NAS 发布证据

- 目标：`DH4300Plus`、`aarch64`、Compose project `agenthub`；正式 Compose
  `/volume2/DockerProject/agenthub/docker-compose.yml`，端口 `192.168.5.110:3210`。
- nas.8 升级前备份：`/volume2/Project/.agenthub/central/deployments/20260815T153002Z-pre-nas8/`。
  Compose SHA-256 `0e3e92b7078a4a6cfde4fa8c5493539ffac0e238f1aa570ff689606a095f27ff`；旧 `.env` SHA-256
  `f092ed656024860ebf8ad24e26e002cf37fd63e74e7a2d7b15db3eef4519f803`；browser-token 仅保留 hash
  `d1e3d6d77a351bd669f975c32b414d8c9cd581e2e8fe87a11a4e0a64290db087`。
- 镜像：`agenthub:0.6.0-nas.8`，Linux ARM64，image ID
  `sha256:0da6c9e92d12fc0f1ccf39aef7837e7020543e32c68343362f30a9fab8f47174`，OCI revision `23205f3`；
  以已验证 `agenthub:0.6.0-nas.7` 为 base，通过 `deploy/compose/Dockerfile.nas-overlay` 仅覆盖
  server/web dist。容器内 node-pty binding 继承并再次通过构建检查。
- 容器：`9a8171965f9ac462ef71853ccd5820f578faeb21b7670eda841dd5fce799b169`，最终
  `running/healthy`、`user=0:0`、`privileged=true`、`restart=unless-stopped`；
  `AGENTHUB_PROJECT_OWNER_UID/GID=1000:10`。
- `/api/v1/health` 返回 `status=ok`、`version=0.6.0`、`database=pglite`、`web=true`。
- `/api/v1/settings/capabilities`（授权请求）返回 `terminal.available=true`、`code=READY`、
  `platform=linux`、`arch=arm64`。
- 真实 Terminal API smoke：Project `6d1ca2e6-f1a2-4250-a1ae-1e4e962272a0` 完成 open、
  input `printf live-nas8-pty-ok\\n`、close；Terminal ID `baa662e1-52a5-445e-ae9a-ee3e30e7f68f`。
- 独立容器 `node-pty` smoke 输出 `{"spawn":"function","out":"pty-nas8-ok"}`。
- 升级后 Agent 容器状态保持：`claude-code`、`hermes`、`openclaw-official` 为原 stopped，
  `openclaw-custom` 为原 running/healthy；其他 Compose project 未修改。

## 构建与安全边界

- 首次尝试 `Dockerfile.nas-native` 因 NAS 的 `127.0.0.1:7890` proxy refused 而无法下载 apt index，
  构建在 builder 阶段失败；没有修改运行中的容器，也没有伪造 READY。
- 随后使用已验证 nas.7 native base 的 `Dockerfile.nas-overlay`，只复制 `apps/server/dist` 与
  `apps/web/dist`，并在构建时重新检查 `require('node-pty').spawn`。
- 只执行了 `docker compose up -d --no-build agenthub`；没有执行 `docker compose down`。
- 没有删除镜像、卷、用户数据或其他 Compose project/Agent 容器；nas.7、nas.8 与 native test image
  均保留。
- `.tmp-v05` 原本不存在，因此没有删除；本轮 build context 为临时目录并在构建后清理。

## 回滚

恢复备份目录中的 `.env`/Compose，使 `AGENTHUB_IMAGE` 与 `AGENTHUB_REVISION` 回到 nas.7 值，再执行
`docker compose up -d --no-build agenthub`；不执行 `compose down`，不清理镜像、卷或数据。

## 未验证项

当前没有可用浏览器/Computer Use/TX5Pro 通道，因此 1440、1024、768、390 的人工视觉与人工可用性
checklist 仍为 `PENDING_BROWSER_CHANNEL`。Playwright、curl、Terminal API smoke、静态构建和服务器
健康均不替代该人工 gate。

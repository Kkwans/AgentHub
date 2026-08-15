# AgentHub v0.6 Discovery 操作反馈与 NAS nas.9 发布验收

日期：2026-08-15

结果：`PASS / VISUAL_GATE_PENDING`

代码：`06e4c2b`（`fix(web): 补齐发现操作失败反馈`）

访问地址：`http://192.168.5.110:3210`

## 自动化证据

- `corepack pnpm lint`：通过。
- `corepack pnpm typecheck`：通过。
- `corepack pnpm test`：非沙箱环境通过 47 个文件，`190 passed / 9 skipped / 199 total`。
- `corepack pnpm build`：通过；Web `1715 modules transformed`；保留既有 chunk-size advisory。
- `corepack pnpm test:e2e`：24/24 通过，覆盖 1440/1024/768/390 fixture、URL 恢复、键盘、无横向溢出与 axe；
  fixture 的 `/ws` `ECONNREFUSED` 是没有本地后端时的预期隔离噪声，不替代人工视觉验收。
- 聚焦回归：`Common.test.tsx`、`DiscoveryPages.test.tsx`、`v06-feature-boundary.test.ts` 共 7/7 通过。
- GitHub Actions run `31894522807`（commit `06e4c2b`）：`verify` 成功；Node.js 20 action deprecation
  仅为 annotation。

## 本次 UX 切片

- Discovery 的重新扫描、Runtime/Agent 接入、启动/停止、Project 预检和默认设置失败统一使用共享
  `InlineError`，带 `role="alert"` 与 `aria-live="assertive"`，保留当前页面/表单状态供用户处理。
- Agent discovery 与 Remote Node 列表通过 `labelAdapterKind` 展示协议名称，普通用户不再直接看到原始
  adapter enum。
- 未修改后端 API、Session/Run/Approval/Git/Terminal 状态机或 Docker 权限契约。

## NAS 发布证据

- 目标：`DH4300Plus`、`aarch64`、Compose project `agenthub`；正式 Compose
  `/volume2/DockerProject/agenthub/docker-compose.yml`，端口 `192.168.5.110:3210`。
- nas.9 升级前备份：`/volume2/Project/.agenthub/central/deployments/20260815T160630Z-pre-nas9/`。
  Compose SHA-256 `0e3e92b7078a4a6cfde4fa8c5493539ffac0e238f1aa570ff689606a095f27ff`；旧 `.env` SHA-256
  `d39bfd82c4235f28c748075630df5fc0fea29819e4ee87c6564319f5f2d5ce49`；browser-token 仅保留 hash
  `d1e3d6d77a351bd669f975c32b414d8c9cd581e2e8fe87a11a4e0a64290db087`。
- 镜像：`agenthub:0.6.0-nas.9`，Linux ARM64，image ID
  `sha256:4e95f0d4aa88faea791f0c4a146a9fbe0b6fab03750acad5bec062150c42f77b`，OCI revision `06e4c2b`；
  基于已验证 `agenthub:0.6.0-nas.8`，由 `deploy/compose/Dockerfile.nas-overlay` 仅覆盖 server/web dist。
- 容器：`db19526cecd4c70ea0c3db4cad80d599b5d35cf5a434dd56ce3122a90cc58b25`，最终
  `running/healthy`、`user=0:0`、`privileged=true`、`restart=unless-stopped`；
  `AGENTHUB_PROJECT_OWNER_UID/GID=1000:10`。
- `.env` 更新后 SHA-256：`2c2f6d19abcc470fe55e05d68c24fc62b8576302b856d51080f8c113292300f8`；Compose 文件未改动，
  SHA-256 仍为 `0e3e92b7078a4a6cfde4fa8c5493539ffac0e238f1aa570ff689606a095f27ff`。
- `/api/v1/health` 返回 `status=ok`、`version=0.6.0`、`database=pglite`、`web=true`。
- `/api/v1/settings/capabilities`（授权请求）返回 `terminal.available=true`、`code=READY`、
  `platform=linux`、`arch=arm64`。
- 真实 Terminal API smoke：Project `6d1ca2e6-f1a2-4250-a1ae-1e4e962272a0` 完成 open、
  input `printf live-nas9-pty-ok\\n`、close；Terminal ID `e1bf4564-8906-46b4-b68d-adf2821e5f8f`。
- 独立容器 `node-pty` smoke：`spawn=function`，输出包含 `pty-nas9-ok`。
- Agent 容器状态未改变：`claude-code`、`hermes`、`openclaw-official` 仍为原 stopped，
  `openclaw-custom` 仍为原 running/healthy；其他容器未被重启或修改。

## 构建与安全边界

- 只执行 `docker compose up -d --no-build agenthub`；没有执行 `docker compose down`。
- 没有删除镜像、卷、用户数据或其他 Compose project/Agent 容器；nas.8、nas.7 与测试镜像均保留。
- `.tmp-v05` 不存在，因此没有删除。
- `Dockerfile.nas-overlay` 构建时在 `/opt/agenthub/apps/server` 检查 `require('node-pty').spawn`；
  运行时独立 smoke 再次通过。

## 回滚

将备份目录中的 `.env` 恢复，使 `AGENTHUB_IMAGE=agenthub:0.6.0-nas.8`、
`AGENTHUB_REVISION=23205f3`，然后执行：

```bash
sudo -n docker compose -p agenthub -f /volume2/DockerProject/agenthub/docker-compose.yml up -d --no-build agenthub
```

不执行 `compose down`，不清理镜像、卷或数据。

## 未验证项

当前没有可用浏览器/Computer Use/TX5Pro 通道，因此 1440、1024、768、390 的人工视觉与人工可用性
checklist 仍为 `PENDING_BROWSER_CHANNEL`。Playwright、curl、Terminal API smoke、静态构建和服务器
健康均不替代该人工 gate。

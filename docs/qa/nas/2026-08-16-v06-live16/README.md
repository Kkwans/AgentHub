# AgentHub v0.6 Task/Worktree 中文文案与 nas.16 发布验收

日期：2026-08-16

结果：`PASS / VISUAL_GATE_PENDING`

代码：`51711f0ce3936ca8d8263481f0b026bb083fa29f`

访问地址：`http://192.168.5.110:3210`

## 本次用户体验修复

- Task 页面将 `Task Review`、`Review`、`base branch`、`task branch`、`worktree path` 和 `Review evidence`
  改为普通用户可读的中文文案：Task 审阅、审阅、基准分支、任务分支、Worktree 路径、审阅证据。
- Git 之前/之后和 Worktree 执行阶段保持专业名称，同时去掉英文内部字段解释。
- PromptOS Context 空状态将 `priority` 改为中文“优先级”。
- 新增 feature boundary contract，防止旧英文内部字段回归；同步更新 Playwright 断言。

## 自动化证据

- `corepack pnpm lint`：通过。
- `corepack pnpm typecheck`：通过。
- `corepack pnpm --filter @agenthub/web build`：通过；Web `1715 modules transformed`，仅有既有 chunk 体积警告。
- `corepack pnpm exec vitest run --maxWorkers=1 --pool=forks --reporter=dot`：49 个测试文件通过、4 个按环境跳过；206 passed、9 skipped。
- `corepack pnpm test:e2e`：24/24 通过，覆盖 1440/1024/768/390 fixture、URL 恢复、键盘、无横向溢出与 axe；fixture `/ws` `ECONNREFUSED` 是无本地后端时的隔离噪声，不替代人工视觉验收。
- GitHub Actions run `31929088781`（commit `51711f0`）：`verify` 成功，lint、typecheck、test、build、Playwright E2E 全部通过。

## NAS 发布证据

- 目标：`DH4300Plus`、`aarch64`；Compose project `agenthub`；正式 Compose `/volume2/DockerProject/agenthub/docker-compose.yml`；端口 `192.168.5.110:3210`。
- 发布前备份：`/volume2/Project/.agenthub/central/deployments/20260816T053418Z-pre-nas16/`。
  Compose SHA-256 `0e3e92b7078a4a6cfde4fa8c5493539ffac0e238f1aa570ff689606a095f27ff`；旧 `.env` SHA-256 `adc70e2446d59af428e0e0d44c1aef75448297e98edfac17536f1c0f62efa541`；新 `.env` SHA-256 `6170dd3950b5b91bd4303a97a2ba1eee1672bf644ece2e297ce1e35716d98111`；browser-token 仅保留 hash `d1e3d6d77a351bd669f975c32b414d8c9cd581e2e8fe87a11a4e0a64290db087`。
- 镜像：`agenthub:0.6.0-nas.16`，Linux ARM64，image ID `sha256:317073aeb5540969bbaefd08f5c1d3b5731e8c93cb7978534d0b9f2b17e5813d`，OCI revision `51711f0ce3936ca8d8263481f0b026bb083fa29f`，基于已验证 `agenthub:0.6.0-nas.15` overlay server/web dist。
- 运行时容器为 `running/healthy`、`user=0:0`、`privileged=true`、`restart=unless-stopped`，容器 ID `72140d39166a2e5b536766eafc648fe3d71d7ab880afbf34d9e80474a8331b29`。
- `/api/v1/health` 返回 `status=ok`、`version=0.6.0`、`database=pglite`、`web=true`；根页面 HTTP 200；运行 bundle `/opt/agenthub/apps/web/dist/assets/TasksPage-BmijXgbV.js` 含“审阅证据”文案。
- 授权 `/api/v1/settings/capabilities` 返回 `terminal.available=true`、`code=READY`、`platform=linux`、`arch=arm64`；`remoteNode.available=true`、`transport=outbound_websocket`。
- 真实 Terminal/WS smoke：Project `6d1ca2e6-f1a2-4250-a1ae-1e4e962272a0` 完成 API open、统一 `/ws` `terminal:4766d6e2-d36a-4a4a-9d0a-689f3e0a49de` 订阅、输入 marker `nas16-pty-ok`、收到 output、API close。
- 受保护 Agent 容器发布前后 name/ID/image/status 未变：`claude-code`、`hermes`、`openclaw-official`、`openclaw-custom`；本次仅更新 `agenthub` service。

## 安全边界与回滚

- 只执行 `docker compose up -d --no-build agenthub`；没有执行 `docker compose down`。
- 没有删除镜像、卷、用户数据或其他 Agent 容器；`agenthub:0.6.0-nas.15` 保留作为回滚点。
- `.tmp-v05` 不存在，因此没有删除。
- 回滚：恢复备份目录中的 `.env`，使 `AGENTHUB_IMAGE=agenthub:0.6.0-nas.15`、`AGENTHUB_REVISION=29d475cf723ed53eb21ec701a40287c7785bc253`，然后执行同一 Compose service 的 `up -d --no-build agenthub`；不执行 `compose down`。

## 未验证项

当前没有可用浏览器/Computer Use/TX5Pro 通道，因此 1440、1024、768、390 的人工视觉与人工可用性 checklist 仍为 `PENDING_BROWSER_CHANNEL`。Playwright、curl、Terminal API/WS smoke、静态构建和服务器健康均不替代该人工 gate。

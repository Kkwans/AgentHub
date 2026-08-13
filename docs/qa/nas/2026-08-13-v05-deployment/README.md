# AgentHub v0.5 Compose 发布验收

日期：2026-08-13
结果：`PASS`
部署目录：`/volume2/DockerProject/agenthub`
访问地址：`http://192.168.5.110:3210`

## 变更范围

- 使用已推送 commit `9ca6fb2` 的源码构建 `agenthub:0.5.0-nas.1`，OCI revision 为
  `9ca6fb2`；随后追加的 CI 稳定性修复 `483bd3a` 只影响测试 setup，不改变已构建的生产
  `dist`。
- 仅升级 Compose project `agenthub` 的 `agenthub` service；没有执行 `docker compose down`，
  没有删除镜像、卷、用户数据或其他 Agent 容器。
- 保留旧镜像 `agenthub:0.3.0-nas.6`，可用于回滚。

## 备份与回滚

升级前已停止单个 `agenthub` service 以保证 PGlite 文件一致性，并创建备份：

`/volume2/Project/.agenthub/central/deployments/20260813T040918Z-pre-v05/`

目录包含：

- 原始 `docker-compose.yml` 与 root-only `.env`；
- `central-data-worktrees.tar.gz`（正式 PGlite `data` 与 `worktrees`）；
- 升级前后容器状态、注册 Agent 容器状态和校验和。

恢复时先停止单个 `agenthub` service，将 Compose 与 `.env` 恢复为备份版本，再将旧镜像
`agenthub:0.3.0-nas.6` 作为 `AGENTHUB_IMAGE` 启动；数据库恢复只在确认当前数据不可用时执行，
不得覆盖未备份的新数据。

## 结果

- Compose 配置校验通过，正式容器为 root/privileged、`restart=unless-stopped`，发布
  `192.168.5.110:3210`。
- 容器新 ID：`c06c6eb1df7a`；状态 `running/healthy`；健康接口返回
  `version=0.5.0`、`database=pglite`、`web=true`。
- 启动日志完成 recovery，未出现 `error` 或 `fatal`；既有 `claude-code`、`hermes`、
  `hermes-dashboard`、`openclaw-official`、`openclaw-custom` 的 container ID、镜像和
  stopped 状态前后无变化。
- 旧 Compose、`.env`、data/worktrees 备份 SHA-256 见 `report.json`；正式 Compose 与仓库
  `deploy/compose/docker-compose.yml` 完全一致。

## 发布门禁

- `pnpm format:check`、`pnpm lint`、`pnpm typecheck`：通过；
- 全仓 Vitest：37 个文件通过、3 个 live 文件跳过，165 passed、7 skipped；
- fixture Playwright：24/24 通过；real-backend Playwright：3/3 通过；live gate：7/7 通过；
- TX5Pro v0.5 闭环证据：31/31 通过，24 张截图，0 request failure、console/page error、
  HTTP 4xx/5xx 或外部请求，见 `docs/qa/tx5pro/2026-08-11-v05-closure/`；本次 Compose
  升级后的 NAS health 与容器状态已再次核验。
- GitHub Actions CI run `31666597711`：`success`，lint、typecheck、test、build 和 fixture
  Playwright 全部通过。Node.js 20 action deprecation 仅为 annotation，不影响结果。

# AgentHub v0.6.0 发布说明

日期：2026-08-14
状态：`NAS_DEPLOYED / AUTOMATED_AND_LIVE_PASS / VISUAL_GATE_PENDING`

## 发布内容

- 以普通用户旅程重构 Project、Runtime、Agent、Session、Task、PromptOS 和 Workspace。
- Project 使用 server-side PathPicker 与 candidate discovery；Agent 使用 Runtime/Agent discovery、adopt 和自动 preflight。
- 删除 `ControlPages.tsx`，建立 feature boundaries 与统一 Radix/Form/Dialog/Field/Picker/State 组件。
- PromptOS 支持中文 Kind/Type、结构化 Variables、immutable Version、Label、Binding 和 Context Preview。
- Docker discovery 保留 container ID pinning；路径、mount、symlink、Terminal env 和权限边界继续由后端强制执行。
- 健康接口和 workspace package metadata 统一返回 `0.6.0`。

## 证据

| 层级 | 结果 |
| --- | --- |
| Vitest | 44 个文件通过，3 个 live 文件跳过；182 passed、7 skipped |
| typecheck / lint / build | 通过；Web 1710 modules transformed |
| real live gate | 3 个文件、7 个测试通过，包含 Codex、Remote Node、Worktree Review/Merge 与 Docker Agent smoke |
| GitHub Actions | run `31773985580`，commit `c72ba6e`，lint/typecheck/test/build/Playwright E2E 全绿 |
| NAS Compose | `agenthub:0.6.0-nas.1`，ARM64，`running/healthy`，`192.168.5.110:3210` |
| 数据备份 | `/volume2/Project/.agenthub/central/deployments/20260814T054956Z-v06-data-backup/central-data-worktrees.tar.gz`，SHA-256 `672fef18fdf6b3920780d5e3d32cd82495f84d656cd8e92d35647c283f2b9755` |

完整 NAS 记录见 [`docs/qa/nas/2026-08-14-v06-deployment/README.md`](qa/nas/2026-08-14-v06-deployment/README.md)。

## 升级与回滚

- 正式 Compose：`/volume2/DockerProject/agenthub/docker-compose.yml`。
- 发布前 Compose/.env/token 备份：`/volume2/Project/.agenthub/central/deployments/20260814T045513Z-pre-v06/`。
- 数据/worktrees 备份：`/volume2/Project/.agenthub/central/deployments/20260814T054956Z-v06-data-backup/`。
- v0.5 → v0.6 没有新增数据库 migration；健康、Project、Agent、Session、PromptOS 数据在重启后保持可用。
- 升级只重建 `agenthub` service，没有执行 `docker compose down`，没有删除镜像、卷、用户数据或其他 Agent 容器。
- 回滚保留旧 `agenthub:0.5.0-nas.1` image；先停止单个 `agenthub` service，再恢复备份 `.env`/Compose，使用 `up -d --no-build agenthub`，必要时才恢复 data/worktrees 归档。

## 未验证项与明确边界

- 当前环境没有可用浏览器/Computer Use 通道，因此 1440、1024、768、390 四视口人工视觉验收和人工可用性 checklist 尚未完成；不能声明 TX5Pro v0.6 视觉通过。
- Browser Terminal / PTY 在 v0.6 是 scoped defer；Settings 显示真实 Local Project Terminal capability，不提供假的可点击终端。
- Claude Code、Hermes、OpenClaw 的正式容器接入状态以 Agent discovery/preflight 的实时结果为准；本次 live gate 的真实 Codex 与隔离 Worktree 证据不代表所有供应商均 READY。

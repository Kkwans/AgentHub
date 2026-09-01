# AgentHub v1.0.0 发布说明

## What is AgentHub 1.0

AgentHub 1.0 是面向 AI Coding Agent 的生产级工作控制台，围绕
Project → Session → Work → Review 组织日常开发闭环。

## Highlights

- Production-grade Workspace：Session、Conversation、Composer、Terminal、Git/Diff 与 Inspector 保持连续工作上下文；
- Work-first Home 与 Projects：先显示可执行工作和真实实体，再逐步展开诊断信息；
- PromptOS asset workspace：Prompt、immutable Version、Label、Binding、Variables 与 Playground 使用中文用户语义；
- Sectioned Settings、Agent/Infrastructure 页面和统一 AgentHub Design System；
- Workspace/PromptOS 查询与视图职责拆分，长会话和长对话历史按阈值窗口化；
- Release Truth Gate 统一 package、应用徽标、README、Docker 元数据和发布证据。

## Upgrade

1. 发布前记录当前运行 image、Compose、`.env`、PGlite/Postgres data、worktrees、health 和 Agent 容器状态；
2. 保留命名的 v1.0 回滚 image/config 及数据库备份；
3. 只更新 `agenthub` service，使用固定 `agenthub:1.0.0-nas.<revision>` tag，不执行 `compose down`；
4. 部署后核验 health、账号登录、Project/Git、Agent preflight、Workspace、Terminal capability 和 WebSocket；
5. 失败时只停止并恢复 `agenthub` service 的已记录 image/config，不删除容器、镜像、卷或用户数据。

## Data / Compatibility

v1.0 以现有 schema 为兼容基线，不新增必须的数据迁移。发布前仍需在副本上执行 clean install、
升级自 v0.9 数据的备份/恢复演练，并验证 migration idempotency。UI 失败不要求回滚业务数据。

## Security

保留显式 Project/Runtime/Agent allow-list、路径 containment 与 symlink 防护、HttpOnly Cookie、
Remote Node outbound secure WebSocket 和 Terminal capability gate。Compose 的 root/privileged 与
Docker socket 边界不扩大，Agent 原生凭据不复制到 AgentHub。

## Known limitations

- Remote Node 的未开放能力继续按后端 capability 显示，不以本机能力代替远端执行；
- 真实 NAS 视觉、几何、a11y、性能和 Agent live acceptance 只有在对应证据写入
  `docs/qa/visual/v1.0.0/manifest.json` 后才视为 RC 完成；
- 当前发布目标为 ARM64 NAS，其他架构仍需独立构建和运行验证。

## Validation evidence

代码级验证已覆盖 `pnpm lint`、`pnpm typecheck`、聚焦 Vitest、Web production build、
`git diff --check` 与 Release Truth Gate。完整 E2E、真实 NAS 矩阵、geometry、axe、性能、
备份/升级和部署结果由本文件的 RC 记录和
[`docs/qa/visual/v1.0.0/manifest.json`](qa/visual/v1.0.0/manifest.json) 更新。

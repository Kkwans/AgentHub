# AgentHub v0.5.0

发布日期：2026-08-13

## 重点

v0.5.0 将普通用户旅程收口为：管理员登录 → Project → Agent/preflight → Session/Run →
Approval → Files/Diff/Git → PromptOS → Task Review。页面操作、状态、错误和空状态使用简体中文，
Agent、PromptOS、Git、Terminal、模型、模式、路径和供应商数据保留专业原文。

本版本还完成了响应式 Workspace、移动检查器、URL 状态恢复、可发现的 PromptOS/Skill Binding、
Task Review/Rework、Approval exactly-once、长事件补流和 Compose 发布准备。

## 验证

- `pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm build`：通过；
- 全仓 Vitest：165 passed、7 skipped；fixture Playwright：24/24；real-backend Playwright：3/3；
  live gate：7/7；
- TX5Pro Chrome 150：31/31 通过，24 张截图，0 request failure、console/page error、HTTP 4xx/5xx
  或外部请求；证据见 [`docs/qa/tx5pro/2026-08-11-v05-closure/`](qa/tx5pro/2026-08-11-v05-closure/)。
- GitHub Actions run [`31666597711`](https://github.com/Kkwans/AgentHub/actions/runs/31666597711)：
  成功完成 lint、typecheck、test、build 和 fixture Playwright。

## 部署

正式 NAS 使用 Docker Compose：

- 地址：`http://192.168.5.110:3210`；
- 镜像：`agenthub:0.5.0-nas.1`；
- 容器：root/privileged、`restart=unless-stopped`；
- 数据库：PGlite，数据目录保持原路径；
- 升级只对 `agenthub` service 执行 `up -d`，没有执行 `compose down`，没有删除旧镜像、卷、
  用户数据或 Claude Code/Hermes/OpenClaw 容器。

部署报告与回滚备份见 [`docs/qa/nas/2026-08-13-v05-deployment/`](qa/nas/2026-08-13-v05-deployment/)。

## Git

- 发布实现：`9ca6fb2`；
- CI 稳定性修复：`483bd3a`；
- 已推送至公开仓库 [`Kkwans/AgentHub`](https://github.com/Kkwans/AgentHub)。

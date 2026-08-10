# Changelog

## 0.2.0 - 2026-08-10

- Worktree Task Runner：每 Project FIFO、managed worktree、真实 Agent Run、Review/Rework/Cancel 与显式 `--no-ff` merge gate；
- Remote Node：一次性注册码、Ed25519 设备身份、outbound secure WebSocket、heartbeat/reconnect 与 revoke；
- 远程 Project preflight、只读文件、Agent inventory/preflight，以及 Session/Run/Approval/cancel/close 闭环；
- 中文 Remote Node 管理页、诊断、连接指引与 1440/1024/768/390 响应式覆盖；
- 临时远程 fixture 上的真实 Codex live 闭环与 TX5Pro Chrome 26 项实机验收；
- migration `0001_tidy_kinsey_walden.sql` 与 `0002_certain_squadron_supreme.sql`。

Remote Git、Remote Worktree、远程 Terminal、远程 Docker 管理、离线命令重放和透明 Session resume 不属于 v0.2。升级、限制与回滚见 [v0.2.0 发布说明](docs/RELEASE-v0.2.0.md)。

## 0.1.0 - 2026-08-09

首个 AgentHub MVP：

- host-native Project、Agent、Session、Run、Approval、Git 与 PromptOS 控制平面；
- Codex、Claude Code、OpenCode、Hermes、OpenClaw 五类 Agent 的发现与真实 preflight；
- 既有 Docker Agent 容器的显式、安全接管；
- Goal/Task、人工审阅门禁、Dashboard 与中文 Coding Workspace；
- PGlite/PostgreSQL、统一 REST/WebSocket、token auth 与 production Web 入口；
- 确定性核心闭环、四视口 Playwright 和真实 Agent live smoke。

已知环境限制与回滚说明见 [v0.1.0 发布说明](docs/RELEASE-v0.1.0.md) 和 [部署文档](docs/DEPLOYMENT.md)。

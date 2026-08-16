# Changelog

## 0.6.0 - 2026-08-16

- 以普通用户旅程重构 Web：Project PathPicker、Runtime/Agent Discovery、预检与一键接入，不再要求普通流程手输绝对路径、container ID、hostname/os/arch、executable 或 adapter；
- 删除 `ControlPages.tsx` God Component，拆分 Projects、Agents、Sessions、Tasks、Settings、PromptOS 与 Workspace feature 边界；统一复用 Radix Themes、Radix primitives、Phosphor、Form/Dialog/Field/Select/Combobox/Picker/State 组件；
- PromptOS 支持中文 Kind/Type、自动生成 key、结构化 Variables、Version/Label/Binding/Dialog 与 Context Preview；Session/Task/Review/Diff/Git 的写操作统一使用 Dialog 和用户可读状态；
- 强化 Docker discovery 的 ID pinning、workspace allow-list、路径 containment/symlink 防护与 Terminal 环境变量白名单；Local Project Terminal 在 ARM64 native binding 可用时通过官方 `xterm.js` + `node-pty` 提供，不用普通 Shell 冒充 PTY；Docker/Remote Terminal 不在 v0.6 范围；
- 版本元数据统一为 `0.6.0`，真实 live gate 4 个文件/9 个测试通过；当前收尾全仓 Vitest 51 个文件（221 passed/9 skipped）与 Playwright E2E 24/24 通过；GitHub Actions 历史 release gate 保持全绿；
- 正式 NAS Compose 当前为 `agenthub:0.6.0-nas.35`（revision `cd4c606`），入口为 `192.168.5.110:3210`，容器 root/privileged、running/healthy；升级未执行 `compose down`，未删除镜像、卷、用户数据或其他 Agent 容器。
- UI CSS 共享层已收敛到 `styles/design-system.css`；按钮对比度修复后四视口 axe 与完整 24 项 Playwright E2E 全部通过。

已知边界：当前没有可用浏览器/Computer Use 通道，因此 1440/1024/768/390 人工视觉验收与人工可用性 checklist 保持未验证；请参阅 [`docs/RELEASE-v0.6.0.md`](docs/RELEASE-v0.6.0.md)。

## 0.3.0 - 2026-08-10

- 使用官方 Radix Themes 与 Phosphor 建立真实 UI 组件系统，统一中文 Web Shell 和核心控制页面；
- 重构 Dashboard、Task、Agent/Remote Node、Workspace、PromptOS 与设置，减少卡片墙和重复基础控件；
- 新增真实命令面板、标准 Dialog/AlertDialog/Tabs、键盘焦点、移动 drawer 和四视口响应式；
- TX5Pro Chrome 20 项 UI/UX 实机检查与真实 Codex Run/Task 闭环通过；
- 以 host-native systemd 常驻部署到 `127.0.0.1:3210`，正式注册 AgentHub 自身 Project；
- 不增加数据库 migration，不修改现有 Agent Docker/Compose、镜像或 volume。

升级、限制和回滚见 [v0.3.0 发布说明](docs/RELEASE-v0.3.0.md)。

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

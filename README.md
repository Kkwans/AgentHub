# AgentHub

AgentHub 是一个面向普通开发者的 AI Coding Agent 控制平面。v0.6 以“发现 Project → 发现 Agent → 创建 Session → 工作 → Diff/Git/审阅”为主线，统一管理 Project、Agent、Session、Run、Approval、Git、Terminal、PromptOS 与 Task，支持 Worktree Task Runner，并通过 outbound secure WebSocket 管理 Remote Node。当前 NAS 使用 privileged Docker Compose 部署；Web Shell 使用 Radix Themes 与 Phosphor 构建中文专业控制界面，既有 Docker Agent 容器仍只允许显式、安全接管。

## 当前版本

当前运行版本为 v0.6.0。代码、自动化、live smoke 与 NAS 发布证据见 [`docs/implementation/PROGRESS.md`](docs/implementation/PROGRESS.md) 和 [`docs/RELEASE-v0.6.0.md`](docs/RELEASE-v0.6.0.md)。四视口人工视觉验收需要可用浏览器通道，当前明确标记为未验证。

## 环境

- Node.js 24
- pnpm 11
- Linux（当前目标为 NAS ARM64）
- 默认开发监听：`127.0.0.1`
- 当前 NAS Compose 入口：`http://192.168.5.110:3210`（管理员账号登录）；当前镜像为
  `agenthub:0.6.0-nas.39`（revision `cbd3044`），容器当前 `running/healthy`；视觉人工验收仍需浏览器通道。

## 普通用户快速开始

从 [`docs/QUICK_START-v0.6.md`](docs/QUICK_START-v0.6.md) 开始。首次访问只需在页面创建管理员账号；后续通过用户名和密码登录，不需要复制 token、Session、命令或服务器绝对路径。

主流程是：在“项目”中选择已发现的 Project → 在“Agent”中扫描并接入 Agent → 创建 Session → 在 Workspace 中发送指令、处理 Approval、查看 Files/Diff/Git → 在“任务”中创建 Goal/Task 并完成 Review → 在 PromptOS 中维护 Prompt、Version 和 Binding。

## 开发命令

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

真实 Agent 测试受环境变量控制：

```bash
AGENTHUB_E2E_LIVE=1 pnpm test:live
```

本地开发：

```bash
pnpm dev
```

开发模式下 Server 默认监听 `127.0.0.1:3210`，Web 默认监听 `127.0.0.1:5173`。production build 后只需启动 Server，它会托管 `apps/web/dist`。

## 安全边界

- Docker 只允许操作显式注册且 container ID 仍匹配的目标。
- Agent 命令使用固定 executable/args，不提供通用 Docker Shell。
- 本机与 Remote Node 文件 API 均只读，并在执行端重复做路径 containment 与 symlink escape 防护。
- 非 loopback 监听必须启用认证；网页使用管理员账号与 HttpOnly Cookie，API token 只供外部集成。
- Agent 原生凭据归 Agent 所有，AgentHub 不复制凭据。
- Remote Node 使用一次性注册码与 Ed25519 设备身份，只主动连接中央 `/node/ws`；非 loopback 必须使用 `wss://`。

Local Project Terminal 已在能力为 `READY` 时通过官方 `xterm.js` + `node-pty` 提供；如果当前平台缺少 native binding、Project 未绑定或诊断失败，界面会显示中文原因并禁用打开，不用普通 Shell 冒充 PTY。Remote Node 不提供 SSH、任意 shell、远程 Terminal、远程 Docker 管理或 Remote Worktree merge。详细契约见 [`docs/implementation/V0.2_REMOTE_NODE.md`](docs/implementation/V0.2_REMOTE_NODE.md)。

详细说明见 [`docs/SECURITY.md`](docs/SECURITY.md)。

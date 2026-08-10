# AgentHub

AgentHub 是一个 host-native 的 AI Coding Agent 控制平面。v0.2 统一管理 Project、Agent、Session、Run、Approval、Git、Terminal、PromptOS 与 Task，支持 Worktree Task Runner，并通过 outbound secure WebSocket 管理 Remote Node。既有 Docker Agent 容器仍只允许显式、安全接管。

## 当前版本

当前版本为 v0.2.0。完成状态与已验证证据见 [`docs/implementation/PROGRESS.md`](docs/implementation/PROGRESS.md)，部署与回滚见 [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)，发布范围见 [`docs/RELEASE-v0.2.0.md`](docs/RELEASE-v0.2.0.md)。

## 环境

- Node.js 24
- pnpm 11
- Linux（当前目标为 NAS ARM64）
- 默认本地监听：`127.0.0.1`

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
- 非 loopback 监听必须启用 token auth。
- Agent 原生凭据归 Agent 所有，AgentHub 不复制凭据。
- Remote Node 使用一次性注册码与 Ed25519 设备身份，只主动连接中央 `/node/ws`；非 loopback 必须使用 `wss://`。

Remote Node 不提供 SSH、任意 shell、远程 Terminal、远程 Docker 管理或 Remote Worktree merge。详细契约见 [`docs/implementation/V0.2_REMOTE_NODE.md`](docs/implementation/V0.2_REMOTE_NODE.md)。

详细说明见 [`docs/SECURITY.md`](docs/SECURITY.md)。

# AgentHub

AgentHub 是一个 host-native 的本地 AI Coding Agent 控制平面。v0.1 统一管理 Project、Agent、Session、Run、Approval、Git、Terminal、PromptOS 与 Task，并通过显式注册安全接管既有 Docker Agent 容器。

## 当前阶段

项目正在按 [`docs/implementation/PLAN.md`](docs/implementation/PLAN.md) 实施 v0.1 MVP。完成状态与已验证证据见 [`docs/implementation/PROGRESS.md`](docs/implementation/PROGRESS.md)。

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
```

本地开发：

```bash
pnpm dev
```

Server 默认监听 `127.0.0.1:3210`，Web 默认监听 `127.0.0.1:5173`。

## 安全边界

- Docker 只允许操作显式注册且 container ID 仍匹配的目标。
- Agent 命令使用固定 executable/args，不提供通用 Docker Shell。
- 文件 API 在 v0.1 只读。
- 非 loopback 监听必须启用 token auth。
- Agent 原生凭据归 Agent 所有，AgentHub 不复制凭据。

详细说明见 [`docs/SECURITY.md`](docs/SECURITY.md)。

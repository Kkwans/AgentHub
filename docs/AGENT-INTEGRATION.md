# Agent 接入

## 统一核心

所有实现适配 `AgentRuntimeAdapter`、`AgentSessionHandle`、`AgentCapabilities` 与 `NormalizedAgentEvent`。ACP、OpenClaw 与 Docker 类型停留在 adapter/execution 边界。

## v0.1 Profile

| Agent       | 运行位置           | 主路径                            | 已知状态                                          |
| ----------- | ------------------ | --------------------------------- | ------------------------------------------------- |
| Codex       | 宿主机             | pinned `codex-acp`                | 宿主机 Codex 0.146.0 已登录；session smoke 待验收 |
| Claude Code | `claude-code` 容器 | pinned `claude-agent-acp`         | 已部署未实战验证；缺 adapter 时标记 `BROKEN`      |
| OpenCode    | 宿主机             | `opencode acp`                    | 未安装时 `MISSING`                                |
| Hermes      | `hermes` 容器      | `hermes acp`                      | 当前 Project 未映射，标记 `WORKSPACE_UNMAPPED`    |
| OpenClaw    | 既有 OpenClaw 容器 | `openclaw acp`，回退 `agent exec` | 既有部署已实战使用，ACP bridge 待逐项验收         |

## Preflight 状态

`READY`、`STOPPED`、`MISSING`、`BROKEN`、`AUTH_REQUIRED`、`WORKSPACE_UNMAPPED`、`CONTAINER_REPLACED` 与 `UNSUPPORTED`。UI 根据后端能力矩阵隐藏不支持的模型、模式、permission、terminal/MCP 等选项。

## 认证

Agent 原生认证归 Agent 自身所有。AgentHub 可调用只读状态或官方登录流程，但不得读取、复制或持久化原生凭据。

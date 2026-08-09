# Agent 接入

## 统一核心

所有实现适配 `AgentRuntimeAdapter`、`AgentSessionHandle`、`AgentCapabilities` 与 `NormalizedAgentEvent`。ACP、OpenClaw 与 Docker 类型停留在 adapter/execution 边界。

## v0.1 Profile

| Agent       | 运行位置           | 主路径                            | 已知状态                                          |
| ----------- | ------------------ | --------------------------------- | ------------------------------------------------- |
| Codex       | 宿主机             | pinned `codex-acp`                | `codex-acp@1.1.14` initialize/session smoke 已通过 |
| Claude Code | `claude-code` 容器 | pinned `claude-agent-acp`         | Claude CLI 可用但 adapter 缺失，当前 `BROKEN`      |
| OpenCode    | 宿主机             | `opencode acp`                    | 未安装时 `MISSING`                                |
| Hermes      | `hermes` 容器      | `hermes acp`                      | ACP 命令存在；当前 Project 为 `WORKSPACE_UNMAPPED` |
| OpenClaw    | 既有 OpenClaw 容器 | `openclaw acp`，回退 `agent exec` | ACP 需 scope approval；当前版本未确认回退命令      |

## Preflight 状态

`READY`、`STOPPED`、`MISSING`、`BROKEN`、`AUTH_REQUIRED`、`WORKSPACE_UNMAPPED`、`CONTAINER_REPLACED` 与 `UNSUPPORTED`。UI 根据后端能力矩阵隐藏不支持的模型、模式、permission、terminal/MCP 等选项。

## 认证

Agent 原生认证归 Agent 自身所有。AgentHub 可调用只读状态或官方登录流程，但不得读取、复制或持久化原生凭据。

OpenClaw Docker ACP 固定设置 `OPENCLAW_HIDE_BANNER=1` 与 `OPENCLAW_SUPPRESS_NOTES=1`，防止 banner/Doctor 文案污染 stdout NDJSON；这两个变量不含凭据。token/password 只能使用供应商配置、环境引用或文件引用，不进入 argv 和数据库原文。

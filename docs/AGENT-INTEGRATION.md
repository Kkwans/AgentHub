# Agent 接入

## 当前证据范围（2026-11-14）

现有五内置 Profile 是 Codex、Claude Code、OpenCode、Hermes、OpenClaw，另有 CUSTOM_ACP 通用入口。源码入口、协议握手、真实任务闭环、目标 NAS 验收是不同等级。下方机器名与状态属于历史部署记录，不代表当前开发分支或全部账户已通过。当前执行矩阵与待办见 [下一阶段计划](rebuild/NEXT_PRODUCT_PLAN.md)。

旧 live 测试存在单开关顺带操作固定容器、OpenCode缺失仍通过、取消仅断言随机ID等问题，不能用这些断言证明供应商可用或取消成功。正在整改为逐 Provider/suite 显式门禁、无默认凭据与权威事件证据；仅运行受控 fixture 回归，不运行真实账户。通用 HOST 非烟测探针也不等同内置 Docker/Remote 或真实 Session/审批/任务验收。

本机连接检查已在459ad0e发布到开发分支，本地全仓1907通过/12跳过；新八视口主题组合的真实浏览器CI尚待结果。这是控制面功能，不是五家真实 Provider 联调成功。

## 统一核心

所有实现适配 `AgentRuntimeAdapter`、`AgentSessionHandle`、`AgentCapabilities` 与 `NormalizedAgentEvent`。ACP、OpenClaw 与 Docker 类型停留在 adapter/execution 边界。

## 内置 Profile（历史部署快照，非当前验收）

| Agent       | 运行位置           | 主路径                            | 已知状态                                                  |
| ----------- | ------------------ | --------------------------------- | --------------------------------------------------------- |
| Codex       | 宿主机             | pinned `codex-acp`                | `codex-acp@1.1.14` preflight/session/stream/cancel 已通过 |
| Claude Code | `claude-code` 容器 | pinned `claude-agent-acp`         | Claude CLI 可用但 adapter 缺失，当前 `BROKEN`             |
| OpenCode    | 宿主机             | `opencode acp`                    | 未安装时 `MISSING`                                        |
| Hermes      | `hermes` 容器      | `hermes acp`                      | ACP 命令存在；当前 Project 为 `WORKSPACE_UNMAPPED`        |
| OpenClaw    | 既有 OpenClaw 容器 | `openclaw acp`，回退 `agent exec` | ACP 需 scope approval；当前版本未确认回退命令             |

## Preflight 状态

`READY`、`STOPPED`、`MISSING`、`BROKEN`、`AUTH_REQUIRED`、`WORKSPACE_UNMAPPED`、`CONTAINER_REPLACED` 与 `UNSUPPORTED`。UI 根据后端能力矩阵隐藏不支持的模型、模式、permission、terminal/MCP 等选项。

## 认证

Agent 原生认证归 Agent 自身所有。AgentHub 可调用只读状态或官方登录流程，但不得读取、复制或持久化原生凭据。

OpenClaw Docker ACP 固定设置 `OPENCLAW_HIDE_BANNER=1` 与 `OPENCLAW_SUPPRESS_NOTES=1`，防止 banner/Doctor 文案污染 stdout NDJSON；这两个变量不含凭据。token/password 只能使用供应商配置、环境引用或文件引用，不进入 argv 和数据库原文。

## Remote Node

Remote Node inventory 只上报 Agent 类型、固定 executable/args、版本与 capability，不上报 credential 或 provider environment。中央创建 Remote Agent 时只能选择该 inventory 中的 Profile；Node 在每次 preflight/Session 前重新校验 Project cwd 位于授权 root，并以 argv、`shell: false` 启动。

v0.2 已真实验证 Remote Codex 的 preflight、Session、stream、Task 人工审阅闭环。其他 Agent 的可用性以各 Node 当次 inventory/preflight 为准，不从中央宿主机状态推断。Remote Git、Remote Worktree、Remote Terminal、Remote Docker 与通用 command 不在本版本能力矩阵中。

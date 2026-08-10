# HTTP 与 WebSocket API

## REST

所有资源 API 使用 `/api/v1`。错误统一为：

```json
{
  "error": {
    "code": "STABLE_ENGLISH_CODE",
    "message": "面向用户的中文说明",
    "requestId": "...",
    "details": {}
  }
}
```

`code` 为稳定英文契约；原始供应商 payload 只在显式调试视图返回，并先脱敏。

v0.2 资源包括 Project、Agent、Execution Target、Remote Node、Session、Run、Approval、PromptOS、Goal、Task、Git、Auth、Settings，以及只读文件树/内容接口。

## Auth / Dashboard / Goal / Task

```text
GET        /api/v1/auth/status
GET/POST   /api/v1/auth/tokens
DELETE     /api/v1/auth/tokens/:id
GET        /api/v1/dashboard

GET/POST   /api/v1/goals
GET/PATCH  /api/v1/goals/:id
POST       /api/v1/goals/:id/transition
GET/POST   /api/v1/tasks
GET/PATCH  /api/v1/tasks/:id
POST       /api/v1/tasks/:id/transition
POST       /api/v1/tasks/:id/start
POST       /api/v1/tasks/:id/review
```

Task 由 Agent Run 完成时进入 `WAITING_REVIEW`；只有 `/review` 的 `APPROVE` 决策会进入 `DONE`。Dashboard 只聚合可操作状态、终态 Run 与 Git outcome。

## Worktree Task Runner

```text
GET  /api/v1/worktree-executions?projectId=&taskId=&status=
GET  /api/v1/worktree-executions/:id
GET  /api/v1/worktree-executions/:id/review
POST /api/v1/tasks/:taskId/worktree/queue
POST /api/v1/worktree-executions/:id/rework
POST /api/v1/worktree-executions/:id/merge
POST /api/v1/worktree-executions/:id/cancel
```

`queue` 仅接受 `READY` 的 Git Task 与已就绪 Agent。Run 完成只进入 `REVIEW`；`merge`
必须由用户显式调用。merge gate 会验证主工作区 clean/current branch、base ancestry、
worktree identity 与冲突预检。批准时可在隔离工作区执行受管 `git add -A`/commit，再以
`--no-ff` 合入 base branch；不会自动删除 worktree 或 task branch。

## Execution Target

```text
GET/POST /api/v1/execution-targets
POST     /api/v1/execution-targets/:id/preflight
POST     /api/v1/execution-targets/:id/start
POST     /api/v1/execution-targets/:id/stop
```

`stop` 在存在活动 Session/Run 时返回冲突；调用方需先取消并关闭相关 Run。

## Remote Node

```text
GET  /api/v1/remote-nodes
POST /api/v1/remote-nodes/registration-tokens
GET  /api/v1/remote-nodes/:id/diagnostics
POST /api/v1/remote-nodes/:id/revoke
```

创建注册码需要 `name`、`allowedRoots`，可选 `expiresInMinutes` 为 1..1440。响应中的明文 `token` 只出现一次；数据库、列表与诊断只保留 hash/指纹等安全摘要。成功注册会原子消费 token，并创建关联的 `REMOTE_NODE` Execution Target。revoke 会拒绝后续认证并关闭当前连接。

Node daemon 主动连接 `/node/ws`，协议版本为 `agenthub-node-v1`。中央只可发送固定 RPC：

```text
project.preflight
fs.list
fs.read
agent.preflight
agent.capabilities
session.create
session.run
session.approval
session.cancel
session.close
```

每条命令都有 UUID request ID、超时与 1 MiB 消息上限。Agent stream 使用独立 event 消息；断线会明确拒绝未决 RPC，不重放 prompt、approval 或 cancel。该协议不接受任意 executable、environment secret 或 shell command。

## Project / Files / Git

```text
GET/POST  /api/v1/projects
GET/PATCH /api/v1/projects/:id
POST      /api/v1/projects/:id/preflight
POST      /api/v1/projects/:id/archive
GET       /api/v1/projects/:id/files
GET       /api/v1/projects/:id/files/content

GET  /api/v1/projects/:id/git/status
GET  /api/v1/projects/:id/git/diff
GET  /api/v1/projects/:id/git/commits
GET  /api/v1/projects/:id/git/branches
POST /api/v1/projects/:id/git/commit
```

文件接口只读。通用 Git commit 必须显式选择 `STAGED` 或 `SELECTED`；只有上面的
Worktree merge gate 可在已验证的 managed worktree 执行受管 `git add -A`。服务不提供
destructive Git API。

## Terminal capability

```text
GET  /api/v1/settings/capabilities
POST /api/v1/terminals
POST /api/v1/terminals/:id/input
POST /api/v1/terminals/:id/resize
POST /api/v1/terminals/:id/close
```

只有 `node-pty` native binding 可加载时才允许创建 Terminal。平台不可用时返回 `PTY_NATIVE_BINDING_UNAVAILABLE`，不会使用普通 shell 进程模拟 PTY。

## WebSocket

所有浏览器实时数据使用 `/ws` 单连接，topic 为 Session、Project、Approval、Worktree、Remote Node、Terminal。
Worktree 控制面订阅 `worktrees`，Project 详情同时接收 `project:<id>`。Session 事件包含
单调 `seq`；客户端以 `afterSeq` 请求补流。Terminal 使用独立生命周期消息，不复用
Session 文本事件。

Remote Node 控制面订阅 `remote-nodes`。`/node/ws` 是 daemon 的设备认证/RPC 通道，不是浏览器 topic 连接，也不接受 API bearer token 替代设备签名。

token 模式下，非浏览器客户端使用 `Authorization: Bearer <token>`；浏览器客户端以 `agenthub-v1` 和 `agenthub-token.<token>` 两个 subprotocol 发起握手，服务只协商 `agenthub-v1`。

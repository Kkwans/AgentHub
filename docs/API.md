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
POST       /api/v1/auth/setup
POST       /api/v1/auth/login
POST       /api/v1/auth/logout
PUT        /api/v1/auth/account/password
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

`status`、`login` 和零账号时的 `setup` 可匿名访问。`setup` 只创建唯一的本机管理员；成功
setup/login 后 Server 设置 HttpOnly、SameSite=Strict Cookie。`logout` 撤销当前浏览器会话，
修改密码会撤销该账号全部旧会话。API token 路由需要管理员 Cookie 或有效 Bearer token，
只供 CLI 与外部集成。

Task 由 Agent Run 完成时进入 `WAITING_REVIEW`。`POST /tasks/:id/review` 使用以下判别请求：

```json
{ "decision": "APPROVE" }
```

或：

```json
{ "decision": "REWORK", "feedback": "按验收标准补齐失败场景测试" }
```

只有 `APPROVE` 进入 `DONE`。`REWORK` 必须提供非空反馈且 Task 必须仍有关联 Agent；Server
创建新的 Session 与 Run，在用户消息中保存反馈、原 Task 描述和 acceptance criteria，并让 Task
重新进入 `IN_PROGRESS`。响应统一返回 `{ task, session, run }`；批准时后两项为 `null`，返工时为
新建对象。Run 启动失败时 Task 进入 `BLOCKED`，保留新 Session 供诊断，不伪装成已经继续执行。
Dashboard 只聚合可操作状态、终态 Run 与 Git outcome。

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

## Session / Run / Approval

```text
GET/POST  /api/v1/sessions
GET        /api/v1/sessions/:id
POST       /api/v1/sessions/:id/resume
POST       /api/v1/sessions/:id/close
GET/POST   /api/v1/sessions/:id/runs
POST       /api/v1/sessions/:id/runs/:runId/cancel
GET        /api/v1/sessions/:id/messages
GET        /api/v1/sessions/:id/events?afterSeq=&limit=

GET        /api/v1/approvals?sessionId=
GET        /api/v1/approvals/:id
POST       /api/v1/approvals/:id/resolve
```

`resolve` 只接受 Agent 原始 option ID。用户决定、投递记录和审计事件原子写入；相同 option
可安全重复请求，不同 option 返回 `APPROVAL_DECISION_CONFLICT`。列表除 `PENDING` 外还返回
需要用户关注的 `QUEUED/DISPATCHING/UNKNOWN/DEAD` 投递状态。当前 adapter 没有跨重启的
幂等回执；`UNKNOWN/DEAD` 不会自动重发，前端必须引导用户恢复 Session 或重新开始 Run。

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

文件接口只读。通用 Git commit 必须显式选择 `STAGED` 或 `SELECTED`。普通 Workspace 使用：

```json
{
  "mode": "SELECTED",
  "paths": ["apps/web/src/App.tsx"],
  "message": "feat(workspace): 完成用户旅程"
}
```

`paths` 只接受 Project root 内的相对路径，并通过 containment 与 symlink escape 防护；
selected-files commit 不混入其他已暂存文件。只有上面的 Worktree merge gate 可在已验证的
managed worktree 执行受管 `git add -A`。服务不提供 destructive Git API。

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

非浏览器客户端可以使用 `Authorization: Bearer <token>`；浏览器 `/ws` 只请求 `agenthub-v1`，
Server 从同源 HttpOnly Cookie 认证。既有 API token 客户端仍可附带
`agenthub-token.<token>` subprotocol，服务只协商 `agenthub-v1`；该兼容路径不用于网页登录。

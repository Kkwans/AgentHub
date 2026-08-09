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

v0.1 资源包括 Project、Agent、Execution Target、Session、Run、Approval、PromptOS、Goal、Task、Git、Auth、Settings，以及只读文件树/内容接口。

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

## Execution Target

```text
GET/POST /api/v1/execution-targets
POST     /api/v1/execution-targets/:id/preflight
POST     /api/v1/execution-targets/:id/start
POST     /api/v1/execution-targets/:id/stop
```

`stop` 在存在活动 Session/Run 时返回冲突；调用方需先取消并关闭相关 Run。

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

文件接口只读。Git commit 必须显式选择 `STAGED` 或 `SELECTED`；服务不会执行 `git add -A`，也不提供 destructive Git API。

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

所有实时数据使用 `/ws` 单连接，topic 为 Session、Project、Approval、Terminal。Session 事件包含单调 `seq`；客户端以 `afterSeq` 请求补流。Terminal 使用独立生命周期消息，不复用 Session 文本事件。

token 模式下，非浏览器客户端使用 `Authorization: Bearer <token>`；浏览器客户端以 `agenthub-v1` 和 `agenthub-token.<token>` 两个 subprotocol 发起握手，服务只协商 `agenthub-v1`。

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

## Execution Target

```text
GET/POST /api/v1/execution-targets
POST     /api/v1/execution-targets/:id/preflight
POST     /api/v1/execution-targets/:id/start
POST     /api/v1/execution-targets/:id/stop
```

`stop` 在存在活动 Session/Run 时返回冲突；调用方需先取消并关闭相关 Run。

## WebSocket

所有实时数据使用 `/ws` 单连接，topic 为 Session、Project、Approval、Terminal。Session 事件包含单调 `seq`；客户端以 `afterSeq` 请求补流。Terminal 使用独立生命周期消息，不复用 Session 文本事件。

# Copy & Terminology

## 中文优先术语
- Project → 项目（代码/URL/API 保持 Project）
- Session → 会话
- Run → Run（技术用户可接受；正文解释为“执行”）
- Approval → 权限请求 / 审批
- Prompt → Prompt
- Binding → 绑定
- Runtime → 运行环境
- Remote Node → 远程节点

## 不要默认展示
transport、outbox、payload、container ID、realRootPath、sequence ID。

## Error copy 模板
`发生了什么` + `影响什么` + `现在能做什么`。

错误例：`TRANSPORT_FAILED`。
好例：`Agent 连接中断，本次 Run 未完成。可以重新连接后继续会话；已有消息和变更不会丢失。`

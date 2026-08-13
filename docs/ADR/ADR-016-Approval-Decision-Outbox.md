# ADR-016：Approval 决定与投递分离

状态：接受。日期：2026-08-11。

## 背景

旧实现先把 Approval 从 `PENDING` 改为 `APPROVED/REJECTED`，再同步调用 adapter。若 Agent
调用失败、超时、进程断开或服务在两步之间重启，数据库会显示“已决定”，但无法回答 Agent
是否收到。重复点击又可能把同一高权限操作发送两次。

ACP stdio 和当前 Remote Node 协议没有可跨进程重启查询的幂等回执。把这类含糊失败伪装成
成功或自动重试都会破坏安全边界。

## 决策

- 用户选择、`approval_delivery_outbox` 投递记录和 `approval.decision_recorded` 审计事件在
  同一数据库事务中写入。`approval_requests.selected_option_id` 保存稳定选择。
- 同一 Approval 只有一条 Outbox。相同 option 重复提交是幂等读取；不同 option 返回
  `APPROVAL_DECISION_CONFLICT`，不得覆盖第一次决定。
- 投递采用 CAS：`QUEUED/RETRY_WAIT → DISPATCHING → DELIVERED`。当前 adapter 的
  `idempotency_scope=NONE`，调用错误或超时记为 `UNKNOWN`，发送前已确定无法继续记为 `DEAD`。
- `UNKNOWN/DEAD` 永不自动重发。Run 与 Session 收敛为 `DISCONNECTED`，前端用中文解释风险并
  引导用户恢复 Session 或重新开始 Run。
- 服务重启时，尚未开始发送的记录转为 `DEAD`，发送中的记录转为 `UNKNOWN`。恢复流程不猜测
  Agent 端状态。
- 投递结果继续写入单调 Session event stream，并发布到统一 Session、Project 和 Approval topic。

## 保证边界

- 保证：用户决定 exactly-once、冲突检测、持久审计、单次进程内 CAS 投递、重启后不盲重投。
- 不保证：缺少供应商幂等 key/receipt 时的跨崩溃 exactly-once delivery。
- 未来 adapter 提供稳定幂等 key 和可查询 receipt 后，才允许把 `idempotency_scope` 提升为
  `RUNTIME/DURABLE` 并设计受控重试；不能仅靠增加重试次数改变语义。

## 迁移与回滚

- migration `0004_freezing_speed.sql` 只新增 nullable `selected_option_id` 和 Outbox 表；旧已决记录
  从 `response_json.optionId` 尽力回填，不生成历史投递。
- 部署前冷备份 PGlite/PostgreSQL。应用回滚到旧镜像时新增表和列可以保留；旧代码不会读取它们。
- 迁移 down 仅在确认没有 v0.5 决定记录需要保留后手工执行；默认采用向前修复，不删除审计数据。

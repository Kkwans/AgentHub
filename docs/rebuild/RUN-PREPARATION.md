# Run 准备与派发故障合同

## 状态分类

| 阶段 | 可证明事实 | 处理 |
| --- | --- | --- |
| Run 创建前失败 | 尚无本次持久 Run | 保留既有校验错误，不制造派发结果 |
| Run 创建后、调用 sendTurn 前失败 | 本次未向 Agent 发指令 | CAS 标记 FAILED/RECOVERY_REQUIRED，通知 Task/Worktree，再恢复 Session；所有清理成功后才改 PREPARATION_FAILED |
| 清理任一步失败 | 本次未发送，但关联状态未全部收敛 | typed RECOVERY_REQUIRED；进程内隔离并查询持久活动 Run/恢复标记，阻止该 Session 新 Run |
| 调用 sendTurn 后拒绝或保存 ack 失败 | 不能证明没有执行 | typed DISPATCH_UNKNOWN；不改写权威终态、不自动重放、不盲目 READY/BLOCKED |
| 成功返回 Run 后 Worktree 绑定写失败 | Run 已获准派发，执行关联未确认 | 同 UNKNOWN；保持执行占位，取消时独立核对持久 latestRunId |

错误消息与 details 仅包含固定说明、阶段和 IDs，不带原始 SQL、Agent 错误或用户正文。

## Worktree 取消和归属

- 按 Execution→Task→Session 锁序核验活跃执行、Task 状态、Session、Agent 和最新 Run；不以旧 execution.runId 猜测当前轮。
- UNKNOWN 首次启动与返工均尽力关联已知新 Run；若写关联失败，取消入口仍独立读取持久归属。
- cancel 请求返回不是停止证明。保持队列占位直到权威终态回调；完成已先胜出时不回写取消，不启动并行下一项。
- 以上 PGlite 测试不等同 PostgreSQL 多连接锁竞争实测。

## 当前明确未覆盖的完整重启边界

原 startup recoverInterrupted 已处理 QUEUED，并非漏掉该状态。已落盘 RECOVERY_REQUIRED 标记可以被新实例识别；但如果第一笔清理 CAS 就失败，只剩活动 Run 和内存隔离，完整 startup 可能将活动 Run 改为 SERVER_RESTARTED，失去该恢复标记。普通 Task 的关联状态也未统一重启收敛。

第一切片新增真实调用 recoverInterrupted 的回归，明确记录此限制，不把仅新建 Service 对象当完整重启。第二切片需要持久、可区分“未发送”与“派发未知”的启动恢复合同；不得自动重放，也不得猜测外部 Agent 已停止。AH-015 保持开放。

## 验证

隔离专项 83 项通过，涵盖消息/Run/Session 写故障、清理二次故障、缺失观察者、sendTurn/ack 错误、先完成竞胜、初始与返工未知派发取消、关联保存故障、真实 startup 限制。集成完整 lint/types/build/unit/QA 结果以 EXECUTION.md 对应提交记录为准。

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

## 第一切片的完整重启边界（历史记录）

原 startup recoverInterrupted 已处理 QUEUED，并非漏掉该状态。已落盘 RECOVERY_REQUIRED 标记可以被新实例识别；但如果第一笔清理 CAS 就失败，只剩活动 Run 和内存隔离，完整 startup 可能将活动 Run 改为 SERVER_RESTARTED，失去该恢复标记。普通 Task 的关联状态也未统一重启收敛。

第一切片新增真实调用 recoverInterrupted 的回归，明确记录此限制，不把仅新建 Service 对象当完整重启。第二切片在下文实现持久、可区分“未发送”与“派发未知”的启动恢复合同；仍不得自动重放或猜测外部 Agent 已停止，恢复UI验收未完成。

## 验证

隔离专项 83 项通过，涵盖消息/Run/Session 写故障、清理二次故障、缺失观察者、sendTurn/ack 错误、先完成竞胜、初始与返工未知派发取消、关联保存故障、真实 startup 限制。集成完整 lint/types/build/unit/QA 结果以 EXECUTION.md 对应提交记录为准。

## 第二切片：持久派发证据与完整启动恢复

0008新增dispatchState，历史行默认LEGACY_UNKNOWN，不凭原状态或externalRunId推测是否派发。新Run原子插入PREPARING，sendTurn前必须成功持久化ATTEMPTED；提交后崩溃即使尚未来得及调用，也只能保守视为未知。

实际index在监听请求及恢复队列前串行执行Session/Run、Worktree、普通Task恢复，最后仅清除已核对的准备失败标记。恢复写入失败则启动失败，不在半恢复状态开放派发。

- PREPARING活动Run可证明未派发，失败后补齐当前关联Task结果；旧第一笔cleanup CAS失败不再只能依赖内存。
- ATTEMPTED/LEGACY_UNKNOWN活动Run转未知断连；Session恢复连接不解除新Run隔离，CLOSED后继续会话也不能绕过。
- 实时断连、取消拒绝、取消超时不再伪造执行已停止。无连接无法发取消返回409；保留Task进行中及Worktree占位，只有真实终态才能放行。
- 同Session权威终态通过当前activation/Run→Session校验后可结束DISCONNECTED，并记录ATTEMPTED证据；旧诊断码可保留，但不会因此永久阻止已确认结束的操作。
- 旧FAILED/CANCELED且LEGACY_UNKNOWN并带SERVER_RESTARTED、CANCEL_CONFIRMATION_TIMEOUT、AGENT_RUN_CANCEL_FAILED或AGENT_RUN_START_FAILED的记录仍可能是历史合成结果，仅隔离、不改写历史状态，也不把再次点击取消视为证明。此类历史异常暂需专门人工核对，没有自动清除入口。
- Worktree恢复及终态按Execution→Task→Session锁序核对项目、Agent、当前Session和latestRun。旧执行错绑只能隔离自身，不能覆盖新Task；中断MERGING保持BLOCKED并明确合并结果未确认，不根据早先Run完成恢复为可直接合并的REVIEW。
- 手动Task状态门禁与Run准入使用一致的未知判定；真实ATTEMPTED终态即使保留旧取消诊断码，仍可在生命周期收敛后继续正常操作。

隔离最终119专项通过；旧实现的磁盘关闭重开2例、取消未知2例全部红测，修复后通过。集成额外3条旧诊断码与手动门禁联动回归通过。完整集成与精确CI结果见执行台账。

范围仍是单实例启动与控制面持久状态，不是多服务器并发准入证明。恢复界面可能仍显示发送入口，但后端以SESSION_RUN_UNRESOLVED拒绝；尚未完成可用的全流程恢复UX、真实供应商重连或NAS部署验收。不得将历史终态显示本身当停止证明。

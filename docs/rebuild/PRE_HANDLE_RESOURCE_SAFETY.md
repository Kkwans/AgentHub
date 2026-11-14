# 未返回句柄的资源清理安全：下一切片

2026-11-14 07:00 UTC。状态：候选已实施并通过专项/独立CR，最终全仓1968/9skip通过，待发布。早期 Session handle.close 与消费者结束清理修复不能替代本片。

## 已确认风险

create/restore/open 或能力探测可能在返回 Session handle 前启动进程；失败后非严格 cleanup、摘要 fallback 和超时迟到拒绝可能掩盖未确认退出。服务若仅看 handle 是否存在，会误记 NOT_ACQUIRED、释放运行归属或移除仍使用中的临时目录。

## 最小实施范围

1. agent-core contracts 定义通用 ResourceCleanupUnconfirmedError 与判定函数。固定公开消息、内部 cause，不让领域服务依赖 ACP 类型或错误文本。
2. ACP create/restore 使用严格 open；initialize、new/load/resume、配置失败后的 cleanup 必须确认 cancel。退出未知抛通用错误，确认退出后保留原业务失败。
3. SessionService 在直接 adapter promise 拒绝边界登记 sticky 未知状态，早于业务异常包装/fallback。覆盖 Task 创建、普通创建、恢复、摘要 acquisition（含超时后的迟到拒绝）和 resolveReadOnlyMode 的能力探测。
4. shutdown 检查未知标记，新资源准入遇未知时拒绝。无 handle 不再直接推断未获取；Task 清理结果记 UNKNOWN，摘要未知保留目录。

## 回归与发布门槛

- 初始化失败加 cancel 失败；new/load/resume/配置失败加 cancel 失败。
- 已确认清理的普通业务失败不错误阻塞服务。
- Task 没有 handle 仍记录 UNKNOWN，重复 shutdown 始终拒绝健康释放。
- 摘要超时后迟到拒绝仍登记未知、目录保留。
- capability 错误被 fallback 消化后 shutdown 仍拒绝。
- 现有 activation 排序、任务终态和并发恢复不退化；独立 CR、冻结全仓 tests/lint/types/build 后开发分支发布并核对精确 CI。

远程错误传输协议、其他 adapter 与自动恢复策略不在此最小片内；各自另列缺口，不声称已覆盖。

## 2026-11-14 07:00 UTC 候选实施状态

上述最小方案已实施，另补必须兼容的 AgentService generic 判定：READY 后能力缓存失效触发再次获取、迟到拒绝时同样进入 sticky ledger，不保存 READY。摘要目录保留覆盖未返回 handle 和已返回 handle 关闭未知，按本次资源判断而不是拿无关全局标志推断。

9文件冻结；Session+core156/156、AgentService21/21、ACP42/42及类型/lint通过，独立CR无阻断；最终全仓1968/9skip、全仓lint/types/build通过，待发布。通用instanceof合同不跨JSON，Remote及OpenClaw composite/EXEC自身能力探测仍为明确边界，不声称所有adapter已强制strict。

# Node 断连清理与重新准入

2026-11-14 08:04 UTC。状态：六文件候选已冻结，46/46专项、类型/lint与最终独立CR通过；首轮最终全仓中止，发现Gateway未drain异步写后窄修；08:04:21重新冻结全量进行中，未发布。当前Remote错误传递/重复close候选不等于Node整体退出链已闭合。

## 已确认调用链

executor.disconnect先clear sessions再allSettled close，失败丢引用；client socket close只void调用disconnect，循环可在旧清理完成前重连。create等待adapter时无断线epoch校验，迟到handle可重新入map；事件出口改为新连接后，旧事件可能流向新连接。SIGTERM当前只stop客户端，run完成不能证明executor资源已清。

## 最小实施

- Executor维护明确connection epoch、accepting与缓存disconnectPromise。断连同步撤销资源准入/事件出口，跟踪已准入preflight/capability/create，迟到handle严格清理而非激活。
- 现有handle确认close后仅按identity删除；失败保留引用。统一期限drain，失败/超时sticky，不自动重试或重新准入。
- 新周期只能在上次disconnect明确成功后显式开启；setEventSink不得暗中解锁。
- Client所有socket出口归同一finally，await disconnect之后才重连或完成run；unknown返回固定错误并停止自动重连。stop/run等待清理，不再“停了UI就当进程停了”。
- Node agent.preflight当前未强制strict，资源命令drain不能用普通promise resolve冒充退出确认；同步补严格合同，并禁止明确未知进入普通失败/fallback。

## 验证

关闭拒绝/重复disconnect保留同一失败；create barrier断线后迟到handle被清理、不向新连接发事件；慢关闭不提前重连/结束run；正常关闭一次、成功后新epoch可用；挂起命令超时保持未知、迟到结果不恢复准入；旧epoch回调不清新handle。使用受控真实WebSocket与内存DB，不调用真实供应商。

已授权开发分支范围内实施后独立CR与冻结全仓；不部署，不删除用户容器/凭据，不声称Docker容器内进程已核验。

## 当前预审补充

同sessionId创建在await前同步预留，防止两次launch覆盖引用；stop在慢身份/库存读取后复核，旧socket迟到回调不复建heartbeat。明确generic未知不能只回错误后保持ONLINE，必须保留client未知状态、受控断连、严格drain且停止重连，发送响应失败也不能抹去未知。该epoch仅本进程连接周期，不是进程重启后的持久fencing。

最终冻结全仓于2026-11-14 08:11:51 UTC通过：199文件通过/6跳过，2055测试通过/9跳过，448.36秒exit0；08:04:45全仓lint/typecheck/build通过。准备开发分支发布，精确CI仍待新提交。

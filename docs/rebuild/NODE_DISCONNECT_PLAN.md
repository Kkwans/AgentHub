# Node 断连清理与重新准入

2026-11-14 07:22 UTC。状态：只读方案，未实施。当前Remote错误传递/重复close候选不等于Node整体退出链已闭合。

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

# Gateway 关闭时数据库写入的所有权

2026-11-14 08:03:33 UTC 三文件候选冻结，未发布。此问题是在Node断连最终全量验收中发现，不以专项成功掩盖未完成的全量。

## 证据

原Gateway socket.close触发markOffline却不等待；server.close只证明WebSocket transport关闭，不能证明异步数据库写已结束。Node更及时结束客户端连接使该边界更容易出现。07:44全量未完成，于07:58:07主动中止exit130。旧workflow隔离副本正文通过、clientRun和running.close返回后清理停滞；后来worker unexpected exit，全部成因没有确证。仅禁止离线写的A/B正常结束，作为定位线索，不作为验收。

## 修正

- 同步关闭准入，缓存一次close Promise；后续调用保留原失败，不能用空连接表伪称成功。
- 跟踪所有已准入message及close离线写；transport关闭后动态排空，统一5秒期限。失败/超时返回固定错误；RuntimeLifecycle因此保留健康数据库与运行独占权。
- register/authenticate/heartbeat与离线写串行，RPC result/event不等待该队列；旧离线写与迟到认证都检查替代连接身份，避免覆盖新ONLINE。
- 临时局限：单Gateway状态队列可能让一个慢DB操作延迟其它节点状态更新。不是每node隔离或跨进程fencing，后续优化必须保留同身份写入顺序。

## 验证

最终4文件28/28通过20.61秒，server类型/lint/diff通过，两轮独立CR修正迟到认证覆盖旧连接状态后无阻断。包含原始未mock远程workflow，以及真实WS/PGlite中延迟markOffline后继续调用原始DB写：close不得先完成，完成后状态确为OFFLINE。另覆盖失败/timeout sticky、late auth、替换连接顺序。

08:04:21启动合并冻结全仓，08:04:45全仓lint/typecheck/build通过；全量结果待补。没有真实供应商/容器调用，没有部署或main合并。

最终冻结全仓于2026-11-14 08:11:51 UTC通过：199文件通过/6跳过，2055测试通过/9跳过，448.36秒exit0；08:04:45全仓lint/typecheck/build通过。准备开发分支发布，精确CI仍待新提交。

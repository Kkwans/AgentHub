# Remote / EXEC 资源安全：窄切片合同

2026-11-14 07:10 UTC。状态：基于195fb51开始实施，未验证、未发布。不调用真实Provider或用户容器，不改部署。

## A. Remote 明确未知结果传递

现状：Node将 ResourceCleanupUnconfirmedError 降为普通REMOTE_NODE_COMMAND_FAILED，Gateway返回RemoteNodeRpcError，中央无法使用本进程显式合同登记未知资源。应仅对该明确类型发送固定白名单错误码，不序列化cause、原始诊断、路径或凭据。中央仅在既有已认证、匹配请求/资源命令的响应边界重建通用错误；普通业务失败仍按原合同处理。该合同需要Node和中央服务均运行兼容版本；不能把新中央服务对旧Node的普通失败推断为已确认清理。

覆盖当前实际agent.preflight、agent.capabilities、session.create命令；Remote当前明确不支持load/resume，不新增或冒称该能力，验证完整JSON往返、未知使Session/AgentService重复shutdown仍拒绝、普通失败不误阻塞。不能仅单测instanceof构造器，也不把RPC超时/断线无结果当已确认清理；该缺口继续单独声明。

## B. EXEC 迟到进程与重复关闭

现状：sendTurn等待launcher.launch时active未填充；close可能直接成功，迟到进程随后安装。首次close失败后closed标记可能使重复close假成功。

改进：跟踪pending launch，closed撤销新准入；迟到进程必须被同一关闭流程观察并清理，不能逃逸。close在同步重入前发布缓存promise；首次结果未知保持sticky拒绝，queue终止不等于进程停止。不得因为process kill就合成run.cancelled权威事件。

验证：launch barrier与close交错、cancel拒绝、重复/并发close、launch拒绝、正常完成与显式取消既有语义。不改composite capability/Docker probe，这些另列问题。

## 发布门槛

各片专项/类型/lint、交叉只读CR，冻结后全仓tests/lint/types/build。可分逻辑提交，但必须明确已验证树；push仅开发分支并核对精确CI。未覆盖供应商/跨主机断线不声称完成，未main/部署。

## 07:16 UTC CR 后必要扩展（实施中）

仅传递明确错误码仍留下已发送资源RPC无结果时被记NOT_ACQUIRED的旧缺口，因此当前Remote片扩大到3种资源命令的timeout、断线、pending后发送失败：统一为generic清理未知。发送前离线仍普通OFFLINE，非资源命令保留旧错误。同步send异常必须清timer及两处pending并拒绝原promise，不能留下孤儿拒绝；状态变化导致未发送也不能silent drop。迟到回复不解除sticky，不自动重投。代价是短暂网络故障也保守阻止中央健康释放，这是未知即fail-closed，不是证明远端已停止。

另外单独修Remote Session handle.close缓存同一个promise：重复/并发close不得把首次RPC失败翻成成功；否则consumer结束再close可能误清Session未确认账本。unsubscribe/end仅一次，失败和成功都验证RPC次数，仍不修改远程真实进程或自动重试。

## 07:19 UTC 冻结候选

Remote扩展20/20、EXEC17/17、RemoteHandle/executor8/8及Service账本专项、类型/lint和交叉只读CR通过；最终全仓2008/9skip及全仓lint/types/build通过，准备发布。Node session.close仅确认后按identity删除；Node disconnect整体清理策略另列ISSUES，不能由此推断重连后无未知资源。

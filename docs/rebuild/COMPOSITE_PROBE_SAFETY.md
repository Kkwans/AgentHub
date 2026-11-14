# Composite capability / Docker EXEC probe 安全补齐

2026-11-14 07:31 UTC。状态：四文件候选冻结，37/37专项、类型/lint与独立CR通过；最终全仓及发布未完成，未调用真实容器。

## OpenClaw capability

仅getCapabilities在mode未确定而确需probe时复制profile并强制preflightStrictCleanup。直接明确generic未知或ACP_PROCESS_CLEANUP_UNCONFIRMED转为通用未知并禁止EXEC fallback；不扫描cause或供应商文本。普通preflight默认合同不变，cached ACP/EXEC无额外进程。回归未知不得fallback、正常已确认失败仍可fallback、原profile不变、cached无额外启动。

## Docker EXEC probe

识别真正ResourceCleanupUnconfirmedError与ProcessSupervisorError(PROCESS_TERMINATION_TIMEOUT)，转换固定通用未知而非available:false，且不尝试第二种命令。timedOut/canceled/信号结束也保守未知；普通已完成但不支持的输出可走兼容探测。回归类型识别、第一probe未知后不执行第二probe、普通失败不误判、公开错误无原始输出。

准确边界：只阻止明确终止未知被降级为普通失败。尚未实现Docker容器内进程独立退出核验，Docker CLI退出不代表所有容器内子进程已停止。不得通过实际杀用户容器来替代受控回归。

最终冻结全仓于2026-11-14 08:11:51 UTC通过：199文件通过/6跳过，2055测试通过/9跳过，448.36秒exit0；08:04:45全仓lint/typecheck/build通过。准备开发分支发布，精确CI仍待新提交。

# Composite capability / Docker EXEC probe 安全补齐

2026-11-14 07:22 UTC。状态：只读方案，未实施。

## OpenClaw capability

仅getCapabilities在mode未确定而确需probe时复制profile并强制preflightStrictCleanup。直接明确generic未知或ACP_PROCESS_CLEANUP_UNCONFIRMED转为通用未知并禁止EXEC fallback；不扫描cause或供应商文本。普通preflight默认合同不变，cached ACP/EXEC无额外进程。回归未知不得fallback、正常已确认失败仍可fallback、原profile不变、cached无额外启动。

## Docker EXEC probe

识别真正ResourceCleanupUnconfirmedError与ProcessSupervisorError(PROCESS_TERMINATION_TIMEOUT)，转换固定通用未知而非available:false，且不尝试第二种命令。timedOut/canceled/信号结束也保守未知；普通已完成但不支持的输出可走兼容探测。回归类型识别、第一probe未知后不执行第二probe、普通失败不误判、公开错误无原始输出。

准确边界：只阻止明确终止未知被降级为普通失败。尚未实现Docker容器内进程独立退出核验，Docker CLI退出不代表所有容器内子进程已停止。不得通过实际杀用户容器来替代受控回归。

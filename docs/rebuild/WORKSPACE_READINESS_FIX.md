# 终态事件提前到达后的会话可用状态收敛

## 真实门禁失败

精确b8c9a8d CI43574060531的真实视觉任务失败：Workspace四宽/浅深8例仅3通过，5例在API Session READY及Run COMPLETED后，前端输入框仍disabled“会话正在准备中”，5秒内未恢复。未将该提交称为视觉验收通过，也未调大E2E等待阈值。

## 确定机制

SessionService先持久化/发布run.completed，再进行Git收尾并写Session READY，随后没有第二次通知。前端接到原事件立即GET可能读取旧RUNNING；Run查询每3秒刷新为COMPLETED，但Session详情没有轮询，导致无activeRun且Session缓存仍RUNNING，输入框永久锁定。API已READY不代表前端读取过该状态。

## 独立前端修正

仅在CREATED/STARTING/RUNNING/WAITING_APPROVAL过渡状态每3秒读取权威Session；READY/CLOSED/FAILED/DISCONNECTED/未知停止，401/403停止。绑定请求AbortSignal，离开会话/卸载取消旧读取。绝不由Run完成推断或直接写本地READY，不自动重跑任何Agent命令。

两文件08:38:53 UTC冻结，37/37专项、web类型/lint/diff通过，独立CR无阻断。回归覆盖无第二次推送仍收敛、权威GET前保持锁定、稳定/未知状态不轮询、不误解锁、路由/认证卸载取消。08:39:29→08:41:50最终完整web通过：89文件1073测试，141.05秒exit0；08:39:37类型及Vite构建通过。E2E原5秒断言不变；新精确CI截图仍待运行。

## 后端补强（不混入本次前端独立提交）

另有候选：真实Session状态提交后追加新seq的session.state_changed通知，并纳入写入drain；失败/无变化不假发READY，旧activation/latestRun保护保留。完整Session162专项已通过，尚待最终全仓，不因前端兜底就宣称该后端候选已发布。

## 同批修正遗漏的浏览器文案合同

8d5dac8精确verify中4个web-shell浏览器用例仍要求旧“思考了32秒/思考过程”文案，已更新为Agent实际提供思考内容的标签，并明确旧伪耗时不存在；保留全部键盘折展/内容断言。scoped lint/格式通过、list4例仅证明发现，尚未本地执行浏览器。07ad01d真实视觉亦4例复现相同输入框状态问题，不将其误报为新的资源清理故障。

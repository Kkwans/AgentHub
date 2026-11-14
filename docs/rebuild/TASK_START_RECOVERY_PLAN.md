# 已有任务启动恢复

状态：候选实施，尚未完成测试或浏览器验收。

## 范围

只改普通任务详情启动入口；不改后端执行器，不调用真实 Provider。现有创建恢复、Worktree、手工开始与审阅合同不变。

## 状态与证据

- registry 按授权身份、项目、原任务绑定，浏览器内存跨组件卸载保留；localStorage 仅持久 scope/project/task 键和 phase/stage，无凭据、Prompt、反馈或正文。刷新后 pending 恢复为待核对；confirmed 仅额外存原成功 Session ID，不锁取消/编辑；只有当前任务已绑定该 Session 且回到可启动状态才允许新的显式尝试。首次写入前必须存储并回读成功，否则零网络写入。
- pending 在任何写入前同步安装；准备 READY 与启动分别记录阶段。准备写入未知时绝不继续 start。
- unknown（网络、无法识别响应、授权变化）禁止再次写入。重新进入仍保留；仅 GET 原任务和启动记录。
- retryable 仅明确的调用前拒绝，用户显式再次启动；没有自动重试。
- confirmed 仅本次 start 的完整匹配 task/session/run 响应；读取历史不生成该状态。
- 查询得到当前绑定 Session 只提供当前会话入口，不把任意历史记录认作本次成功。READY、空记录、历史 FAILED_KNOWN 均不能解除未知锁。
- 路由/Agent/授权变化后不继续多步操作、不导航、不污染当前页面；授权 epoch 撤销旧执行权限，但同身份回归仍保留未知记录。

## 验收

双击单次请求；READY 响应丢失零 start；start 响应丢失跨卸载锁定；GET 核对无 POST；历史记录不证明本次成功；明确拒绝允许手动再试；晚响应与身份隔离；实际浏览器四宽双主题面板截图待独立门禁。

## 多标签页边界

每次写入准入重读持久 marker，并监听 storage 更新；删除存储不解除当前内存未知锁。localStorage 不是原子跨标签页锁，同时竞争仍依赖后端已有启动记录与准入保护，本片不声称跨标签页 exactly-once。

## 失败白名单的代码边界

- 泛化 VALIDATION_FAILED 不在安全重试白名单：errors.ts 也会将深层 ZodError 归一为该码，不能据此证明 route 调用前拒绝。
- TaskService.startAdmittedTask 在 createForTask 前检查 TASK_NOT_READY、项目状态、Prompt 解析；validateStartPrompt 将解析 4xx 明确转 TASK_PROMPT_RESOLUTION_FAILED，缺变量为 TASK_PROMPT_VARIABLES_MISSING。
- SessionService.createForTaskAdmitted 在 reserve 前检查项目与 AgentService.resolveRuntime；后者只读注册数据，AGENT_NOT_FOUND / AGENT_NOT_READY / AGENT_PROJECT_TARGET_MISMATCH 在创建外部会话之前。
- TASK_OPERATION_IN_PROGRESS 是已有任务准入拒绝。资源创建后的 TASK_START_* / 网络失败不在此白名单，保留 unknown。
- 仅 ApiError 的白名单 4xx 可重试，不匹配响应或普通 Error 不能凭消息文字解锁。

## 成功证据与核对展示分离

sessionId 只由本次完整 POST 响应确认并持久；observedSessionId 仅用于 GET 后当前关联会话链接，不持久为成功证据。check 不改变 confirmed 原归属，不把历史时间或任意尝试归因本次请求。
资格变化的单调 token 阻止准备阶段 ABA；已发出 start 后资格刷新不吞掉真实完整响应。路由/身份单调 token 与授权 epoch 独立阻止迟到自动导航和核对回写。

## 当前验证状态

2026-11-14 09:32:37 UTC：116/116（既有页面 102 例 + 新 hook 14 例）通过；web 类型检查、scoped lint 通过。随后强化旧文案消失断言，09:33:02 单独重跑该例通过（其余 101 例未在此单例命令执行）；格式和 diff 检查通过。真实 E2E、截图和全量尚未执行/完成，没有运行真实 Provider。

## 存储与核对恢复补充

已通过新增回归证明旧实现会将写前零网络的存储失败误转永久 unknown。候选修正以仅内存 storageReadFailed 记录读取阻断，不丢既有明确拒绝证据；坏读取期间零网络写。恢复必须先成功重读，外部 pending/unknown 优先保守锁定；本页真正 unknown 不能被外部 retryable 或删除存储解锁。核对按钮可重读保护记录，仍失败零 GET/零回写，恢复后仅 GET。
核对占位按 identity/generation token 隔离，A 挂起不妨碍 B 查询；旧 finally 不清新请求忙碌状态。

最终专项复冻：2026-11-14 09:42:04 UTC，123/123（既有页面 102 + hook 21）通过，最终产品 web 类型检查与 scoped lint 通过。这包括坏存储红→绿、外部 marker、核对恢复入口/独立 token、泛化 VALIDATION_FAILED 保持未知。09:36:21 的完整 web 1130 通过属于修正前基线，不计作此最终候选的完整 web 验证；修后完整 web 与浏览器等待主线程执行。

2026-11-14 09:46:03 UTC 最终展示写回修正：先接入 3 个回归，旧实现 3/3 失败，证明 reset / GET 成功 / GET 失败会把外部 pending 覆盖成 retryable；修后将这些出口统一为内存-only 展示更新，持久写仅用于真实写操作阶段和结果。126/126（页面 102 + hook 24）、web types 与 scoped lint 通过。09:45:17 完整 web 1137 通过也是此修正前基线，不计作修后最终验收。主线程将先独立 CR，再执行修后完整 web。

### 最终本地验证（2026-11-14 09:52 UTC）

独立CR确认全部展示回写出口收敛后，09:51:18新完整web94文件1140测试通过，09:52:21全仓lint/types/独立integration类型/串行build通过。原1130/1137通过对应旧冻结版本，不用来替代本轮。新真实任务恢复10例仅完成类型/list，实际浏览器与新图仍待精确提交CI；不合main、不部署。

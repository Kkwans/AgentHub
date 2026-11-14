# 启动恢复的运行实例归属方案

状态（2026-11-14 04:29 UTC）：问题已复现，单权威runtime候选已实现并在本地专项验证中，尚未提交发布；CR发现的provider在途drain仍在修复，真实PostgreSQL隔离CI待执行。当前没有安全的多活runtime或网络分区自动接管承诺。

## 1. 已证实问题与边界

2026-11-14 04:02:01.393–04:02:05.916 UTC，独立 memory PGlite、两个实际 TaskService/SessionService、完整 recoverRuntimeAfterRestart，以及受控 FakeAgentAdapter barrier：

| 场景 | A结果 | Attempt | Session | create/send/close |
| --- | --- | --- | --- | --- |
| 无B恢复对照 | 成功 | RUN_ADMITTED | RUNNING | 1/1/0 |
| A创建返回前暂停，B完整恢复，放行A | TASK_SESSION_CREATE_UNKNOWN | UNKNOWN | DISCONNECTED | 1/0/1 |

B始终没有创建Agent；失败场景没有Run。不是重复派发，而是活跃工作被另一启动流程误伤。TaskStartAttemptRepository单点复现已升级为真实服务生命周期复现，但仍不是独立PostgreSQL多连接、完整HTTP双进程或真实Agent测试。

`apps/server/src/index.ts` 在监听端口之前执行恢复，默认同端口不构成互斥：第二进程可以先改变数据库，再因端口占用退出。数据库实现确实支持DATABASE_URL/PostgreSQL，不能以PGlite单文件行为排除此问题。

## 2. 建议产品合同

当前版本采用**同一数据库只有一个活跃AgentHub服务拥有运行时**。多个浏览器/用户/Agent/任务仍受支持；不等于只能运行一个Agent。多个API服务共享同一DB的主动runtime不作为隐含能力。

| 方向 | 优点 | 必须解决的代价 | 当前选择 |
| --- | --- | --- | --- |
| 单权威runtime，全生命周期排他 | 覆盖所有startup恢复领域；与当前进程内adapter/session现实一致 | 失联撤销、正常/异常退出、PGlite与PG差异 | 优先设计与验收 |
| 多实例epoch与fencing | 可支持多活与实例定向恢复 | Task/Run/Session/Approval/Worktree及每个外部副作用边界联合改造、runtime路由 | 不做小修暗中引入 |
| 只锁startup临界区 | 改动少 | 第一实例仍活跃时第二实例拿到锁并恢复，问题仍存在 | 拒绝 |
| TTL自动释放/只检查端口/跳过UNKNOWN | 看似恢复快 | 时间或端口不证明旧运行已停，可能绕过安全隔离 | 拒绝 |

## 3. 排他生命周期设计要求

1. 创建服务、扫描运行状态、恢复、listen、resumeQueued之前获取数据库范围排他权。排他失败的第二实例不得改变运行状态，不得调用Agent/Git。
2. 排他权持续到停服完成，不在listen成功后释放。获取失败要有明确中文操作解释及可定位诊断，不能长时间无声等待。
3. PostgreSQL候选：专用连接持有数据库级advisory lock，不借用随请求归还的pool连接；SQL/锁键/连接关闭语义须以官方文档与真实双连接测试验证后实施。
4. PGlite候选：确认引擎本身目录排他是否覆盖实际启动路径；若不足，使用明确本地文件锁合同，不能用无归属的存在标记或随意删除lock文件代替。
5. 排他连接失联时先同步停止新准入，撤销未完成创建/派发生命周期，再停止HTTP/队列并关闭handles；清理错误不能让实例重新恢复为可服务状态。需要检查每个异步边界，不能仅监听一次error事件。
6. 必须保留已有UNKNOWN及持久操作资源claim。排他权丢失不能证明外部Agent已停止；新实例不得据此重放已有派发。
7. 不承诺网络分区下的安全自动接管。若旧Agent仍可写文件，数据库锁本身不是文件系统或远程Agent的fencing。相关能力必须另做外部副作用隔离合同。

## 4. 分阶段实施与验收

### A：合同与可重复证据（本次）

- 将受控完整服务复现保存为opt-in诊断脚本。
- `corepack pnpm build && node scripts/diagnostics/active-startup-recovery.mjs`。
- 只使用内存DB与新建临时目录；Agent为FakeAgentAdapter，禁止真实launch/Git。
- exit 2表示复现活跃实例干扰，不是测试环境错误；exit 0仅表示该受控场景未受影响，不证明全部多实例场景安全。
- 此脚本不加入普通全量门禁来把已知缺陷包装成绿色契约；修复验收需要升级为第二启动被拒绝且A正常完成的测试。

### B：排他接口与启动接线

- 先写双独立服务启动测试：A持有时B在恢复之前失败，DB运行行不变，B没有create/send/Git。
- 将ownership guard的获得/失效/释放接入统一生命周期，不只Task领域。
- 正常停服后B可启动；启动中间失败保证释放自身所有权，不释放他人所有权。
- PGlite持久目录、PostgreSQL两个独立连接分别验证；缺任何目标环境就明确保留未验证项，不以memory PGlite冒充。

### C：失联与崩溃边界

- 获得锁后、恢复中、listen前、运行中、shutdown中断连。
- create/ready/send的barrier分别卡住，再失去ownership，验证迟到回调不重新激活、不产生新派发。
- 重启不释放UNKNOWN；只允许原有明确未派发证据路径收敛。
- 回归Task启动/返工/工作区入队、普通Session发送、Approval、Git持久操作、队列恢复和本地/远程节点。

## 5. 交付边界

设计、诊断与问题记录可以独立提交。后端行为变更须完成冻结全量与独立CR后推送开发分支以触发真实数据库/浏览器CI；开发分支推送不是发布。实际数据库排他测试及精确CI未通过前不得发布或合并。不得宣称只读启动记录面板已修复本问题；不得修改main、部署或对用户现有Agent做故障试验。

诊断自校验：`node scripts/diagnostics/active-startup-recovery.mjs --probe-early-failure` 只在对照组FakeAdapter注入barrier前失败，预期exit1，不应误判成未干扰或已复现。等待barrier有保活超时且监听提前结束；全部清理都会尝试。04:12 UTC最终正常exit2/提前失败exit1，lint通过，无临时目录残留。


## 6. 候选实现记录（未完成发布验收）

- PostgreSQL：专用非pool连接获取稳定双integer advisory key；断连永久撤销，不重连自动夺锁。失败消息不暴露DSN。真实PostgreSQL服务验收单独加入CI，不能将mock结果称实际PG通过。
- PGlite：实测其本身允许同目录两个实例，故Linux本地文件系统使用canonical目录相邻持久flock inode；父进程持有FD，不unlink/TTL。目录/锁inode替换即撤销。非Linux或缺flock安全失败；不承诺网络文件系统语义。
- RuntimeLifecycle：所有停止回调先同步撤销再await；健康归属下任一清理不确认则保留DB/锁并永久停止接单。DB自身close失败也不能在finally提前释放健康归属。
- Session：停服后的create/resume/startRun拒绝，活动entries先全部同步detach，再关闭。未返回provider/关闭超时或失败必须有界drain并保持未确认，不得误称资源退出；该CR补强仍在进行。
- Terminal：入口及实际spawn前双检查，覆盖await期间停服。WebSocket授权await返回后再次检查关闭状态，迟到upgrade拒绝。
- 04:28:58七文件44专项通过；含实际PGlite服务A/B启动、失败清理、健康归属保留，另有Terminal独立3专项。最终冻结全量、真实PG与发布后CI仍待完成。所有故障试验仅临时目录/假adapter/隔离DB，不触碰用户Agent。

### 04:35 UTC 停服覆盖补强与剩余边界

- Session完整create/resume/startRun/continuation及Approval投递纳入排空；审批最后一个await之后、provider调用之前重验activation。Worktree merge登记完整流程，异步准备/claim/managed callback之后真正Git调用之前再次检查；已发生持久派发的未知状态不改为可重试。
- HTTP层不能以socket close代表业务结束。createApp边界的RuntimeOperations只追踪被调用服务所返回的Promise；保持同步返回、原始this与私有成员、错误语义，并在调用时检查准入。Auth实际async middleware（含认证使用时间写入）、health与eventSource单独覆盖。5s未排空即sticky失败，健康ownership保留；后台fire-and-forget仍依赖各服务自身shutdown，不能宣称全局外部副作用fencing。
- 04:32 Session143专项、04:34 Worktree59专项、04:34:57 HTTP操作5专项完成。04:35:11开始最终冻结全量；此前04:31中止的全量不计通过。最终结果和提交信息以EXECUTION.md后续记录为准。

诊断解释：原 `active-startup-recovery.mjs` 故意直接构造两个service并调用恢复，绕过新 `startServer` 归属门禁；其预期exit2仍是底层“不带所有权恢复会干扰活跃实例”的负面对照，不应改成假绿色。新行为验收使用实际 `startServer` 排他集成及真实PostgreSQLCI，不能声称所有直接调用恢复函数都具备跨进程归属保护。

优雅信号退出也属于验收路径：CLI只有清理确认成功才exit(0)，失败保留不可用进程与健康归属；引用计时器避免只有文件FD时Node自动退出。重复SIGINT/SIGTERM不将失败转成功。当前有helper单测与源码CR，不等于实际CLI子进程信号集成；SIGKILL/崩溃不在保锁保证内，不能据此推断外部Agent已停。

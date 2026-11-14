# Agent 禁用 / 启用：最小闭环方案

状态：**完整启停闭环已形成未发布候选，尚未整体验收**。10:29:35冻结DB/服务端/前端候选，10:30:09开始全仓验证。先前10:04未接线基础模块已经在本候选接入；下方设计保留合同，结果以本节和末尾流水为准。本方案不证明真实 Provider 已接入。

当前优先级：先修已有 Task start UNKNOWN 的前端保护缺口，再安排本方案。不能只发布一个开关，却遗漏后台新工作准入。

## 目标与非目标

禁用是阻止新的工作准入，不是终止进程、取消 Run、注销 Agent 或删除历史。启用仅恢复准入资格，保留各入口原有门禁：create/resume 仍要求 Agent READY、target/项目匹配；已有活动 handle 的新 Run 仅新增 enabled 检查，继续使用原 Session 状态、归属及资源门禁，不增加全局历史预检 READY 要求；preflight 可检查非 READY Agent，但拒绝 disabled。权限、runtime ownership 和资源未知门禁不变。

不修改现有 model/mode 默认值、能力、预检状态或历史记录。不新增删除、容器停止、凭据管理或真实 Provider 调用。不将本地单写者准入协调描述为分布式 fencing。

## 当前源码事实

| 文件 / 入口 | 当前行为与缺口 |
| --- | --- |
| `packages/db/src/schema.ts` agents | 已有 enabled boolean，默认 true；没有独立 enabledRevision |
| `packages/db/src/repositories.ts` AgentRepository | 通用 update 无 CAS；updatePreflight 独立更新健康状态和能力 |
| `apps/server/src/agents/agent-routes.ts` | PATCH /:id 仅默认配置；无启停端点 |
| `apps/server/src/agents/agent-service.ts` resolveRuntime | 已拒 disabled，但只在早期解析时读取一次，后续 await 可跨禁用 |
| 同文件 checkConnection / preflight | 新 connection-check 拒 disabled；legacy preflight 尚未核对 enabled |
| 同文件 getProfile | 是资料转换入口，未核对 enabled；本轮未发现生产调用方，不应因此禁止资料读取 |
| `apps/server/src/sessions/session-service.ts` | create、createForTask、Worktree 创建、resume、continuation 经 resolveRuntime；现有活动 Session 的 startRun 不重新核对 enabled |
| `apps/server/src/worktrees/worktree-task-service.ts` | 排队和恢复调度最终调用 Session 创建 / startRun，必须在实际执行时核对，不能仅入队检查 |
| `apps/web/src/features/agents/pages/AgentDetailPage.tsx` / AgentCenterPage.tsx | 已展示启停状态，无启停操作闭环 |

## 一、持久化与 HTTP 契约

- 新增 `enabledRevision` 非负整数，默认 0；迁移不改变 enabled、status、默认配置、能力及引用关系。
- 建议专用 `PATCH /agents/:id/availability`，严格 body `{ enabled: boolean, expectedRevision: integer }`；拒绝多余字段，版本输入上限防溢出。
- 仓库执行单条原子 CAS：WHERE id + enabledRevision，SET enabled + enabledRevision + 1，返回实际更新行。无匹配时区分 404 `AGENT_NOT_FOUND` 与 409 `AGENT_AVAILABILITY_CONFLICT`。
- 同值请求若版本匹配也按一次 CAS 处理并递增，不绕过版本归属；重复旧版本请求冲突，不认领成功。
- response 沿用标准 data envelope，返回 committed row；不得再读另一页面的新值冒充本次提交。
- 版本仅供启停；默认配置和 preflight 不能改写 enabled / enabledRevision。启用不自动预检、探测或启动进程。
- metadata 修改纳入现有 RuntimeOperations / shutdown drain，停止期间不能新写；不另造生命周期框架。

## 二、逐 Agent 新工作准入线性化

必须有统一、可测试的线性化点，而不是每个入口散落一次 enabled 读取。

建议 AgentService 内逐 Agent 的准入协调器：启停 CAS 与新工作资格核对在同一 Agent 的串行临界区完成。不得持有队列锁等待整个 Provider 运行或完整预检，避免一个慢启动阻塞同 Agent 管理及无关 Agent。

- 若禁用 CAS 先成功，之后的新准入必须失败，不能因先前缓存 READY 而放行。
- 若工作先取得准入，其后禁用允许该已准入操作收尾，包括迟到资源清理；禁用不取消它、不释放 UNKNOWN fence。
- UI 必须说明：**禁用后不再接受新的工作；已准入或运行中的工作不会被取消。** 不声称“所有进程已停止”。
- Task / Worktree 的排队不等于取得 Provider 准入；排队恢复及实际派发时必须重新核对。
- 同一已准入操作内部的 initialize / capability 查询应使用同一可识别准入上下文，避免把它的后续阶段误当成自动重试；不是允许任意复用旧许可。
- 现有身份、runtime stopping、activation、latestRun、任务持久 claim 和资源未知门禁保持原顺序与效力。准入协调不能跨过这些限制。
- 若未来要求“禁用返回后连先前已准入的启动也不得发生”，必须另做到实际 spawn/RPC 的 epoch/fencing 合同；本片不作此保证。

## 三、覆盖矩阵

| 操作 | 禁用后的处理 |
| --- | --- |
| 普通 Session create | 拒绝新准入，不启动 adapter |
| Task createForTask / startTaskRun / rework | 在创建及实际新 Run 派发边界核对；保留 durable attempt / UNKNOWN 合同，不能擅自释放已有 claim |
| Worktree Session 创建 / 队列派发 / 启动恢复队列 | 实际运行时核对；禁用不丢排队记录或假报运行完成 |
| DISCONNECTED Session resume | 拒绝新恢复准入，不启动 restore |
| continuation / capability 探测 | 新资源操作需准入，不复用旧 enabled 缓存 |
| 已有活动 Session 新 startRun | 新增 enabled 门禁，禁用拒绝新回合；保留原 Session / activation / Run / UNKNOWN 保护，不新加 Agent 历史预检 READY 条件 |
| legacy preflight + connection-check | 同一门禁覆盖所有目标，禁用不触发隐式 capability 二次启动 |
| GET/list/profile/eligibility/历史/导出 | 保持只读可用；eligibility 明确 DISABLED |
| 当前运行的审批决策 / cancel / close / shutdown cleanup | 继续允许，不因禁用阻断收敛；不得据此启动新的用户回合 |
| 默认配置编辑 | 独立合同，不隐式启用，不覆盖启停版本 |

实现时逐个列举真实调用点与直接 service 调用，不仅测试 HTTP。尤其审核存在 handle 的路径、排队恢复路径及 Provider 调用前的 await 边界。

## 四、UI 与未知结果

Agent 详情使用克制的次级操作，不新增仪表盘或巨大状态卡。启停状态与健康 READY 分开显示；列表与项目 eligibility 同步读回。

- 操作绑定 auth 身份/epoch、Agent ID、原 enabledRevision；与默认配置草稿完全隔离。
- 在点击前清楚说明禁用不取消已有工作；启用不表示健康已验证。
- pending 禁止重复写。网络失败或响应身份/版本不可信进入 UNKNOWN，只允许 GET 核对，不自动重放 PATCH。
- 同 revision 仍未知；更高 revision 显示当前状态和原 CAS 已失效，不声称本次请求成功；用户显式基于新版本重新操作。
- 切路由、登出、重新登录、另一身份及迟到响应不能污染新页面缓存。已有更新版本不得被旧 GET 覆盖。
- 禁用 Agent 仍可查看历史、关闭和取消；选择器不得继续把它作为可启动选项。

## 五、阶段任务与完成门禁

1. **准入盘点与合同测试**：逐入口确认新工作边界、现有排队/UNKNOWN 行为；先给出最小可重复 barrier 场景。
2. **DB + API**：迁移、原子 CAS、严格校验、404/409、committed row、shutdown drain。隔离 PGlite 测试，不碰用户数据库。
3. **共享准入协调**：同 Agent 启停/准入排序，不同 Agent 互不阻塞；补 Session、Task、Worktree、preflight 的漏口。
4. **UI 最小闭环**：详情次级操作、冲突/UNKNOWN 读回、列表与 eligibility 更新；不更改默认配置草稿。
5. **独立 CR 与验证**：专项后冻结，全仓/类型/lint/build，精确提交 CI 与四宽双主题真实服务截图。受控 fixture 证据不能称真实 Provider 验收。

## 六、必要验收

- 迁移保留旧 enabled 值，revision 默认 0；两次同版本 CAS 恰好一个成功，另一个 409；状态/能力/默认配置写入不覆盖启停 revision。
- 每个新工作入口在禁用后均零 adapter 资源调用；启用不重置 status/能力：create/resume 的 NOT_READY / target 不匹配仍拒绝，活动 handle 保留原 Session 门禁，runtime 停止 / UNKNOWN 仍拒绝。
- barrier 两种时序：禁用先线性化则零启动；准入先线性化则允许收尾且不被开关强杀。不能只测同步路径。
- 禁用期间当前 Run 正常完成，审批/cancel/close 可执行；失败清理与未知资源继续保留 fence，不合成 run.cancelled。
- 多 Agent 并行不相互串行阻塞；同 Agent 慢 Provider 不占用整段管理锁；队列异常不吞失败或自动重试。
- UI 断网、409、GET 同版本/高版本、登出重登、路由与身份切换、迟到读写均维持归属保护；草稿不丢。
- 真实服务 fixture 验证选择器不可新建、已运行不终止、重新启用只恢复资格；无真实 Provider/用户容器调用。

## 七、引用与剩余边界

禁用不是删除，因此无需拒绝被 Session / Task / Project 引用的 Agent，也不级联修改引用。未来“移除”须独立定义活动资源、历史引用、默认 Agent、排队任务与可恢复策略，不能借本片实现。

本方案不修复已有 close best-effort 与进程退出认定差异，不解决跨非协作旧版本的分布式写入，不证明五家真实 Provider 或 NAS 已可用。

## 10:04 UTC 基础模块候选边界

`AgentAdmissionCoordinator.run(agentId, shortCriticalSection)` 只序列化短资格核对/持久准入/CAS阶段。同Agent FIFO、不同Agent独立；失败不毒队列，旧tail不删新tail；入队和实际进入均核对runtime，await后由caller显式checkpoint。嵌套准入拒绝；临界区结束后继承ALS上下文的延迟任务可独立申请。12专项通过；10:09:23完整server56文件599测试通过，尚未提交。

正式接线时必须共享同一实例、跟踪整个排队Promise纳入既有shutdown drain，Provider生命周期放在临界区外。不会自动提供DB原子CAS、资源fencing或跨进程协调。额外确认易漏入口 `tryModelContinuationSummaryAdmitted()` 的模型摘要辅助会话也会调用capability/create/send，必须纳入，不能只接resolveRuntime。

## 10:30 UTC 完整候选与验证边界

- DB：0015新增enabledRevision，单SQL compareAndSetAvailability，同值递增，普通update拒enabled/revision，preflight白名单不旁路；旧schema Agent fixture改明确旧列，保留原迁移断言。本地PGlite完整17文件184测试通过。
- 服务：严格PATCH availability、共享逐Agent短临界区，排队Promise纳入关闭排空；所有新资源入口/现有handle新Run/两预检/摘要辅助会话有准入。已准入可收尾，审批/cancel/close不受禁用拦截；enable不清UNKNOWN。完整server57文件615测试通过。
- 分段Task语义：Session创建先获准不授予无限新Run许可；禁用若先于后续Run准入，零Run/零send、原Task仍绑定Session，attempt UNKNOWN/TASK_RUN_START_UNRESOLVED、Session DISCONNECTED，重新启用仍不重放。
- 前端：独立详情次级操作，revision/target/phase保护跨刷新，不持久存Prompt或配置；未知只GET，同版本仍未知，高版本只表示当前状态，明确新操作才再PATCH；旧PATCH和卸载不覆盖较新标签页marker，缓存错误不推翻已确认成功，原model/mode草稿不变。最终47专项通过。
- 独立CR曾发现外部settled误抬未决版本门槛、旧请求结算失败后内存pending悬挂，均先复现再窄修；最后完整树不能沿用修前46专项。
- 真实PG新增独立临时数据库双连接CAS竞争、确定性pg_stat_activity Lock等待后提交与持久读回；本地3例明确skip，真实CI尚未运行，不拿PGlite代替。
- 全仓/最终build与四宽浅深实际截图仍待。未推送该候选，未main/部署、真实Provider或用户数据库操作。

- 10:38:08最终冻结全仓完成：214文件通过/6文件跳过，2210测试通过/10跳过，477.95秒exit0；26个产品/单测文件指纹确认运行中未变。10:39:24全仓lint/typecheck、独立integration类型与串行build通过。准备按DB、服务、前端、E2E/CI/台账逻辑提交；新真实PG、启停浏览器与像素仍待精确新CI。

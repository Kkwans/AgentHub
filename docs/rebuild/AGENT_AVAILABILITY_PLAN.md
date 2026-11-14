# Agent 禁用 / 启用：最小闭环方案

状态：**只读设计，尚未实施或验收**。本方案不证明真实 Provider 已接入。

当前优先级：先修已有 Task start UNKNOWN 的前端保护缺口，再安排本方案。不能只发布一个开关，却遗漏后台新工作准入。

## 目标与非目标

禁用是阻止新的工作准入，不是终止进程、取消 Run、注销 Agent 或删除历史。启用仅恢复准入资格，仍需原有 READY、target、项目路径、权限、runtime ownership 和资源未知门禁全部通过。

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
| 已有活动 Session 新 startRun | 拒绝新回合；不得因 handle 已存在而绕过 |
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
- 每个新工作入口在禁用后均零 adapter 资源调用；启用但 NOT_READY / target 不匹配 / runtime 停止 / UNKNOWN 仍拒绝。
- barrier 两种时序：禁用先线性化则零启动；准入先线性化则允许收尾且不被开关强杀。不能只测同步路径。
- 禁用期间当前 Run 正常完成，审批/cancel/close 可执行；失败清理与未知资源继续保留 fence，不合成 run.cancelled。
- 多 Agent 并行不相互串行阻塞；同 Agent 慢 Provider 不占用整段管理锁；队列异常不吞失败或自动重试。
- UI 断网、409、GET 同版本/高版本、登出重登、路由与身份切换、迟到读写均维持归属保护；草稿不丢。
- 真实服务 fixture 验证选择器不可新建、已运行不终止、重新启用只恢复资格；无真实 Provider/用户容器调用。

## 七、引用与剩余边界

禁用不是删除，因此无需拒绝被 Session / Task / Project 引用的 Agent，也不级联修改引用。未来“移除”须独立定义活动资源、历史引用、默认 Agent、排队任务与可恢复策略，不能借本片实现。

本方案不修复已有 close best-effort 与进程退出认定差异，不解决跨非协作旧版本的分布式写入，不证明五家真实 Provider 或 NAS 已可用。

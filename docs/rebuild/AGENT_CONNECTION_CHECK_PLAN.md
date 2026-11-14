# Agent 连接检查：实施合同

2026-11-14 06:02 UTC。状态：实施中，未验证、未发布。本片承接 NEXT_PRODUCT_PLAN 的 N04；保持简洁详情页，不扩展为诊断仪表盘。

## 已确认的旧行为与风险

- `preflight(smokeSession:false)` 仍启动 ACP 子进程、initialize 并更新 Agent 状态/最近检查时间；只是不创建测试会话，不能叫只读检查。
- Docker launcher 可能按策略启动容器；远程 RPC 报告并非本次要证明的能力。首版新入口只支持 LOCAL_HOST + ACP_STDIO，拒绝其他目标，不修改现有容器。
- `ProjectService.get` 只是共享 ADMIN 模型下读取注册记录，不是用户级 ACL。不得宣传成每用户项目隔离。
- RuntimeOperations 只在入口检查归属；Host launcher 后续还有 executable access、环境解析等 await，撤销可能发生在其间。
- 旧 preflight 的运行时清理可能吞掉 process.cancel 失败，进程退出未确认仍返回 READY；单纯让 HTTP Promise rejected 不能保住健康锁。

## 服务端合同

新 `POST /api/v1/agents/:id/connection-check` 使用严格 body `{projectId, expectedTargetId}`。服务端从已注册项目派生目录，检查 ACTIVE、Agent enabled、Agent/Project/Target 身份一致、LOCAL_HOST、ACP_STDIO；realpath/stat 确认目录存在且 canonical identity 未漂移。不接收用户任意 cwd，不允许 smoke 开关。

- 在调用 adapter 前重新检查准入。Host launcher 新增同步 `assertCanLaunch`，在最后一个 await 后、spawn 前调用；生产环境注入 RuntimeLifecycle.assertHeld。
- Server 的所有 Agent preflight（包括旧路由）传入严格清理选项，本机 ACP 路径由新合同保证；Remote adapter 当前不把该选项传给 Node，跨端严格退出仍是明确缺口；旧 Docker launcher 在 prepareForRun 后也尚无对应最终归属门禁，不能说所有目标均获得保证。新 UI 不开放 Remote。adapter 的其他 Session 行为不因本片默认改写。
- 严格清理失败抛 `ACP_PROCESS_CLEANUP_UNCONFIRMED`，初始化失败时的清理也一样；不得转换为 READY 或仅含普通错误的已结束报告。清理失败不得保留新鲜成功能力缓存。
- AgentService 保存 sticky 未确认进程状态，shutdown 明确拒绝成功，交由 RuntimeLifecycle 保留仍健康的运行归属；只靠 pending promise 排空不够。结果未知不自动重新启动或超时解锁。
- 同 Agent 同时检查需排他，避免跨标签页状态竞写；这不是跨进程幂等或已持久化的操作结果合同。
- 返回值仅含本地白名单状态与中文解释，避免转发原始 checks.details、repair commands、环境、stderr 或未经约束的供应商字段。

## 页面合同

详情增加一个紧凑“连接检查”区。展示选中的已注册项目与目标，说明“启动连接检查进程，不创建测试会话；更新最近检查状态”。保持默认模型/模式编辑草稿独立，不因刷新能力覆盖草稿。

初次进入不发 POST；必须主动点击。Pending 禁重复提交。失败/超时显示“结果待核对”，只能查看已保存状态，不把旧 READY/时间戳当本次成功，不自动重跑。Agent、目标、项目、登录身份切换后丢弃迟到结果。历史能力与本次结果分开，不展示伪造在线状态。

## 必须验收的场景

1. 项目/目标不匹配、inactive、禁用、目录身份变化、Docker/Remote 均不启动子进程。
2. 环境解析等待期间关闭或失去归属，真正 spawn 次数为零。
3. preflight 正常和初始化失败两条路径的 cancel 未确认均不能报告 READY；service shutdown 失败保留健康归属，重复 shutdown 不改变结论。
4. 双击/并发检查只有一次；网络未知不自动重投，历史状态读取不消除未知。
5. 默认编辑草稿、跨身份/跨Agent晚回包隔离、报告白名单；四视口/浅深色实际截图与键盘路径；8例显式接入CI，检查主题、console/pageerror与横向溢出，仅精确豁免用例主动注入的丢响应错误。

只运行隔离替身与临时测试进程，不运行用户真实 Agent 或读取凭据。专项、全量、独立 CR、精确提交 CI 和新截图分别记账；完成前不声称可用、全绿、已合 main 或已部署。

# 问题台账

状态：待复现 → 已确认 → 实施中 → 待验收 → 已关闭。源码证据与运行复现分开记录。P0 为数据/权限高风险；P1 为核心旅程阻塞；P2 为明显体验或维护缺陷。

| ID     | 优先级 | 问题与证据                                                                                                     | 状态                                  | 关闭条件                                                                    |
| ------ | ------ | -------------------------------------------------------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------- |
| AH-001 | P1     | `NewWorkPage.tsx:149–173` 创建、READY、start 串行放在一次 mutation，后步失败未保存已创建任务，重试可能重复创建 | 真实 HTTP + PGlite + fixture ACP 复现 | 创建成功后的失败保留任务身份；重试仅恢复缺失步骤；断网、连点、离页测试      |
| AH-002 | P1     | 同文件 promptId 只在回退 URL 出现，start 请求只有 agentId，成功跳 Workspace 后所选资产不生效                   | 源码确认                              | 选中 Prompt 的版本、变量和来源进入 Run 上下文；缺变量阻止执行；真实请求断言 |
| AH-003 | P1     | `TaskService.startTask` 使用 description                                                                       |                                       | title，填写补充上下文后主目标丢失                                           | 已确认 | Run 输入同时保留目标、补充说明和验收标准；测试覆盖空说明与多行文本 |
| AH-004 | P1     | CreateProjectPage 仅 roots 下拉，未使用 directories/project-candidates，难以选允许根目录下的仓库               | 源码确认                              | 安全目录浏览、候选仓库、路径错误与返回选择完整闭环                          |
| AH-005 | P0 | TopicBroker 仅 WS upgrade 认证；AuthService 撤销未通知已连接客户端 | 单实例连接授权修复，8 项真实 HTTP/WS/PGlite 回归通过 | 注销、改密、撤销、过期关闭旧流；跨进程失效传播仍待实现；不终止底层 PTY |
| AH-006 | P2     | NewWork Agent 只过滤 READY，未统一 enabled/target/online 条件                                                  | 源码确认                              | 服务端与界面共用明确可执行判定；禁用/离线/目标不匹配不可误选                |
| AH-007 | P2     | 无 Agent 时按钮仍叫“创建并开始”，实际仅创建任务                                                                | 源码确认                              | 动作名称、结果反馈和下一步与实际行为一致                                    |
| AH-008 | P2     | AppShell 所有 NavLink end 导致子路由丢高亮；ProfileSurface 交互外观但无动作                                    | 源码确认                              | 分区路由高亮稳定；账户入口有明确功能或改为非交互信息                        |
| AH-009 | P1     | 多套设计系统与全局覆盖并行，页面密度与交互层次不统一                                                           | 架构确认，视觉审查中                  | 单一 token/组件体系；迁移后删除旧层；四视口浅深色截图验收                   |
| AH-010 | P1     | CI 主要依赖 fixture，真实服务主线测试有 legacy skip，不能证明从零可用                                          | 已确认                                | 新主线 real HTTP+browser 门禁接入 CI；fixture/real Agent/NAS 证据分别标注   |
| AH-011 | P2     | SessionService 混合多项职责，发现/诊断可能重复昂贵扫描                                                         | 待性能基线                            | 记录耗时与调用次数，职责拆分不改变契约，缓存失效规则经验证                  |

## 关闭规则

每项关闭必须补：提交、测试命令与结果、实际截图/日志路径、未覆盖环境。仅“代码已写”不得关闭。修复后出现的新问题使用新 ID，不重写旧历史。

## 补充审查结果

- AH-012 / P1：SessionService.startRun 并发进入时，可创建两个 RUNNING Run、仅一个实际发送，另一个因 Session 状态竞争成为孤儿。实际方法+仓库 stub 已复现，真实 PGlite 回归待补。
- AH-013 / P2：新建工作主指令 textarea 保存为 title，而 API 限制 240 字符；真实 HTTP 241 字符返回 400。应分开短标题与完整指令。
- AH-014 / P2：Agent discovery 可能返回 READY 同时 reasonCode=RUNTIME_STOPPED；注册信息不能覆盖当前运行状态。
- AH-015 / P1：Run 创建后的前置持久化错误未统一回收，QUEUED 不在重启恢复列表；需故障注入确认。

2026-11-12 独立运行证据：真实本地服务+PGlite+fixture ACP 中，带补充说明的任务 USER 消息丢失主目标；重复模拟新建→转 READY→启动失败得到两个任务；目录候选接口返回父根下两个仓库。这里没有调用用户的真实 Agent 或 NAS。

- AH-016 / P2：基线 presentation architecture 测试失败，FileInspector 从 API 模块导入 ApiError，违反显示面板依赖边界。先判断正确抽象位置，再修复而非删除断言。

### 已处理切片

- AH-003：4ec0e49 已发布，初始/返工及空说明/多行专项 6 项通过，独立审查无阻塞；真实 HTTP 修复后复测待补。
- AH-016：使用已存在的独立 api-error 模块，架构测试不再失败；全量 337 项通过。视觉行为未改变，不把此修复称为 UI 重设计。

- AH-012：真实 PGlite 已复现并完成单实例准入修复；23 项 Session 测试与全量 340 项通过，远端 CI 待核验。跨进程幂等、其他生命周期竞争不在此修复范围。

## 第二轮运行审查

- AH-017 / P1：同一 Task 的并发 start 在任务状态变更前已创建两个 Session，真实 HTTP 返回 201+409 但失败方留下未关闭 READY Session。与 AH-012（同一 Session 并发 Run）不同；Task 级准入修复实施中。
- AH-018 / P2：`qa:css-budget` 基线失败：Workspace CSS 19,809 bytes 超过 16,384，8 个 !important 超过 4。保留预算，不提高阈值掩盖设计层债务。
- AH-019 / P1：`release:version-truth` 基线失败，v1.1.0 视觉 manifest 明确 complete=false。现有发布记录不能当作全面验收；补新鲜证据后再评估。
- AH-020 / P1（待复现）：Task返工也在状态变更前创建新Session，需验证并发审阅/返工与任务启动交错。不得把 AH-017 的局部 start 保护称为全部 Task 生命周期安全。

AH-003 修复后的真实 HTTP+PGlite+fixture ACP 已复测：持久 USER 消息同时包含主目标与补充说明。真实 Agent/NAS 仍未测。

- AH-017：任务级同步准入修复经真实 HTTP复测及独立审查通过，全量342项测试通过；保持同实例范围说明，不关闭AH-020。

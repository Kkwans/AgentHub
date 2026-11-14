# 问题台账

状态：待复现 → 已确认 → 实施中 → 待验收 → 已关闭。源码证据与运行复现分开记录。P0 为数据/权限高风险；P1 为核心旅程阻塞；P2 为明显体验或维护缺陷。

| ID     | 优先级 | 问题与证据                                                         | 状态                                                                             | 关闭条件                                                                          |
| ------ | ------ | ------------------------------------------------------------------ | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| AH-001 | P1     | 创建、READY、start 串行 mutation，后步失败后重试可能重复创建       | 当前页/刷新恢复与服务端创建幂等已发布，12项真实恢复通过；整体未关闭              | 四宽双主题恢复已通过；创建幂等不覆盖start，持久启动预留/故障恢复仍待实现          |
| AH-002 | P1     | 所选 Prompt 未进入成功启动链路                                     | c7bd5b4真实CI通过：固定版本、延后变量、继承输入已验收                            | S54精确CI43330610456已验收原任务变量修复四宽；该次整体CI因新增资格测试前置404仍红 |
| AH-003 | P1     | TaskService 优先 description 导致主目标 title 丢失                 | 已修复；初始/返工回归及真实 HTTP 通过                                            | 共享构造器保留主目标、补充说明和验收；后续 Prompt 改动必须保持                    |
| AH-004 | P1     | 仅 roots 下拉，无法选授权父目录下嵌套仓库                          | 已关闭（控制面目录选择路径）；22 项组件回归及 f49468f/a0ac4ee 四宽真实浏览器通过 | 授权边界、嵌套选择与真实创建已验证；目标 NAS/真实 Agent 仍未验收                  |
| AH-005 | P0     | TopicBroker 仅 WS upgrade 认证；AuthService 撤销未通知已连接客户端 | 单实例连接授权修复，8 项真实 HTTP/WS/PGlite 回归通过                             | 注销、改密、撤销、过期关闭旧流；跨进程失效传播仍待实现；不终止底层 PTY            |
| AH-006 | P2     | Agent 只按 READY 筛选，忽略禁用和项目可达性                        | 服务端注册资格只读 API 与前端过滤已实现；61 项针对回归通过                       | 核心创建旅程真实CI已通过；注册状态准入不承诺真实认证/容器健康                     |
| AH-007 | P2     | 无 Agent 时按钮仍叫“创建并开始”，实际仅创建任务                    | 已修正名称；无Agent模板保存真实浏览器通过                                        | 实际只创建Task，不冒称启动                                                        |
| AH-008 | P2     | 子路由丢高亮；账户按钮无动作且默认伪造身份                         | 修复分区高亮、实际账户/访问模式及账户设置入口；29 项针对测试通过                 | 实际核心导航/设置入口及fixture48已通过；共享Dialog已在7bbead8及后续真实CI验收     |
| AH-009 | P1     | 多套设计系统与全局覆盖并行，页面密度与交互层次不统一               | 用户否定现有视觉，整体方向重选中                                                 | 单一 token/组件体系；迁移后删除旧层；四视口浅深色截图验收                         |
| AH-010 | P1     | CI 主要依赖 fixture，真实服务主线测试有 legacy skip                | 真实服务与140图门禁已接入；77bc747精确双绿                                       | 141真实项及140几何；历史失败保留，真实Agent/NAS未测                               |
| AH-011 | P2     | SessionService 混合多项职责，发现/诊断可能重复昂贵扫描             | 待性能基线                                                                       | 记录耗时与调用次数，职责拆分不改变契约，缓存失效规则经验证                        |

## 关闭规则

每项关闭必须补：提交、测试命令与结果、实际截图/日志路径、未覆盖环境。仅“代码已写”不得关闭。修复后出现的新问题使用新 ID，不重写旧历史。

## 补充审查结果

- AH-012 / P1：SessionService.startRun 并发进入时，可创建两个 RUNNING Run、仅一个实际发送，另一个因 Session 状态竞争成为孤儿。实际方法+仓库 stub 已复现，真实 PGlite 回归待补。
- AH-013 / P2：新建工作主指令 textarea 保存为 title，而 API 限制 240 字符；真实 HTTP 241 字符返回 400。已分开短标题与完整指令，全文保存到 description 并覆盖首次执行/返工；489项完整测试通过，真实浏览器待新提交CI。
- AH-014 / P2：Agent discovery 可能返回 READY 同时 reasonCode=RUNTIME_STOPPED；注册信息不能覆盖当前运行状态。
- AH-015 / P1：Run 创建后的前置持久化错误未统一回收；早期误判 QUEUED 不在重启恢复列表已纠正，普通 Task 收敛和未知派发仍需完善。

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

## CI 追加阻塞

- AH-021（P1）：b562875 浏览器 E2E 为 42 通过、6 失败；四视口 Workspace 工具事件分组未出现，1024/768 导航文字不符合断言。尚未判定旧契约还是产品回归，不删断言掩盖问题。
- AH-022（P1）：ff160132 与 76b7ce6 的 CI unit 均因 ChatConversationView 延迟 RAF 调用 jsdom 缺失的 scrollTo 产生未处理异常；断言分别 342/350 通过，但整个 job 失败。需修复异步生命周期/测试环境契约，不把断言通过等同 suite 通过。

- AH-023（P0）：进程 logger 未覆盖响应 `Set-Cookie`，登录/初始化会话 token 可写入日志；注入未配置 logger 的 createApp 也缺强制脱敏。真实 HTTP 回归在旧代码失败，已发布 1e9b8a9，完整门禁通过；不宣称清除了已有部署日志。
- AH-024（P2）：真实截图确认首页零值指标和多重空卡占据首屏、窄屏项目筛选器比内容更突出；见 VISUAL-BASELINE.md，首页重构已实现；f49468f 真实截图矩阵/几何通过并已审阅首页浅色1440、深色390，窄屏Projects筛选优化中。

- AH-025（P2）：实际 Workspace 截图右侧 Git 为 main，左侧却显示“无 Git”；源码用空 session.branch 推断无仓库。需区分分支未知、非 Git 目录与已确认仓库，独立修复。

### 后续验证状态

- AH-018：删除已迁移布局的死 CSS 与经层叠证明无必要的 important，19809→15421 字节、8→0；原预算阈值不变，检查通过。新视觉/resize 验收待 CI。
- AH-025：三处改用统一分支标签，未记录分支不再误称无 Git；13 项标签测试通过。
- AH-021：d430519 真实服务 job 全绿；fixture 44 通过/4 失败，失败停在查看旧工具详情后的错误滚动假设。已改为主动滚离→回到底部的行为验证，等待新 CI，而非删除断言。

AH-024 追加：首页空态8张实际图已审阅，主CTA无阻塞问题；有数据首页（STANDARD项目、7事项、3会话）与移动Projects渐进筛选正补独立真实服务验收，不能用空态140图代替内容态验证。

### AH-020 返工与状态交错

已用真实PGlite+受控Session创建复现：两个REWORK创建两个Session；REWORK尚在创建时APPROVE成功；start/rework与手动CANCEL交错。旧源新增五例中四失败、一安全回归通过。修复将start/review/manual transition置于同实例同步准入，重叠操作直接409，不排队过期意图；失败finally释放，生命周期回调不加锁。针对20项通过，完整497项通过/10跳过，lint/typecheck/build通过。跨进程会话创建预留/故障回收、旧Run迟到回调的所有权仍单独处理，不因本修复关闭整体生命周期风险。

- AH-026（P1）：旧Session的Run完成/失败/取消/断连回调只检查Task仍IN_PROGRESS，可覆盖已经进入新返工Session的状态和finalRunId。真实PGlite五项回归在旧代码均失败；修复使用Task行锁下的持久Run/Session所有权和终态验证，拒绝missing/stale/mismatch，专项25项通过，独立CR补齐边界后完整507项通过/10跳过，lint/typecheck/build通过。跨进程回调更新在同一DB事务内校验，但不代表跨进程Session创建预留或同Session最新Run排序已解决。

- AH-027（P2）：a0ac真实Projects归档卡片显示“状态”且使用警告色，AhStatusPill/Dot共享映射缺ARCHIVED。已补“已归档”和中性gray，两条回归先红后绿；完整509项通过，待新截图复核。
- AH-028（P2）：真实Home内容态390/768长事项标题与描述占用过多纵向空间；≤860px分层摘要与可键盘展开全文已实现，单测通过待真实视觉验收，保留动作/原href及5/7事项列表契约。
- AH-029（P2）：字体token漂移，pinharness覆盖已有Geist/CJK栈；8档真实CDP显示中文WenQuanYi Zen Hei、Geist未加载、Home标题weight400。按实际命中统一现有token并复核字重，不引入大字体资源或只修CI字体环境。

- AH-030（P1）：Home存在多个活跃正式项目时，原“新建工作”静默进入第一个项目，可能把工作放错目录。现明确选择项目名称与路径，单项目展示目标；组件与真实四宽双主题验收已增加，实际浏览器结果待新CI。
- AH-001续：服务端幂等后已接入浏览器最小恢复线索、只读刷新恢复与同页同编号重放。跨刷新不保留正文，不自动续启；不同编号跨标签新建、start幂等仍不在本切片保证内。
- AH-028验收：fe878f3精确CI双绿，独立实际390截图每行约187→142px，768原内容适配两行时无多余详情按钮；未见新溢出。现追加收起后焦点断言，不把此前缺少该断言称为已复现缺陷。

- AH-031（P1）：同Session R1终态先将Session置READY，Task observer完成前可创建R2，旧R1回调仍可把R2执行中的Task改待审阅/阻塞。新增Session.latestRunId，Run插入/指针与Task回调统一Task→Session锁顺序；回调须命中持久最新Run。旧源新增7例全失败，修复64专项通过，最终集成门禁中。历史指针NULL不猜时间戳；直接续发不会隐式重启已待审阅Task。PGlite顺序证明不等于独立Postgres连接竞争实测。
- AH-032（P1，待独立复现）：额外服务回归暴露GitHeadProbe返回undefined时，Run完成后可能执行空gitAfterSha UPDATE并中断Task observer。非Git目录是合法输入，不应使已完成Run的Task状态无法收敛；正在独立验证，不以测试探针修复关闭生产问题。

- AH-032复现/修复：受控无HEAD探针+真实Session/Task/PGlite在旧源失败，Session错误转DISCONNECTED且Task不收敛。修复只在SHA非undefined时更新gitAfterSha，避免空UPDATE；真实探针异常保持原错误路径，不catch吞掉。完整Session27项通过，集成门禁中。
- AH-033（P1）：实际Agent卡片显示Session/Run/Sessions重复且凭空承诺支持；原实现硬补Session/Run，并把嵌套对象truthy当支持。改为真实嵌套合同及旧别名中明确true的已知能力，去重并明确未知，不把能力徽章当项目实时可用证明。
- AH-034（P2）：Agent整卡/查看诊断看似特定Agent入口，实际均进当前AgentHub服务器诊断。取消伪详情导航，保留明确“服务器诊断”及范围说明；不虚构尚未实现的Agent详情。真实四宽双主题验收新增，待CI实际执行。
- AH-035（P1）：74f49ba真实CI四宽双主题均复现多项目弹窗Escape不能关闭；共享FormDialog是role=dialog的section但无Escape/焦点圈定，原全局querySelector还会混淆多个弹层。正在修共享组件，保留失败验收，不通过删除Esc断言转绿。
- AH-036（P2）：实际390 Prompt空库目录创建按钮受局部288px滚动裁切，下方重复编辑器空态。仅原始资产成功返回空数组时显示单一创建入口；筛选无结果仍保留已有选中编辑器，加载/错误不冒充空库。5项定向验证通过，真实八组合已在7bbead8 CI通过，独立像素复审无阻断。

## 当前生命周期补充纠正

AH-015最新源码复核：现有restart recovery已把QUEUED改FAILED、其他活动Run/Session断连，不能继续笼统称“QUEUED不在恢复列表”。仍缺的是普通Task的重启收敛，以及QUEUED插入后、sendTurn前多项持久化异常没有统一收敛。sendTurn后的外部Run ID保存错误还可能被当作已确认失败；必须区分未派发证明与未知执行，不能自动重发。第一切片已实现准备/派发分类、恢复未完成隔离、Worktree真实Run绑定和权威取消；83项专项通过，集成633单测及lint/types/build/QA通过。第一笔恢复标记写失败后的完整startup隔离和普通Task收敛仍属第二切片，未关闭。

- AH-037（P1）：Agent 卡片缺少真实逐项管理路径。新增精确 ID 详情及默认模型/模式读写，30专项通过；错误目标核对保持锁定，真实九项已在23a2a51 CI通过，独立像素复审待完成。未提供启停/删除、服务端CAS或持久未决编辑恢复，不能称完整Agent运维能力。

- AH-038（P2）：7bbead8实际390 Prompt空库页头说明后约180px留白，内容态反而更紧凑；需核对空actions布局合同并做双主题四宽回归。最小Prompt根网格修复和真实几何回归已完成，5专项通过，等待新HEAD CI，不改全局页头。

- AH-039（P1）：普通任务工作列表对IN_PROGRESS执行取消仅转换Task为CANCELED，不调用Session/Run取消；实际TaskService+stub复现Task已取消而Run仍RUNNING、cancelCalls=0。首片阻止进行中直接取消并明确进入所属工作区停止Run，未运行任务仍可取消；不把请求返回当执行已停止，完整权威取消交互后续完善。实现/独立CR完成，最终集成651单测、lint/types/build及QA通过，新真实CI待发布；非真实Agent/NAS测试。Task取消先胜出后的反向直接Session准入仍需独立修复。

- AH-040（P1）：Task取消先提交后，旧READY Session的Run admission仍可能创建关联新Run；不能仅凭Task行锁称双向竞争已解决。需明确CANCELED/DONE与审阅会话直接继续的合同，再在持久准入处核验。持久准入修复及历史漂移 fixture 修正已完成，86 项专项和所有权文件 10 项通过；完整 S31 726 单测、lint/types/build/QA 全过，按逻辑切片发布；真实 Agent/NAS 与多进程不在本次证明范围。
- AH-041（P2）：项目工作列表无Agent的“开始”直接请求BACKLOG→IN_PROGRESS，与状态机需先READY不符；AH041已补合法两步与未知结果只读恢复、身份/导航隔离，58专项通过，S33完整753单测、lint/types/build/QA通过，真实CI待验；不放宽状态机，不启动Agent。

- AH-042（P2）：Agent管理390首屏被状态说明/技术ID占据，主要编辑入口从y767才开始。局部层级重排已实现，关键警告不折叠、技术区原生键盘可展开；29组件专项通过，初始输入视口断言及实际像素待新CI。

- AH-015第二片进展：新增持久派发阶段与真实完整startup恢复，修复首次cleanup标记失败后的证明缺口、普通Task结果收敛、未知取消不释放队列；119隔离专项及3条集成联动回归通过。完整681单测及lint/types/build/QA通过；恢复UI/供应商重连仍未验收。

- AH-043（P1/P2）：无版本Prompt将资产description或“尚未创建版本内容。”当正文，假计字符且预填新版本。现已分离真实正文与空态，首版本明确入口；TEXT空串不回退元数据，CHAT优先序列化完整JSON（含额外text字段）。13专项通过，真实八组合创建/取消/正文API核对待新CI。
- AH-044（P2）：项目Work真空态仍显示大筛选栏及双空面板。仅原始请求成功且任务空数组时保留项目header唯一新建入口，内容改紧凑指引；过滤无结果/错误/加载不冒充空库，已有详情保留。6专项与真实8项收集通过，像素待CI。
- AH-045（P2）：Settings根网格拉伸造成1440页头约139px留白。仅该页根align-content:start，四宽双主题新增几何门禁；导航末项可发现性仍开放，未改共享header。

- AH-046（P1）：Prompt 新版本草稿未冻结资产归属，Back/切换资产可能将 A 正文提交到 B，A 迟到响应也可能清空 B 新草稿。新增逐次打开的身份/路由/选择归属、不可变提交目标、迟到响应隔离和未知结果只读核对；26 项专项及完整 S31 726 单测、lint/types/build/QA 通过，真实浏览器待新 CI。未知结果只在当前挂载期间保存，不声称跨刷新去重或 exactly-once；标签和绑定的相邻流程不在本片范围。
- AH-047（P2）：Runtime 行缺少供应商 statusText 时，即使右侧 READY，副文本仍显示“状态待确认”。按明确状态生成一致文案，供应商非空原文保持不变，未知值仍未知，绝不由宿主机就绪推断 Agent 健康。13 项专项通过，真实宿主机四宽双主题待 CI。

- AH-048（P2）：实际390设置页分区导航仅前四项完整，系统裁切/高级隐藏，768左栏完整。限定≤760px改六项3列×2行、44px点击目标，原链接/选中语义/桌面不变；移动高度增加一行以换取可发现性。3项CSS合同通过不能替代像素，真实五宽双主题10项已在 ce6994b CI 通过；只证明可达/布局合同，用户未认可现有整体设计。

- AH-049（P2，暂停视觉实现）：项目概览实际1440图中活跃卡与审阅卡之间约218px空洞，网格自动排位所致。独立纵向列草稿和2项组件测试已保留未发布，等待整体设计方向，不把本地小修视为改版。
- AH-050（P2，已修复，待真实CI）：概览和项目页头按全局 READY+enabled Agent 计数，未使用当前项目资格；列表请求失败也可能显示空态，Git预检未返回时可能显示绿勾。4项审计回归已证实：实际HTTP+AgentService/仓储stub返回不兼容项目资格，实际组件仍计全局可用；ReactQuery失败仍假空态、预检pending已有成功勾。审计通过不是修复通过；后续89专项与S35完整793单测、lint/types/build/QA已验证修复，e866真实用例因错误调用Agent默认设置接口失败；已改用真实项目归档验证全局READY但项目资格为0，待新CI。资格数据为 REGISTERED_STATE，不代表实时健康；修复不能用简单 targetId 相等替代合法路径/挂载兼容。
- AH-051（P2，暂停视觉实现）：390项目会话工具栏约227px，两个筛选各占整行；手机两列草稿保留，4组件通过/1失败，其余门禁未执行。等待整体方向，不发布该草稿。
- AH-052（P1，已复现，修复中）：实际页面+AccessGate与延迟POST mock证实5项：A草稿切B写B，A迟到结果失效B查询/抢导航，Back关闭后仍导航，授权失效卸载后仍改变路由，返回project/agent错配仍导航。只证明前端归属/副作用缺陷，未证明服务端跨账号写入。已冻结创建归属、同挂载期未知结果隔离与原项目只读核对；17组件通过，真实两条延迟/丢失响应场景待CI。后到成功仍锁定，须明确创建另一会话；第二次核对开始清旧结果，失败不沿用旧核对。离页/刷新会丢失内存围栏，不承诺幂等或跨重启隔离。

- AH-053（P2）：ce6994b真实内容图中已完成会话仍显示“正在确认 Agent 接收状态”。源码将批准POST返回保存为永久反馈字符串，DELIVERED没有独立分支，后续权威查询不更新。已修复投递状态反馈与异步身份归属，33专项及S35完整门禁通过；不得以Run/Session完成推断送达，不新增自动重发。旧源4例红测已复现，修复回归通过；e866真实8场景全部失败，证明仅观察未决列表不足（终态被移出列表），正在补有界单条只读核验；不得把S35单测通过视为浏览器修复完成，不涉及整体视觉方向。

- AH-054（P2，本地修复待整合验收）：项目页头将所有非DONE/CANCELED任务（含BACKLOG/READY/WAITING_REVIEW）称“运行中”，无Session时Git分支硬回退main。新增10组件在旧源全部红；修复后相关29组件通过。保留计数集合但称“项未结束工作”，未知/刷新/失败不猜0；Session分支明确为历史来源，无记录不猜main。不改CSS/布局或工作链接；真实基线扩展验证BACKLOG不等于活跃Run，待下一CI。

- AH-055（P1，已复现，修复中）：真实SessionService+PGlite+受控adapter证明新handle返回后READY持久化失败，未close且从未进入active，shutdown也无法回收；FAILED写也失败时遮蔽原创建错误。2项审计成功复现坏行为，不是修复通过。已仅回收本次未交接handle，最多1秒等待清理后尽力记失败；已交给active生命周期的handle不关闭也不覆盖FAILED，原始异常保留。96专项通过，API10项通过，S36完整839单测/lint/types/build/QA通过，真实CI待验。close返回仅证明adapter合同返回，不代表进程已终止；UNKNOWN明确提示，未新增清理注册表或自动重试，resume/global shutdown不在此片范围。

- AH-056（P1，CI复现，本地修复待新CI）：02eb verify的839测试断言通过，但WorkspacePage销毁jsdom后发生未处理window is not defined，React Virtualizer被已卸载observer的scroll-end debounce再次通知。上游dispose只移除监听，不取消已排timer；已保持官方observer行为、仅隔离已失效订阅回调，不屏蔽未处理异常或伪造全局window。fixture阶段因此未执行，真实矩阵独立继续。负控2红/1绿；修复专项66通过，S38完整856通过，需新exact-head CI确认。

- AH-057（P1，本地修复，待真实CI）：Session resume拿到新handle后READY持久化失败，未close/未activate，shutdown找不到；FAILED二次写失败还遮蔽原异常。真实Service+PGlite/受控adapter已复现，不是从create类推，不涉及用户真实Agent。需有界回收本次尚未交接handle并保留原错误；旧active关闭失败与新handle清理不能混为已全部释放。
- AH-058（P1，本地修复，待真实CI）：两个resume同时通过DISCONNECTED读取，R1先READY并激活后，R2的无归属detachActive关闭R1赢家，READY→READY失败后将Session写FAILED，且泄漏R2 handle。受控并发诊断已复现。计划首await前同Session同步拒绝重入、按捕获activation身份替换旧连接，失败写入不能覆盖并发close/新赢家；不承诺跨进程完整生命周期隔离。

- AH-059（P1，本实例消费者修复，待新CI）：旧handleActivationDisconnected仅入口检查activation，后续findActiveForSession/Run写/Task回调/Session写跨await未重新核对；safeSessionTransition仅排除CLOSED。若旧回调挂起期间另一条路径已使Session可恢复，迟到回调可能作用新Run/新Session状态。最初只确认既有源码结构；现已用真实Service/PGlite/受控adapter沿合法cancel/Approval失败与resume路径完成2条正例barrier复现，另1条cancel候选不可达已否定。不能说正常单次断连必现。AH057/058只保证resume自身归属，不宣称所有consumer副作用或跨进程隔离；完整原子生命周期fence另行评估。

- AH057/AH058整合结果：恢复互斥、close撤销、迟到handle/配置、自然detach与新旧资源清理已完成；旧源Service3红、DB2红；S39完整872单测及lint/types/build/QA通过，仍待新exact-head CI。只保护本实例resume自身归属，不扩大为AH059或多进程生命周期已解决。

- AH059精确证据：旧findActive已取得R1快照后挂起，经合法cancel拒绝断连、resume、权威完成R1再显式R2，旧回调把新RUNNING Session改DISCONNECTED，而R2仍RUNNING、新handle未关闭。另一条旧Task回调挂起时Approval投递失败推进Session断连，resumeREADY后旧回调再改DISCONNECTED。仅cancel拒绝且Run已断连的候选不会推进Session，resume409，为否定对照。生产尚未修，下一片要求归属检查与最终Session写在本实例activation切换边界保持一致，不能只check再盲await。

- AH059整合：两条正例已修、否定对照保留；短提交队列及双方提交顺序/撤销/失败释放共81专项、S40完整880单测/lint/types/build/QA通过。仅本实例此断连消费者与resume/close必要提交；其他事件路径/跨进程不在完成范围，新SHA真实CI待验。

- AH-060（P1，已修复且本地门禁通过，待新SHA CI）：Approval投递失败收敛未隔离当前activation与Run归属。真实Service/PGlite/受控adapter四条诊断通过：旧回执拒绝、旧handle.close迟到、旧Task回调迟到可污染恢复后新Session状态；第四条不换activation，R1权威完成后显式R2已WAITING_APPROVAL，旧决定失败实际close同handle一次，而R2仍WAITING_APPROVAL。前三例新handle未被close，不与第四例混淆。第三例额外需要两个合法权限请求。未直接改DB/active，未用真实用户Agent。
- AH060计划要求UNKNOWN/DEAD历史状态仍持久化，但当前Session/handle副作用必须同时核验activation代际与当前Run，并与新Run准入提交互斥。RunRepository现有Task→Session锁+latestRunId原子写不能代替服务层长await后的重新准入检查；只read latestRun再await不是完整fence。已整合epoch lease、DB条件收敛与Run准入短提交边界，123专项通过，S41 lint/types/build、893单测/10跳过、QA10通过，新SHA CI待验。

- AH-061（P1，代码53cf131已发布，S42完整门禁通过，新CI待核验）：取消失败收敛先CAS Run为DISCONNECTED，再等待原handle关闭，最后无条件写Session。三条实际Service/PGlite/受控adapter诊断分别证明：CAS已提交但返回迟到时，同activation的显式R2被旧取消真正关闭handle；更换activation后不误关新handle但误标新Session；旧close挂起时，合法并行权限失败打开恢复窗口，旧close返回再误标新READY。仅供应商拒绝迟到且CAS.changed=false的否定对照正确早退。4项诊断通过等于缺陷证明，不是修复绿；未直接篡改DB/active。deadline分支目前仅同结构源码风险，未声称实测。

- AH-061修复范围：取消拒绝/超时使用当前Run、CANCELING状态及Session的事务条件提交，单实例短提交队列协调准入与权威终态；仅精确detach原activation，锁外关闭后不再回写Session。计时器按activation清理，完成Git AFTER取证仍在下一轮READY准入前。新增拒绝/超时提交顺序、close迟到、同Run恢复后再取消、Git屏障及DB谓词回归；152专项通过，旧Service3项负控均失败。跨进程内存activation协调、其他消费者及真实Agent/NAS未覆盖。

- AH062 / P1：显式 `adapter.disconnected` 事件在 Run/Task await 后直接回写 Session，未复用 AH059 的 activation 提交保护。真实 Service/PGlite 合法 barrier 复现：旧 Task 回调挂起，权限失败收敛后 resume 已 READY，旧事件继续会将新 Session 改回 DISCONNECTED。基线 resume 回归失败，close 为正确早退对照。现统一到既有断连 helper，保留显式 runId 选择语义；新增恢复、关闭、有/无 runId 正常断连四项回归；156专项、S43全仓914单测/10跳过、lint/types/build/QA全部通过，独立CR无阻断，待新HEAD远端CI。范围仅旧 activation 迟到污染，不宣称连接级全路径原子化。
- AH063 / P1（源码审查，待运行复现）：连接级断连 helper 在队列外选择 Run、在 Task 回调前后分两段提交。同 activation 新 Run 准入以及携带历史 runId 的断连，可能留下连接已移除而当前 Run 仍活动；需独立合法 barrier 复现，再决定当前 Run/Session 原子收敛，不能借 AH062 的旧 activation 回归关闭此项。

- AH063运行证据与修复：已用真实Service/PGlite确认空快照→新Run准入、历史R1断连遗漏R2两条合法竞争，当前事件普通对照通过。当前Run查询/CAS、Session断连和精确detach已统一同实例短队列，Task锁外；160专项与独立CR通过，全仓S44进行中。事件历史审计和终态保留；跨进程/准备阶段不在关闭声明内。
- AH063本地验收补充：S44全仓918单测/10跳过，lint/typecheck/build/QA全部通过；状态为待新HEAD远端CI验收，不将同实例队列保护扩大为跨进程保证。

- AH064 / P1：审批请求建row后的第二次Run读取可与取消交错；真实Service/PGlite两条旧源诊断失败：取消先赢仍把Session写为WAITING_APPROVAL，取消拒绝并resume后仍发布已取消旧审批的可操作通知。第二条未污染Session（非法转换被拒绝），不扩大证据。修复将审批资格/latestRun/activation检查、状态与请求建立、可操作通知和取消CAS/撤销pending共享同实例短提交边界；Task回调与供应商取消在锁外。164专项通过，S45完整门禁进行中；保留已决定历史、原始事件，多请求取消与双向顺序有回归。
- AH064验收更新：S45全仓922单测/10跳过、lint/types/build/QA通过，最终164专项与独立CR通过；待发布后exact CI验证，限同实例审批/取消提交协调。

- AH065 / P1：旧连接配置事件/请求会越过恢复后的配置归属。真实Service/PGlite确认三类：旧原生事件持久化迟到覆盖新模型/模式；旧provider setter响应在resume后仍成功写旧值；新activation配置请求被旧provider长挂队列阻塞。旧源3条负控全失败。修复按activation隔离配置队列、调用前与提交时重验、原生事件短提交并标记ignored；169专项与独立CR通过，S46全仓门禁进行中。已发送旧provider操作不回滚、不自动重放；跨进程与全局shutdown协调不在本片范围。
- AH065验收更新：lint/types/build及独立CR通过，169专项通过；默认全仓因两未修改PGlite测试文件OOM退出，保留失败。资源隔离后对完整清单核验927项全通过且无遗漏，10原有skip不变，QA10通过；待新HEAD远端CI。

- AH002延后启动变量切片：真实HTTP创建携变量后稍后启动409缺变量；固定版本正确保留，丢失的是变量。前端此前有明确无Agent变量保存禁用护栏，并非静默丢失。现Task新增默认{}的持久JSON、0009兼容迁移；创建API/事务/幂等及前端保存均传递变量，普通Task start逐键覆盖保存默认、review返工用保存默认。非空变量递归canonical纳入hash，省略/{}保持旧hash，显式null不回退。120专项/迁移测试及独立CR通过，S47完整覆盖门禁进行中。Worktree独立派发与继承绑定变量输入仍开放，不关闭AH002整体。
- AH002本切片验收：S47资源隔离完整覆盖931项/10原有skip，lint/types/build/QA通过，120专项/迁移与独立CR通过；待新HEAD真实浏览器CI，不关闭剩余Worktree/继承绑定输入范围。
- AH002 Worktree切片：入队默认丢失及返工变量丢失均已真实服务复现；完整执行快照、首次/返工/重建一致性已实现，29专项及独立CR通过，S48进行中。233cc30真实CI旧文案断言失败已明确记录，正在补真实保存变量浏览器回归。
- AH002 Worktree本地验收：S48资源隔离938通过/10原有skip、lint/types/build/QA及29专项/独立CR通过。真实保存变量E2E已加强，但本地浏览器启动权限阻塞，待新exact CI；继承绑定变量输入仍未关闭。
- AH002继承变量输入切片：未显式选资产时原UI没有变量输入，组件红测确认；真实HTTP证明Project/Agent继承已有服务支持，缺值409且零Session。现Task高级设置始终提供原JSON控件、独立校验并保存，Goal隐藏/不提交，显式资产才预览固定版本；继承按启动时绑定解析，不能暗示pin。87专项和独立CR通过，S49完整覆盖进行中，新真实浏览器继承场景待CI。

- AH002继承输入本地验收：S49完整945项覆盖/10原有skip、lint/types/build/QA10和独立CR通过；真实继承场景待新CI。fe6b8b6浏览器用例漏BACKLOG→READY已修测试，失败记录保留，不提前关闭整体验收。

## AH-066 / P1：阻塞任务的 Agent 恢复入口与错误反馈

- 源码链路：Work Inspector 对 BLOCKED 启用“启动 Session”，但仅对 BACKLOG 转 READY；服务端对非 READY 返回 TASK_NOT_READY。start/transition 错误未呈现，用户点击后看不到原因。
- 实施合同：保留服务端未决 Run 守卫，按原任务身份执行合法 BLOCKED→READY→start；错误按任务归属展示，不跨选择污染，不改 CSS 或未选视觉方向。
- 状态：已关闭当前入口切片。5条红测确证后修复，960项完整覆盖及独立CR通过；9da7e14 exact CI43315787100双绿，包含4宽真实恢复，121真实项/140几何通过。本项不关闭 AH-001 的分布式幂等或未知派发问题。
- 另记录待规划缺口：保存的继承模板变量缺失后，Work Inspector 尚无编辑修复入口；本片不扩展 PATCH 或变量编辑功能。

## AH-067 / P1：已分配 Agent 的显示与启动动作不一致

- 源码证据：Inspector选框/摘要使用runAgentId或assignedAgentId，按钮、请求、手工说明仅使用runAgentId。无URL参数打开已有Agent任务，会显示Agent但走手工分支；BLOCKED时手工按钮还被禁用。
- 状态：三条组件红测确证后修复，专项35项及完整966项覆盖、lint/types/build/QA10、独立CR通过；S53 CI43323589612四宽已分配Agent恢复通过，整体CI仍因AH-071为红。显示/说明/操作共用同一有效选择；任务切换不带入上一任务显式选择；保留明确URL override、显式清空语义，等待期间不改变已发起选择。
- 不涉及整体UI样式、默认推荐策略、Agent实时可用性或多实例启动幂等。

## AH-068 / P1：已保存任务缺变量后无法修复

- 真实使用链：继承模板要求变量，已有任务启动安全拒绝TASK_PROMPT_VARIABLES_MISSING且不创建Session；但旧PATCH无变量字段、Inspector无编辑入口，用户不能修复原任务。
- 本片合同：仅无Session且BACKLOG/READY任务可明确保存变量对象；整体替换，{}清空；非法类型拒绝。保存不自动启动、不修改已有执行快照；状态限制须在最终数据库写入时仍成立，避免Worktree队列或其他实例改变状态后仍写入。
- 状态：后端3条入口红测与2条跨实例状态推进红测、前端2条缺入口红测均确证后修复；69后端/50前端专项、完整988项覆盖及lint/types/build/QA10、独立CR通过，代码已发布；S52/S53真实四宽场景在错误提示处失败，尚未完成端到端验收，等待S54精确CI。新增四宽真实场景验证拒绝→修复→刷新保留→原任务成功启动及实际上下文hash，不复制任务。
- 不更改视觉方向、模板绑定/版本、运行中执行变量或用户Agent配置。

## AH-069 / P2：恢复流程E2E遗漏首轮审批

- 精确证据：S51 035a9ca的CI43319680546 verify成功；真实117通过/4失败、140几何通过。4失败均在manual-task-start首轮等待WAITING_REVIEW时仍为IN_PROGRESS，尚未进入恢复UI断言。
- 原因：真实ACP fixture首轮请求allow-once审批，强化“已有assigned Agent历史”测试时未处理该前置审批；不能据此认定产品恢复入口失败。
- 修复合同：通过公开审批API批准该轮，确认Run COMPLETED与Task WAITING_REVIEW后合法转BLOCKED，再验证4宽恢复；保留所有恢复、请求体、Session归属及几何断言。新增无浏览器真实HTTP/PGlite/ACP烟测核验前置流程，真实页面仍待新CI。

AH-069验收进展：测试前置已补，真实无浏览器ACP两轮完整生命周期烟测通过；新浏览器CI待发布后核验。生产代码不变，本片没有重跑全988项单测。

## AH-070 / P1：Work Inspector 未按项目资格限制 Agent

- 旧实现仅按全局READY/enabled列出Agent，未使用已有项目登记资格；不同执行环境不可访问项目的Agent仍能被选中启动，资格加载/失败/刷新未知时也未限制Agent派发。
- 四条组件红测已确认：不兼容Agent、加载中、查询失败、刷新中的旧资格快照仍放行。修复复用现有资格hook/parser，保留明确已选身份并显示不可用原因，不偷偷换Agent或切手工模式。
- 范围：只改Work Inspector功能状态，不修改后端预检/权限合同或CSS。手工任务不依赖Agent资格查询；登记可用不承诺实时运行健康。
- 状态：138项相关回归、真实无浏览器ACP烟测、最终独立CR及1005项完整门禁通过；新exact浏览器CI待发布核验。新增4宽真实不同LOCAL_HOST环境fixture，验证全局READY但项目不兼容时禁用，切到兼容Agent才启动。

## AH-071 / P1：安全错误映射遗漏任务变量诊断

- S52 exact CI43322429744为117真实通过/8失败、140几何通过；其中4项是已知审批前置，另4项变量修复场景没有出现缺变量提示。S53 exact CI43323589612已修审批，现121真实通过/仅4个变量提示失败、140几何通过。
- 已读取S52精确artifact 13992891403四宽error-context并查看390截图：界面实际显示“任务操作失败 / 请求失败，请查看设置中的诊断信息。”。API安全白名单缺少TASK_PROMPT_VARIABLES_MISSING，导致真实响应降级；组件普通Error mock未覆盖此链路。
- 修复使用固定白名单文案，覆盖缺变量、变量已锁定、模板解析失败；不透传任意服务端message，不放宽E2E为泛化错误。真实Response envelope单测先红后绿，新exact浏览器CI仍须验收。

AH-069补充验收：7b8542b的CI43323589612中四宽已有Agent恢复全部通过；整体仍因AH-071为红，不能冒称整次CI成功。

AH-071冻结检查：3个白名单映射红转绿，API整文件18项及类型/lint/最终CR通过；保留原E2E精确提示断言，新浏览器CI待发布后核验。

AH-070/AH-071最终冻结树1005项完整覆盖、lint/types/build/QA10及独立CR通过，两个逻辑修复准备发布；实际浏览器仍等待新SHA，不提前关闭。

## AH-072 / P1：普通任务缺少审阅完成与返工入口

- 源码确认：Agent完成后任务进入WAITING_REVIEW，Overview“查看结果”跳往Work Inspector；当前React源无POST /tasks/:id/review调用，Inspector只有启动/取消/查看Session，不能验收DONE或反馈返工。后端APPROVE/REWORK合同已存在。
- 旧auth-and-project审阅测试所属describe已skip，不能视为当前主旅程覆盖。
- S55实施中：复用既有组件补明确验收、必填返工反馈、异步结果归属和竞争操作保护；先组件红测，再真实ACP首轮完成后的四宽审阅闭环。无CSS或未选视觉方向变更。

AH-068/AH-071当前验收：1bb768f / CI43330610456四宽原任务变量修复全部通过，安全缺变量提示和完整修复启动闭环已验收；整体仍因下列资格测试前置错误为红。

## AH-073 / P2：资格浏览器测试调用不存在的单条Agent路由

- S54精确CI43330610456：125真实通过/4资格前置失败，140几何通过；四项均GET /agents/:id返回404 ROUTE_NOT_FOUND，尚未进入资格UI断言。
- 路由仅公开GET /agents列表；返回字段足以按seed id取executable/argsJson。S54独立烟测使用正确列表，因此不能替代这段浏览器前置。
- 修复合同：改为列表查找并验证数据，保留不兼容Agent不可启动/切兼容Agent成功的全部断言，不增加无产品需求的后端路由。

AH-072冻结验收：74专项、真实PGlite/ACP完整两轮审阅烟测、1016项资源隔离完整覆盖及lint/types/build/QA10、独立CR通过。Worktree任务不走普通审阅，未知响应仅核对不自动重放；新四宽浏览器待新exact CI。

## AH-074 / P1：缓存会话切换后旧发送结果污染新草稿

- 实际WorkspacePage＋QueryClient缓存B＋路由切换红测确认：A发送未返回时切到已缓存B，A成功回执清空B的持久草稿；A失败会把错误串入B。Composer未按Session隔离内部异步状态。
- 同会话发送pending时textarea已有原生readOnly，因此“同会话边发送边编辑丢稿”候选不成立，未用fireEvent绕过只读伪造证据。
- S56实施：仅修会话归属及草稿初始化，保留正常发送成功清稿/失败保留合同。补真实四宽缓存切换E2E，延迟实际服务响应而不是伪造成功，无CSS/视觉方向变更。

AH-074补充：StrictMode首次挂载的已有草稿被初始空值effect覆盖亦有旧源红测，采用惰性读取修复。范围仅隔离当前编辑器归属；离开原会话后的迟到成功不负责清理原会话持久草稿，不承诺跨导航发送恢复或去重。

AH-070/AH-072/AH-073当前验收：8c15aac精确CI43333907247双绿，资格四宽及普通任务审阅返工完成四宽全部通过（133真实项/140几何）。关闭这三项当前切片；不关闭隔离Worktree审阅UX、跨实例派发或整体视觉重构范围。

AH-074本地验收：28专项、1021项资源隔离完整覆盖、lint/types/build/QA10、独立CR通过；真实四宽回包隔离E2E已接CI，本地仅收集/类型检查，待新SHA浏览器验收。

## AH-075 / P1：隔离Worktree结果无专属审阅闭环

- 当前前端只GET执行列表并显示分支/状态/错误，无专属review/rework/managed merge调用。普通Task审阅必须排除这类执行，不能用APPROVE绕过受管Git合并。
- 已有README v1.1与V0.2_WORKTREE合同包含中文审阅/合并入口，后端公共API已启用；因此属于现有核心入口缺失，不是新增未规划产品。普通Workspace Git读Project根目录，不能代替隔离工作区Diff。
- S57范围：已有REVIEW执行的只读专属结果、反馈返工和明确受管合并，复用现有组件；先红测，使用临时Git/PGlite/ACP验证，不操作真实Agent/NAS/生产项目。队列创建与更广泛生命周期另行规划。

## AH-076 / P2：移动会话隔离测试在抽屉挂载前等待链接

- S56 exact CI43337147964：verify成功，136真实通过/1失败、140几何通过。768/1024/1440真实回包隔离通过；390在selectSession首次等待rail链接attached失败，尚未发送A指令。
- 手机抽屉未打开前不挂载SessionRail；S56为避免桌面加载误判所加attached等待未兼顾该合同。按实际宽度先打开小屏抽屉，桌面仅等待目标链接可见，保留草稿/无误派发/真实ACP全断言。

AH-076补充证据：45f2591精确CI43342064221仍136/1，390实际截图没有辅助栏按钮而有“会话”Tab，原修正只改顺序仍不符合手机入口。现按手机Tab/平板辅助栏/桌面列表区分导航，不弱化草稿与Run断言，等待新CI。

AH-075本地专项：组件与页面77项通过，真实临时Git/PGlite/ACP烟测已成功清理。截断审阅禁止合并，明确checkbox告知全改动受管提交/基础分支合并且不push/不删除；已知合并拒绝须重读再确认，未知结果仅核对不重放。整仓冻结门禁进行中。

AH-075最终本地验收：77专项、1031项资源隔离完整覆盖、lint/types/build/QA10与独立CR通过；真实临时Git/ACP烟测通过且清理。四宽专属审阅返工合并等待新exact CI，不提前关闭。

## AH-077 / P1：普通任务无法从界面加入隔离执行队列

- 当前界面已有普通启动与既有Worktree审阅，却没有调用Task的worktree/queue入口，无法在UI发起隔离任务。后端READY入队、受管分支与Runner已存在。
- S58范围：同一BACKLOG任务合法转READY后入队，READY直接入队；仅已知无隔离执行、ACTIVE Git项目、项目合格Agent、非REMOTE_NODE目标。未知资格/目标/执行列表拒绝派发，不把入队承诺为实际开始。
- 后端持久任务变量默认保留；未知结果只查询原Task/Execution，不自动重发/回退普通启动。现有服务跨实例/跨tab普通start与queue竞争不在本片解决范围。

AH-074/AH-075/AH-076当前验收：77bc747精确CI43346474757双绿，141真实项/140几何。手机会话隔离四宽和隔离审阅返工合并四宽全部通过，关闭当前切片；更广泛跨导航发送恢复/隔离生命周期仍按各自边界保留。

AH-077最终本地验收：94专项、1057资源隔离完整覆盖、lint/types/build/QA10及CR通过；真实临时Git/ACP入队烟测成功清理。新四宽浏览器待exact CI，不提前关闭。

## AH-078 / P1：隔离任务缺少专属取消与停止结果核对入口

- S57为避免绕过受管生命周期，隐藏了普通Task取消；既有Worktree服务虽提供cancel，页面没有替代入口，排队或审批中的隔离任务无法在Work Inspector中结束。
- S59范围：复用现有组件提供专属取消动作。运行中只确认停止请求，不提前宣称已停止；创建/合并原子阶段不可取消，未知回包只查询原执行，不重放。按执行身份维护待处理状态，防止切换任务后重复提交或污染其他任务。
- 实施与回归进行中，尚未通过完整门禁或发布；仅隔离临时Git/ACP测试，不操作真实Agent或项目。

AH-078后端审查发现：cancel初读QUEUED/REVIEW后有await间隙，原transitionWithTask只按锁内当前状态验证一般转换，未限定本次取消初态。并发claim/rework可能已进入SETTING_UP/RUNNING，旧取消仍直接写CANCELED并释放槽。S59加入锁内expected-from护栏与可控barrier回归，不以UI禁用代替后端安全。

AH-077当前验收：36c45e5精确CI43349803859双绿，1057单测、48 fixture、145真实项/140几何，隔离入队四宽通过；关闭当前切片，不代表视觉认可。

AH-078最终本地验收：1078完整资源隔离覆盖/10原有skip、90前端专项、30后端相关项、lint/types/build/QA10和独立CR通过；最终构建后真实ACP权威终态烟测成功清理。首轮资源重叠失败保留，最终严格串行重跑通过。四宽待新exact CI，不提前关闭。

## AH-079 / P1：普通Task API可绕过隔离执行审阅与合并

- 隔离PGlite实际TaskService/Repository复现：Worktree REVIEW对应WAITING_REVIEW任务，经普通APPROVE直接TaskDONE而Execution仍REVIEW；普通REWORK另建1Session+1Run于Project根目录，Task与Execution的Session分裂。普通transition DONE/CANCELED也成功，仅改Task。
- 每例独立Project，持久关联Session与COMPLETED Run；使用stub Session控制器，无真实Agent/Git操作。不是仅从UI隐藏推测安全。
- S60范围：Worktree-owned任务普通start/review/manualtransition明确拒绝409 TASK_WORKTREE_MANAGED；副作用前检查及Task锁内最终检查，保留专属Worktree流程和普通任务。暂不覆盖跨实例普通启动Session原子预留或任意直接Session API的完整所有权。

## AH-080 / P1：旧隔离merge快照跨返工代际

- 源码审查：merge先读取run1，再await Project/Task；若另一次返工run2完成并回到REVIEW，旧请求仍可claim MERGING并以旧run1写finalRunId。需barrier复现和锁内run代际claim，另行切片，不混入S60。

### AH-001 / M1.2 追加启动准入证据

- 隔离PGlite+fake Session runtime：普通start创建Session后暂停，Worktree入队启动获胜；普通start随后拒绝却遗留READY Session。真实RunRepository允许该孤立Session另建RUNNING Run，同时managed Run仍RUNNING。证明持久层双Run准入，不冒称真实adapter双派发。
- 需要runtime副作用前的Task锁内原子Session预留/关联及故障恢复，不以S60入口guard冒充跨实例修复。保留为后续独立设计。

AH-079最终本地验收：1089完整覆盖/10原有skip、68专项、lint/types/build/QA10及CR通过；最终构建后两轮10次真实HTTP拒绝且完整快照不变，专用返工/合并照常完成。四宽待新exact CI；跨实例孤立Session与DirectSession所有权仍开放。

AH-080运行证据：S61隔离PGlite barrier红测已复现旧merge错误成功DONE，Execution.runId=run2而Task.finalRunId=run1。旧请求在初读run1后停住，真实service返工run2完成回REVIEW，再放行，不是单纯手动改DB状态。

- S61范围：Git之前原子核对原REVIEW的Session/Run代际，拒绝旧请求；同时核对当前Task/Session/latestRun及COMPLETED，不允许发现较新活跃Run仍执行merge。专用claim遵循Execution→Task→Session锁序，使用claim快照归属。
- 仍不保证UI读取Diff与请求之间的不可变审阅快照，也不拦所有外部文件写入；DirectSession入口及跨实例普通启动预留独立保留。

AH-078当前验收：54f5724精确CI43353585301双绿，1078单测/48 fixture、149真实项/140几何；取消请求不冒充终态且权威cancelled后释放队列四宽全部通过，关闭当前切片。

AH-080最终本地验收：1098完整覆盖/10原有skip、25后端/12UI专项、lint/types/build/QA10与独立CR通过；真实Git/ACP证明旧请求409且0Git调用/完整数据及Git快照不变，新明确请求正常合并run2。claim时检查最新已完成Run，不保证claim后的新DirectSession或外部写入；UI不可变审阅token仍独立范围。新exact CI待验收，不提前关闭。

## AH-081 / P1：Direct Session可绕过隔离阶段新增Run

- S62实际PGlite红测9项确认：已有Worktree的QUEUED/SETTING_UP/AWAITING_INPUT/REVIEW/MERGING/BLOCKED/DONE/CANCELED阶段仍可直接新增Run；RUNNING时错误孤立Session也可派发。旧RunRepository只限制Task取消与Session.taskId相等，未检查受管执行阶段/当前Session所有权。
- S62仅对Worktree-owned Task新增持久准入：Task→Session锁内读取全部Execution，不反向锁Execution，仅当前匹配RUNNING+Task IN_PROGRESS及项目/Agent/Session身份一致才允许，已存在活动Run不得重复准入。普通Task直接会话语义保留。
- 关闭审阅/合并中另开Run与managed孤立Session派发窗口，不等于清理遗留Session或实现普通启动的原子Session预留；RUNNING阶段仍无专用调用者令牌，完整派发预留另行设计。

AH-081追加独立证据：f6fcc53的同managed Session两个RunRepository实例并发create均成功，留下2个RUNNING；S62仅对managed会话在事务中检查活动/未知Run以拒绝重复准入。执行已绑定Session但Session.taskId丢失的持久不一致也须fail closed，不因缺Task绕过ownership；普通未绑定Session不受影响。

- RUNNING阶段直接调用抢先于专用startRun的调用者竞争仍无独占令牌；可能导致runner将忙碌错误误判BLOCKED的源码候选另留后续barrier复现，未在本片声称解决。

AH-079当前验收：d5325e7精确CI43355699706双绿，1089单测/48 fixture、149真实项/140几何；当前普通Task入口护栏关闭，DirectSession及原子Session预留各按独立问题跟进。

AH-080当前验收：f6fcc53精确CI43357553824的verify与真实服务/视觉证据双绿，关闭当前旧merge代际护栏切片；不可变审阅token及claim后新写入仍在独立范围。

AH-081最终本地验收：1111完整覆盖/10原有skip、lint/types/build/QA10与独立CR通过；真实Git/PGlite/ACP证明REVIEW/MERGING直接Run均409且无业务/Git副作用，合法专用返工与合并正常。断连仍占槽时新增拒绝回归，旧回调不能释放当前Run。四宽浏览器待新exact CI，不提前关闭。

## AH-082 / P1：专属启动失败覆盖竞争Run并错误释放隔离槽位

- S63两条PGlite barrier红测确认初次启动/返工均可被先落库的Direct Run抢先，原请求SESSION_RUN_UNRESOLVED进入无条件block，活动Run仍在而Execution/Task误变BLOCKED。
- 修复以Execution→Task→Session锁内检查启动前Session/Run代际、竞争Run及活动/未知证据；忙碌但未落库也不认定无派发。新REVIEW/终态回调赢家不得覆盖，终态赢家允许排队继续。
- 只解决错误释放与迟到失败覆盖，不实现专用调用者独占令牌、不补普通启动原子Session预留；更改不涉及视觉。79专项及独立CR通过，待完整门禁/烟测/新exact CI。

AH-081当前验收：e2e044a精确CI43364136994双绿，关闭阶段/身份/重复Run准入当前切片；RUNNING调用者独占未包含，AH-082仅修其错误释放后果。

AH-082最终本地验收：1133完整覆盖/10原有skip、79专项、lint/types/build/QA10及独立CR通过；最终真实Git/PGlite/ACP初次/返工barrier烟测均保持活动槽位和排队边界，权威REVIEW及fresh合并成功。新exact CI待验收；不将PGlite串行合同测试冒称独立Postgres并发锁实测。

### AH-001 / S64 两实例普通启动追加证据

- 独立PGlite及两个TaskService barrier确认，两请求在Task绑定前已各创建Session；第二请求随后INVALID_STATE_TRANSITION，但保留READY孤立Session。该Session通过真实RunRepository仍能新建RUNNING，普通预留和旧Session准入必须共同修复。
- 只用fake runtime；实际createSession/sendTurn双派发尚未实测。新专项方案TASK-START-ADMISSION.md仍为设计，AH-001跨实例预留保持开放。

AH-082当前验收：7b05581精确CI43367292783双绿，关闭错误释放槽位/迟到失败覆盖的当前切片；不是专用调用者独占。

AH-001 / S65基础：新增未接入runtime的attempt持久表及原子预留/CAS，21专项、1154完整覆盖/10原有skip及独立CR通过。问题仍开放；S66必须完整接入创建未知恢复、Run当前归属/原子移交、旧数据保守处理和最小核对接口，不能只启用reserve。

### AH-001 / S66 普通启动持久预留与恢复当前切片

- 已接入Task专属创建/首Run，Task/Session/attempt原子预留，调用前标记，Run/latest指针/attempt移交同事务。pending阻止手工转换和Worktree入队，旧/孤立Session不得直接新Run；Task会话独立continuation改为明确要求原任务操作，不静默脱离归属。
- 闭合创建close/shutdown撤销、reserve响应丢失、确定未调用释放与未知创建隔离。真实持久重开完整startup验证四阶段且零adapter重放；只读attempt接口可定位原尝试。
- 1186完整覆盖/10原有skip、lint/types/build/QA10与独立CR通过；真实ACP双实例START/REWORK分别只有一个赢家与一次合法创建，专用闭环到DONE，旧会话拒绝无副作用。浏览器待新exact CI。
- 不整体关闭AH-001：UNKNOWN人工核对/显式恢复体验、启动operationId幂等、跨进程runtime路由与独立Postgres多连接仍未完成。UNKNOWN被隔离不是“所有失败都能自动恢复”。

### Git 提交结果未知（2026-11-13 18:49 UTC）

状态：同挂载止损候选；完整操作级保护仍开放。真实隔离复现与边界见 `repros/git-commit-unknown.md`。当前 GitChangesTree 无 project/auth 操作身份，不跨卸载/路由/硬刷新持久；SHA 格式验证不等于操作归属。后续需持久操作键、并发/身份隔离及只读核对协议。不得通过 HEAD/message 相似就自动判定成功并解锁。

19:20 UTC Git未知结果：Provider/生产Tree跨面板与内部路由保护已进入候选；认证界面重现（包含auth-status读错误）、刷新/重新登录仍丢失内存记录，服务端幂等仍开放。已修复CR发现的提交成功但invalidate失败误提供retryPOST路径，错误仅允许只读刷新。详见git-commit-owner-design.md。

19:33 UTC 冻结全量查出GitChangesTree直接API违背展示架构合同，已迁回Provider adapter并保留原门禁。服务端持久恢复待实现，新增风险：readHead仅观测并发HEAD，不足以认证本操作精确SHA；详见git-authoritative-recovery-design.md。

### 2026-11-13 19:49 UTC Git持久性缺口进展

操作/资源claim休眠DB层已加入候选，完整保护仍未上线：缺认证查询/协议hash与资源身份派生、执行器崩溃点、legacy/worktree统一锁、前端marker恢复及真实PostgreSQL多连接验证。UNKNOWN锁无自动到期/释放，不能以重启或新key绕过；手工解除协议尚未设计完，不提供按钮。

### 2026-11-13 20:05 UTC 全写入口接入门

已完成休眠canonical resolver/coordinator及只读受权查询；真实生产写入仍未迁移。发现worktree merge catch任意失败还原REVIEW，接入UNKNOWN必须改为不可重试隔离；merge-tree --write-tree也需claim。队列缺持久owner、现有Docker目标语义和设备身份配置须明确。Agent/PTY外部Git为锁外并发，不能宣称全仓排他。

### 2026-11-13 20:19 UTC Worktree失败可能已写入

真实hook测试确认失败后已创建branch/worktree或修改index。已修复分类及编排：首写后UNKNOWN保持活动槽位，重启同样不能凭无Session放行。新queue持久owner/createop，历史null保留。未解决的是统一claim跨project别名、普通commit入口、旧ownerless行及人工确认解除流程；不要把本片project槽位防重试称全仓排他。

### 2026-11-13 20:36 UTC 请求身份与路径语义

已加未启用的client marker/三类写wrapper/strict协议基础，跨刷新闭环仍待接线。单纯服务端给legacy每次生成新key不解决回执丢失后重复提交；必须客户端持久key。额外发现Git pathspec magic/glob可扩大显式选择，正在修复literal-pathspecs并用真实Git验收，不放宽路径隔离。

20:37 UTC pathspec扩大选择已修复并通过4项真实Git回归；仅此路径修复已在生产调用代码生效，wrapper/marker完整闭环仍未接入。

### 2026-11-13 20:52 UTC 协调域不能伪装物理设备

没有可信硬件身份时用持久DB逻辑域并全DB串行，避免同仓bind mount不同路径绕锁；独立DB与外部Git仍不覆盖。已实现factory但未启用。域缺失/损坏或operation/claim不完整拒绝启用，不能生成新UUID解除未知锁。client恢复状态仅证明原operation，不证明当前草稿；GET新增认证scope绑定辅助校验。

### 2026-11-13 21:20 UTC 生产接线CR补缺

历史Worktree SETTING_UP/MERGING或明确UNKNOWN可能没有Git ledger。不能因为新表为空而生成新域后放行；启动检查同事务锁旧execution表，保守拒绝托管写，不修复/合成旧记录。已有合法in-flight时第二实例也可能拒写，接受保守可用性代价。正常Git global身份/hooks不应因隔离失效；共享环境只过滤ambient GIT_*重定向，保留正常用户配置。

### 2026-11-13 21:48 UTC 正常claim竞争不能变永久未知

已确认正常并发败方未获dispatch但没有可查询记录，导致marker永久404及Worktree错误隔离。修复要求保留败方明确REJECTED_PREWRITE/GIT_REPOSITORY_CLAIMED记录，持有方claim不动，旧ID不可重新派发；事务响应不确定仍保守UNKNOWN。历史已经缺失的记录不能凭猜测补造。Worktree同review固定merge ID经明确拒绝后仍不能直接重试，下一片需持久attempt generation与明确用户重试CAS，不可复活terminal旧key。

### 2026-11-13 23:01 UTC 提交请求本地协议预检

501路径、超长输入/无效HEAD及超过1 MiB的UTF-8 JSON在marker创建前拒绝，避免已知本地无效草稿进入永久未知。共享schema及body字节上限防止客户端规则漂移。历史已留下的缺失ledger marker不自动删除；服务器部署版本不一致、鉴权失效、任意400/404仍不能被推断成未执行。Worktree显式新attempt及观测HEAD文案继续独立待办。

### 2026-11-13 23:29 UTC 观测HEAD不是操作归属证明

普通Git回执现在明确区分命令成功和观测HEAD，不再暗示外部Agent/PTY并发写入下SHA必属于本操作。真实浏览器本地启动被socket权限阻断，四视口新门禁待精确CI。Worktree终态键重试仍未实现，禁止用随机UUID或仅错误码解锁，实施约束见WORKTREE_RETRY_PLAN.md。

### 2026-11-13 23:52 UTC Worktree固定终态键重试代码闭环

已实现持久attempt及严格CAS的新意图：明确持久PREWRITE后重新读取/确认可轮换，旧普通请求和旧retry不能派发新代际。缺失ledger、UNKNOWN、成功及已有错误标签均不能冒充新首次请求。DB/服务/UI回归与全量通过；真实浏览器/精确CI和PostgreSQL多进程故障验证仍分别待验收，不对历史无ledger执行自动修复。

### 2026-11-14 00:12 UTC retry证据进展与待核验风险

真实HTTP/Git竞争、显式retry一次merge、完整服务/磁盘DB重开及旧key保留草稿已通过。四视口browser同流程已纳CI，尚无实际浏览器通过结果。静态发现ProjectWorkPage仅在REVIEW或reviewPending时挂载审阅组件，MERGING缓存与pending完成交错可能丢失局部核对状态；未复现，禁止弱化新测试来掩盖。下一步应复现生命周期交错及跨路由恢复，必要时修正持久owner状态传递。

### 2026-11-14 00:34 UTC 生命周期风险已复现并修复

MERGING/pending交错卸载风险已用集成测试复现，不再只是推测。保留owner锁对应审阅组件，并跨路由保存不可变真实目标attempt，权威匹配才恢复。连续retry误捕获前驱键问题通过server dispatchOperationId解决；不存在根据404/错误标签解锁。最终全量1715通过/10跳过。保留非安全UX项：同页全局核对后局部按钮可能还要再核对一次；未宣称所有核对入口视觉/状态自动同步。

### 2026-11-14 00:45 UTC 真实 retry 截图人工复核

取回精确89ae0b7运行43532719381的真实服务证据包（artifact 14088448366），ZIP SHA256与GitHub digest一致；逐张查看1440/1024/768/390的worktree-explicit-retry截图。桌面审阅被放在窄右栏，滚动到合并确认时中央主区域大片空白、任务上下文离开视口；移动表单和技术说明过长。截图是在明确重读/勾选后、merge已断言enabled但尚未点击时捕获，不是pending状态，灰色主按钮不能归因于请求中。此为真实布局/层级问题，几何和流程通过不等于视觉验收；应将审阅任务提升为主内容，技术元数据和返工次操作渐进披露，保持既有安全确认合同。该截图来自上一发布，不冒充最新3e85b46的新截图。

### 2026-11-14 00:53 UTC 同页重复核对已修复

全局已验证未写入的证明与本地提交身份精确匹配后，可直接进入重新审阅；不再要求第二次局部核对。保留所有新意图确认及服务端CAS。负向回归与全量1728项通过，精确新浏览器CI尚待发布后运行。桌面审阅布局问题仍未解决，不用流程修复代替视觉优化。

### 2026-11-14 01:06 UTC 审阅空间分配已调整，视觉结果待验

桌面审阅主列、紧凑列表、滚动任务上下文和filled合并主按钮已实现；窄屏原有布局/描述位置不变。全量1733项和静态CR通过，不等于截图通过。待精确新CI检查实际sticky标题、宽度比例、横向溢出和真实重试流程，取回新图后再判断是否关闭布局问题。

### 2026-11-14 01:16 UTC CI队列时间竞态已修正

CI暴露旧测试把插入顺序误当queuedAt,id排序。相同时间与反序UUID已确定性复现；测试显式覆盖时间主序和ID次序，生产合同不变。全量1734通过/10跳过，待新提交精确CI。15ae209历史verify失败不删除、不冒充通过。

### 2026-11-14 01:32 UTC 桌面布局已有新截图验证，内容层级仍需改进

69efd21精确CI三job成功且已查验真实截图：桌面短列表/主审阅与滚动标题修复生效，不能再说本片只有静态验证。但新390图仍显示长SHA和合并前返工框让主要确认落在下方。下一片保留完整安全披露，调整主要/次要操作次序与技术信息展开层级，需独立新图验证。

### 2026-11-14 01:55 UTC 项目列表唯一内容默认折叠

真实69截图与baseline直达流程证明，仅TEST项目的列表默认隐藏唯一内容。已实现当前页无STANDARD时自动展开，并保留混合列表默认折叠及显式用户选择。程序toggle不污染偏好，过滤/分页/卡片切换保持。全量1743通过，真实键盘与四宽双主题新图待CI，不能把jsdom click等同于浏览器Enter/Space。

### 2026-11-14 02:34 UTC 服务端反馈与当前许可混淆

REVIEW中的保留errorMessage此前以“需要处理”展示，容易与重新审阅后的新尝试许可混淆。本片仅中性标记“隔离执行反馈”并完整保留原文，不从状态/错误码判断未写入或已解决；UNKNOWN继续锁定并提供原操作核对。真实新图仍需精确CI验证。

### 2026-11-14 02:48 UTC 首页内容态密度

字体真图确认长事项约140px，额外详情整行与700粗标题占据注意力。新候选按正文/操作分层并保留完整内容可达，不降低五项数量。只有新的精确CI截图才能确认密度和层次改善，未提前关闭视觉问题。

### 2026-11-14 03:03 UTC 隔离差异缺少行类型层级

实际查看b293537的1440/390真实截图：diff-first已成立，但所有patch行同色，新增/删除/hunk无法快速扫描。显示层候选复用现有success/danger/accent token，保留原始字符与+/-符号，不转换HTML、不更改确认和Git操作。新截图未验收，不能因静态测试关闭问题。

### 2026-11-14 03:34 UTC 精确 CI 的首页断言与深色字符串对比

e0f10ea / CI43549132495：真实服务与独立 axe 成功，但 fixture Home 四宽因旧测试将正文视为 Link 子节点失败；当前正文/操作分层正确，测试需分别验证正文和动作可访问名/目标。深色 TSX fixture 另在首次尝试发现 string.ts 默认 CE9178 在删除字符背景6f1313上仅4.46:1，虽重试通过仍为真实视觉缺陷，不应当忽略。候选只提升该 token 为暖色F4C7AF；保持删除背景、其他语言与 axe 门槛。新精确 CI 未结束前不关闭。

### 2026-11-14 03:47 UTC 普通任务启动核对出口与恢复归属

S66已接入持久启动预留，旧“缺claim”描述是历史设计依据，不是当前事实。但前端没有调用已有GET start-attempts，普通启动失败后用户不能查看原尝试。候选增加任务详情只读查询、历史阶段/折叠身份、auth+project+task迟到回包隔离；空/404/失败/UNKNOWN不解释未执行，不重试或解锁。

另以独立memory PGlite、两个真实Repository复现：A reserve/markCreateAttempted后，B recoverAfterRestart把A标为UNKNOWN，A recordSessionReady返回false。第二实例startup可误伤仍活跃实例是待解决可用性风险；仅数据库双Repository证据，不称独立PostgreSQL进程或真实Agent双派发。后端归属/fencing须另设计，不通过跳过恢复或超时释放绕开。

### 2026-11-14 04:02 UTC 启动恢复误伤已在完整服务边界复现

两个实际TaskService/SessionService加完整recoverRuntimeAfterRestart与FakeAgentAdapter barrier：对照A正常RUN_ADMITTED/create1/send1；B恢复介入后A UNKNOWN/Session DISCONNECTED、create1/send0/close1，B零创建。独立memory PGlite与临时空目录，无真实Agent。端口冲突发生在恢复后，不能提供互斥。修复方案见RUNTIME_OWNERSHIP_PLAN.md；后端仍未修，不使用TTL或强制释放UNKNOWN掩盖问题。

### 2026-11-14 04:33 UTC 归属候选 CR 与真实视觉未决项

- 单权威runtime候选已经覆盖启动前排他、失效撤销、健康关闭失败保锁，但仍未提交；CR继续发现并修复在途provider/Approval/Worktree merge生命周期空隙。不能以关闭HTTP socket代替业务Promise退出。真实PG隔离CI刚添加，尚未执行；网络分区/外部进程fencing不在本片承诺。
- 精确82c5421 CI表明可见mobile TSX删除token实际仍灰色，原先门禁修正不是产品修复。Monaco原pane已词法着色而inline删除view-zone仍旧token；候选通过公开colorize预载语法器再挂载Diff，未放宽颜色门禁，真实CI待验。
- 实际698fc01启动记录1440/390截图发现面板贴边及焦点轮廓裁切，候选补内距/焦点几何与字段层级。新截图未产出前不标记视觉完成。

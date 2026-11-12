# 任务执行台账

更新时间：2026-11-13（UTC+08:00）。分支 `dot/agenthub-rebuild`，接手基线 `608fdd4`。

## 当前状态

| 范围 | 最新事实 | 后续动作 |
| --- | --- | --- |
| 已验收发布基线 | `62b821d`最新CI已双绿；已发布resume修复可按该SHA核验，AH059另片实施中 | 不合并main、不部署 |
| 本地最终门禁 | S40 lint/types/build、115文件880单测通过/10跳过、QA10通过；S34旧fixture失败及e866真实失败记录保留 | 新真实CI未完成前不宣称浏览器通过 |
| 当前CI | `6ab6ef5`真实87、`ce6994b`真实105、`c69e88c`真实113均双绿，均通过140几何检查 | 02eb01b real116/140通过但verify红；2ecf46f verify856单测/48fixture与real116/140均绿，artifact实算SHA256通过 |
| 已知前轮失败 | 74f49ba/c78905f的Esc故障已修；17566/70c838/4156787的Agent容器边缘断言已用原生IO取证修正，095485c通过 | 原红灯与依据保留在下方历史，不隐去失败 |
| 视觉状态 | 用户明确否定现有整体样式；已读设计资料并提供三个完整概念，用户全部否定（第二个仅稍好），正在重新探索 | 暂停AH049/AH051等旧微调，不能以测试绿称设计成功 |
| 下一重点 | 三个方向均未选定，重新探索；期间完成AH054真实性与AH056卸载回调修复并重新验证 | 保留所有授权/未知结果/生命周期合同，暂不实施任一概念 |
| 仍有限制 | 本地Chromium socket限制；真实NAS/用户Agent/独立Postgres多连接未验收；历史Cookie日志未清理或撤销 | 保留明确边界，不声称完整发布就绪 |

## 运行记录

| 时间（UTC+08） | 切片 | 动作与结果                                                 | 证据/限制                       |
| -------------- | ---- | ---------------------------------------------------------- | ------------------------------- |
| 2026-11-12     | M0.1 | 创建干净开发分支并并行审查                                 | 无用户未提交改动，无 NAS 操作   |
| 2026-11-12     | M0.1 | 确认任务目标丢失、Prompt选择不生效、创建重试和目录选择缺口 | 详见 ISSUES.md；部分仅源码证据  |
| 2026-11-12     | M0.2 | pnpm 11.11 frozen install 成功                             | 729 lockfile 条目供应链检查通过 |
| 2026-11-12     | M0.1 | 建立六份 Markdown 工作文档                                 | 尚未产品完成，后续持续更新      |

## 后续接续清单

1. 检查当前 Git 与工作者，避免同时运行多份重型测试。
2. 补齐基线结果，失败区分产品缺陷与执行环境限制。
3. 每个问题先测试复现，再实现、复测、独立审查。
4. 记录提交与远端核验；若 CI 未完成，不标为已验收。

### 第一轮基线更新

- lint、typecheck、build 通过；完整 unit 套件仍运行。
- 独立真实 HTTP + PGlite + fixture ACP 已复现 AH-001、AH-003、AH-004 和 AH-013 的实际行为。
- 当前浏览器工具连接本地服务失败（网络命名空间隔离）；不宣称视觉验收通过。
- 下一切片 M1.1：为主目标+补充说明+验收标准增加回归，修改共用指令构造逻辑。

### M1.1 实施检查点

- 基线全量：75 个文件通过，1 个文件失败，4 个文件跳过；334 项通过、1 项失败、10 项跳过。失败为 presentation architecture 对 FileInspector API import 的约束，尚未关闭。
- AH-003 初始/返工两条强化断言在旧代码失败；已用共享构造器保留目标、说明、验收，新增空说明和多行回归。
- 文档提交 c5a797a 已在本地；远程推送因明确发布授权不足被拒绝，未执行。继续本地工作，等待用户决定，不通过其他工具绕过。

- M1.1 本地实现通过 6 项 TaskService 测试、全仓 lint/typecheck/build；独立审查无阻塞。旧代码的初始与返工目标保留断言均失败。真实 HTTP 复测待补，当前尚未远程发布。

### 发布与验证更新

- 用户已明确授权及时 commit/push 独立开发分支。远端文档 a7002b8、任务目标修复 4ec0e49 已通过 fetch 验证，代码树与本地一致。
- AH-016：FileInspector 改从独立 api-error 模块导入错误类型，保留原架构断言，4 项架构测试通过。
- 当前全量 76 文件、337 项测试通过，10 项跳过；lint/typecheck/build 通过。跳过项不是已验收。
- 仓库 real Playwright workbench 四项均在 Chromium 启动阶段遇到 socket Operation not permitted，页面断言未执行；不能按产品失败或视觉通过计数。
- AH-012 已以真实 PGlite 复现两个并发 Run 留孤儿记录；隔离修复准备中，尚未集成。

### M1.2a 并发 Run 准入

- 真实 PGlite 回归复现旧代码并发发送持久化两个 Run、仅一个实际发送、另一个成为 RUNNING 孤儿。
- 修复在首个 await 前按 Session 获取准入，finally 释放；重复请求明确拒绝，不排队重放，不阻塞其他 Session。
- 23 项 Session 测试通过，包括重复拒绝、启动前失败后显式重试、不同 Session 并发。
- 集成后全量 340 项通过、10 项跳过，lint/typecheck/build 全通过；独立后端审查和集成差异复核完成。
- 这是单服务实例准入，不是跨进程幂等；QUEUED 部分持久化、close/resume 竞争仍保留为独立问题。

### 第二轮审查与验证

- b562875 已发布并 fetch 核验；源码树与本地测试树一致。远端 CI 43194406440 进行中。
- 独立真实 HTTP 复测 AH-003 通过；另复现 AH-017 同一任务并发启动留下第二个孤立Session，实施独立任务级准入修复。
- `test:qa` 6 项通过；CSS预算与release版本真实性门禁因现有CSS超限和视觉manifest不完整失败，分别登记 AH-018/019，没有跳过或调宽阈值。
- AH-005 已通过真实 HTTP/WS/PGlite 复现注销、改密、token撤销后三种旧连接仍收数据，修复在隔离工作树进行。
- AH-001 前端部分成功恢复在隔离工作树实施；不把未完成的持久幂等视为已解决。

### M1.2a 任务级补充保护

- AH-017 独立真实 HTTP/PGlite/fixture ACP 复测通过：并发任务启动返回 201 + 409 TASK_NOT_READY，只有一个关联 Session；不再留下失败方孤立 Session。
- 8 项 TaskService 测试通过；全量 342 项通过、10 项跳过；lint/typecheck/build 通过。
- 范围限定同一 TaskService 实例 startTask；多实例、并发返工、Session创建后DB错误仍需后续处理。

### M1.2b 连接授权生命周期

- AH-005：连接改用可撤销授权租约，注销、改密、撤销 token 后关闭匹配旧连接；过期与延迟 replay 在发送前重新检查，释放连接租约。
- 8 项真实 HTTP/WebSocket/PGlite 回归通过，包含健康连接隔离、认证竞争与延迟 replay；terminal input 使用 stub，仅证明撤销后的 HTTP 请求不会到达输入方法，不声称测试真实 PTY。
- 全仓 lint/typecheck/build 通过；全量 350 项通过、10 项跳过。源代码审查与集成差异检查完成。
- 范围为同一 AuthService 实例；不关闭底层 PTY，不包含多进程直接数据库失效传播。
- ff160132 已发布真实服务浏览器 CI 与 140 张基线截图/几何完整性门禁。尚未取得此提交 CI 的完成证据，不把门禁配置等同视觉验收。

### CI 实际结果补充

- b562875 的浏览器 E2E：42 通过、6 失败；四视口 Workspace 工具事件分组断言与 1024/768 导航断言失败，独立定位中，没有删除断言。
- ff160132、76b7ce6 的 CI unit 断言全部通过，但均出现 Workspace 延迟 RAF 调用 scrollTo 的未处理异常，故整个 job 失败；AH-001 集成全量亦复现，374 断言通过不算门禁通过。
- 为 verify 新增 always 上传 Playwright report/test-results，保留 7 天，以免失败截图与 trace 丢失；仅测试产物，不包含服务器数据库。actionlint/配置检查通过。
- 76b7ce6 真实服务截图矩阵仍执行中，尚无完整性或视觉验收结论。

### M1.2b 恢复流程与认证日志、滚动生命周期修复

- AH-001 当前弹窗内恢复：已创建任务保留身份，未知结果不盲目重试；关闭、切项目、认证失效撤销迟到操作所有权；启动返回须匹配原项目/任务/Agent。24 项 React 回归通过。持久操作 ID、刷新/重开持续恢复仍开放。
- AH-022：第三层平滑滚动 RAF 以前未纳入清理；修复跟踪/取消并绑定 session.id，旧代码两项失败，修复后四项通过。JSDOM 提供位置/滚动事件的明确实现，而非吞异常。
- AH-023：统一日志脱敏包含响应 Set-Cookie，并强制应用于注入 logger 的 HTTP 子 logger；真实 HTTP 旧代码泄漏断言失败、修复后通过，正常请求日志保留。独立 CR 无阻塞；不声称历史部署日志已清理。
- 集成最终 lint/typecheck/build 全通过，79 文件、378 项测试通过、10 项跳过。构建使用 workspace-concurrency=1，完整测试 maxWorkers=1，以避免多个隔离工作树同时消耗资源；此前资源竞争退出 137/worker lost 的运行不计通过。
- 真实 CI 的新鲜 140 截图证据已读取并在 VISUAL-BASELINE.md 分级记录，首页动作优先重构准备中；发布后继续检查确切提交 CI。

### 浏览器门禁根因修复

- AH-021：紧凑导航保留可访问名称与目标，但无可见文字；工具事件已按独立行渲染。更新过时断言为精确有序目标/事件 ID/状态/展开内容，并新增实际 DOM 回归，不以放宽断言隐藏功能失败。
- 真实 E2E 对话标题改断言实际 Agent 对话区域、日志与空态；Git 回执失败已复现为临时仓库缺少持久本地身份。仅给一次性测试仓库配置身份，仍检查真实 HTTP 成功、HEAD 提交内容、所选文件和干净工作区。
- 集成验证 11 项针对测试通过，lint/typecheck 通过；Playwright collection fixture 48 项、real 14 项成功。本地 Chromium 仍无法启动，新提交 CI 才是浏览器执行结果。

### M1.3 Prompt 与 M1.4 项目选择、M2.1 首页首切片

- Task 与明确选择的 TASK_PRIMER/VERSION 绑定同事务写入；生产标签/最新版本只在选择时解析，后续标签移动不改变任务固定版本。保留主目标、补充说明、验收及 Goal。
- 启动前检查 Prompt 缺失变量，缺项不会创建 Session/runtime；六项真实 PGlite/HTTP/Session 回归覆盖原子回滚、项目范围、固定版本、来源与重试。
- NewWork 增加预览与变量输入，预览严格验证形状及固定版本；改变量后必须重预览，迟到/跨项目/认证失效结果丢弃。47 项 React 回归通过。
- 不持久化变量值：无 Agent 且填写变量时明确阻止创建，防止静默丢失；可清空变量仅保存模板绑定。继承 Project/Agent 绑定变量输入、延后启动的变量持久化仍开放，不声称 PromptOS 全面完成。
- 添加项目支持授权根目录、逐级浏览、返回、仓库候选、精确路径预检；禁止任意手写路径。22 项组件回归覆盖切目标、迟到响应、部分失败、认证失效与取消。四视口真实浏览器测试加入 CI，尚待执行证据。
- 首页移除零值 KPI 与重复大空卡，改为行动优先、待处理事项、最近会话和项目；超过五项可展开，全部归档不误导新建工作，全局 Agent 就绪不冒充项目可用。六项渲染回归通过，新版实际像素尚待 CI。
- 最终集成：lint/typecheck/串行 build 通过；84 文件、439 项测试通过、10 项跳过；QA 辅助六项通过。CSS budget 仍因原 Workspace 19809 字节、8 个 important 失败，未放宽阈值。首次 pre-build focused 失败来自旧 @agenthub/db dist，不计通过；构建后的完整运行已覆盖新事务方法。

### 项目级 Agent 准入、导航与 Workspace 清理

- 增加项目级只读 Agent 注册资格 API，与运行时复用 enabled/status/工作区映射判定，保留 Docker 跨 target 映射。接口不启动容器、预检或创建 adapter；明确 `REGISTERED_STATE`、`livePreflight:false`。
- NewWork 仅自动选服务器判定可选择的 Agent，明确启动时还需检查；加载/错误/非法响应不猜测，可保留“稍后选择”。变为不合格的已有选择不会悄悄替换。针对性 61 项通过。
- 主导航按完整路径分区匹配，Infrastructure 优先；账户入口使用真实用户名/访问模式并进入设置，移动端点击关闭抽屉。针对性 29 项通过。
- Workspace 清理死局部选择器及无必要 important，未拆文件规避预算，详见 WORKSPACE-CSS-AUDIT.md。分支未知显示“分支未记录”，不推断非 Git。
- 新增真实 NewWork Prompt 四视口流程及无 Agent 模板绑定流程，验证 Task/Run/固定版本/上下文哈希，已加入 CI 显式文件列表。真实浏览器收集 23 项（含现有 legacy 项），不把收集成功当执行成功。
- 最终 lint/typecheck/串行 build 通过；86 文件、482 项 unit 通过、10 项跳过。QA 辅助 8 项通过，CSS budget 通过；release manifest 完整性仍开放。
- CI d430519 的真实服务 job 已通过全部五项及 140 图几何门禁；fixture 为 44/4，已根据截图/trace 修正回到最新交互场景，待新提交实际执行。

### M1.2c 完整工作要求与短标题

- 新建 Task 将完整多行要求和补充上下文保存到 description；列表标题独立可编辑，自动摘要首行最多120 UTF-16单位且不截断Unicode码点。全文从不静默截短，100000总预算包含分节标签，超限显式阻止提交。Goal保留原240/20000限额，不改变领域语义。
- 首次执行与返工共享“任务说明”构造，保存的全文不被短标题替代。现有恢复/版本预览/草稿冻结仍生效；真实Prompt E2E同步断言新全文契约。
- 最终 lint/typecheck/串行build 全通过；87文件、489测试通过、10跳过（174.43秒），真实Prompt浏览器收集5项成功。本地Chromium限制不变，发布后等待精确CI实际浏览器执行。

### M2.2 项目渐进筛选与内容态真实视觉门禁

- 手机默认只显示搜索、筛选控制和紧凑视图切换；次级状态/类型/排序/语言展开显示，活动条件计数含非默认排序。清除条件不重置视图，折叠/换宽不丢筛选，桌面条件常显；TEST项目分组保留。
- 三项组件回归通过；新增四宽双主题真实API筛选流程，含手机↔桌面换宽保留条件及三阶段截图。新增Home正式项目、7事项、3会话的四宽双主题内容态验收和实际中文glyph命中证据，不能把手动任务状态样本称为真实Agent执行。
- 修复Home fixture旧文案定位为当前区域内全部会话/待审阅动作精确契约；真实设置导航改exact，保留实际路由/标题断言。
- 最终 lint/typecheck/串行build通过，88文件、492项测试通过、10跳过；新真实浏览器collection9项、fixture48项，新增/修改E2E独立Bundler模式typecheck与lint通过。NodeNext单文件检查不匹配项目Vite/Bundler的axe-core默认导入，未修改生产依赖掩盖此模式差异。真实Chromium执行仍等待发布后CI，不将collection作为视觉通过。

### M1.2d 返工、批准与手动状态单实例准入

- Task.start/review/manual transition共享同步准入，首次await前保留操作资格；内部repository迁移不重入服务guard。重叠请求明确409，避免将过期意图排队执行；生命周期回调不加锁，避免同步完成死锁。
- 旧源四项真实PGlite竞态回归失败（重复返工、返工与批准、start/rework与CANCEL），修复20项TaskService/Prompt专项通过；创建失败释放准入的安全回归也保留。
- 这只限制同TaskService实例，未提供分布式租约；部分持久化失败回收和旧Run所有权单独实现。
- 最终lint/typecheck/串行build通过，完整497项测试通过、10项跳过，浏览器行为无变更。CI仍按精确提交继续追踪，不把专项通过等同部署验收。

### M1.2e 旧Run回调所有权与Workspace实际布局契约

- 任务生命周期回调改为数据库事务内锁定当前Task，验证持久Run→Session→Task、项目、assignedAgent、当前sessionId及匹配终态，失配/缺失/迟到回调无副作用；不采用调用方自报Session身份。callbacks不等待启动准入，以免同步执行完成死锁。
- 旧源5/5真实数据库所有权回归失败；修复后所有权/TaskService/Prompt共25项通过，server/db类型及lint通过。原TaskService测试fixture现在创建真实合法Session/Run，而不是放宽生产校验接受虚假Run。
- 61176 Workspace实际证据：1024 rail285px、对话left299；768 rail238px、对话left252，符合原medium并列辅助栏设计，d430截图相同，非本轮CSS清理回归。测试改验证宿主/栏间距/对话可用宽度与关闭后的全宽恢复，保留文件交互/重载状态；1440原历史不足仅101px，提供明确长工具输出且仍要求滚动范围>120及真实跳转到底部。
- Workspace E2E单文件lint/typecheck及48项收集通过；真实浏览器执行待新CI，不以此宣称视觉通过。
- 独立CR无阻塞，补充Agent错绑与四种终态/回调不匹配无副作用回归；最终89文件、507测试通过、10跳过（183.37秒）。lint/typecheck/串行build通过，补测后类型检查与全量测试再次通过。PGlite证明迟到/错绑与事务行为，不冒充多连接并发压测。

### M2.3 归档状态语义与统一字体token

- 实拍归档项目误显示“状态”且带警告色；补齐ARCHIVED的“已归档”和中性gray映射，Pill/Dot两条回归先红后绿，真实Projects四宽双主题增加精确徽章断言。
- pinharness的--font-sans复用已有--ah-font-sans，正文/标题移除重复fallback覆盖，保留mono和特殊展示字体；Home h1明确650字重，不新增字体包或CDN。真实字体证据继续核对中文fallback，并要求现有英文Agent字形由自带Geist实际绘制、标题computedweight正确。
- 最终lint/typecheck/串行build通过，89文件、509项测试通过、10跳过（175.52秒）。修改E2E单独lint/Bundler类型/9项collection通过；新字形与像素效果待CI，不称跨平台中文字体完全统一。

### M1.2f 服务端创建幂等与M2.4移动事项全文

- 新增0006操作账本迁移，带operationId的Task创建按服务端认证范围和规范hash幂等；Task/固定Prompt绑定/账本同事务，重放不重新解析归档资产。GET恢复不返回正文或变量、no-store、404不等于未执行。详情见CREATION-RECOVERY.md。
- 同账户跨登录、跨身份隔离、同key异内容并发、UUID大小写、失败回滚、资产归档重放、旧客户端兼容及旧库升级/关闭重开通过；人工reset只更新同项目计划和警告，未执行用户数据清空。独立CR无阻塞；真实Postgres多连接、浏览器持久恢复、start幂等仍未完成。
- 移动Home待办标题/说明各2行，实测裁切才显示独立详情按钮，支持键盘展开全文；保留原href、状态动作、5/7总列表。短行保留底间距；字体完成/resize重测并在卸载时撤销迟到回调。桌面不截断，不把详情按钮嵌套在链接内。
- 最终lint/typecheck/串行build通过，91文件、523单测通过、10跳过（190.26秒）；QA辅助10项通过。修改真实Home E2E独立类型检查及collection通过，新密度像素/键盘交互待发布后CI。

### M1.2g 浏览器持久创建恢复与 M2.5 项目归属选择

- 创建前持久化 IDs-only 操作线索；按明确账户/本地信任身份和项目隔离，不写正文、变量或凭据。刷新/重开只查询原操作，不自动新建、转换或启动；404仍保留未知状态。
- 同页保留原冻结请求，同编号显式重试只恢复创建结果，成功也不自动启动。POST发出后的任何未知错误均不自动换编号。坏UUID、错项目/操作/Task、损坏存储、阶段进阶和认证失效均阻止错误导航或覆盖记录。
- 删除本机线索需单独确认重复创建风险；只删除当前身份且原文未变化的已观察记录。存储失败时不发新请求，删除失败后重开仍阻断。localStorage不是跨标签锁，不保证不同编号请求互斥。
- Home多活跃正式项目不再默认选第一个，而是键盘可操作的名称+目录选择；单项目显示目标，TEST/归档不混入。选择前读取最新缓存且刷新/错误时阻止选择。
- 新增真实服务恢复8项和项目选择四宽双主题8项，加入CI显式列表。本机浏览器仍受环境限制，实际故障注入/像素验收等待新CI。
- 最终集成 lint/typecheck/串行build通过；93文件、551单测通过、10跳过（187.90秒），QA辅助10项通过。三份新/修改真实E2E独立Bundler类型通过、17项收集通过；收集不是浏览器执行，待精确新HEAD CI。

### M1.2h 同Session最新Run所有权

- 0007仅新增可空latestRunId；Run创建与指针更新同事务，失败整笔回滚。创建和Task终态回调都按Task→Session加锁，在锁内验证最新Run和原持久关联，禁止旧Run覆盖新Run；不依靠可相同的startedAt或随机UUID排序。
- 历史会话指针保持NULL，旧Run终态不推进Task，需要核对后正式恢复/返工；不静默推断历史归属。若R1先完成Task转换，后续直接Session发R2仍保持原Task状态，此处不擅自增加自动重启语义。
- 独立CR无阻塞；旧源码新增7例全失败，修复后所有权/回滚/迁移11项及Task/Prompt/Session53项通过。迁移验证升级/重开/重复执行保留数据；PGlite并发调用串行化不能冒充独立Postgres连接竞争实测。
- 集成生产改动的lint/typecheck/串行build、95文件562测试（10跳过，198.50秒）、QA10全通过。补充真实SessionService事件屏障回归：Session READY后暂停Task observer，实际启动R2，再释放R1；与callback-first对照。初次两例因测试Git探针仅两次返回、第二轮耗尽而失败，不计通过；补齐四次返回后两例通过，暴露的非Git收敛风险另立项，不掩盖。
- 修正测试Git探针后完整SessionService25项、server类型和lint通过；服务级两条屏障用真实ControlledAdapter事件验证新Run先提交/旧回调先完成两种顺序。未把测试替身称为真实付费Agent。

### M1.2i 无Git终态收敛与M2.6 Agent真实性

- 合法无HEAD不再执行空gitAfterSha更新，Run完成可继续将Session置READY并通知Task；真实probe异常仍显式走既有错误路径。旧源一例失败一例对照通过，修复完整Session27项通过。
- 实拍Agent卡片能力重复/虚构，改只映射明确true的嵌套能力与兼容别名；false/空对象/字符串不当支持。整卡不再伪装Agent详情链接；独立服务器诊断指向控制面环境，名称与页面说明一致，保留44px键盘焦点目标。
- 新真实API用例验证known/unknown/false三类已注册Agent的实际GET能力、四宽双主题、键盘入口、无误导航/横向溢出/console错误；本机仅类型/收集，实际像素待新CI。
- 最终集成lint/typecheck/串行build通过，96文件571项测试通过/10跳过（195.53秒），QA10通过；Agent真实E2E独立类型/collection通过，补充实际诊断目的页范围可见断言。独立CR无阻塞；能力只证明适配器上报与UI一致，不冒充供应商能力执行测试。

### M2.7 Prompt空库与共享弹窗键盘

- 实际Prompt移动空库重复占位/按钮裁切，改真正空库仅显示单一创建CTA，不应用目录局部滚动与680px两栏占位。筛选无匹配不等于空库，选中编辑器保留；加载/错误仍明确。5专项通过，新增四宽双主题真实创建/取消/筛选/返回门禁。
- 74f49ba真实恢复8项成功；Home选择的8个Esc失败是产品缺键盘关闭，正在共享FormDialog修复，不删断言。恢复截图当前仅默认浅色四宽，不误写成双主题已验收。
- 共享弹窗改用仓库已锁定的Radix焦点/顶层事件原语，保留backdrop不关闭，pending确认禁止X/Escape；独立实例和读屏隔离覆盖嵌套/同时打开/快速重开。CR发现body portal与Select原z100冲突，统一modal1000、popover1100，并加入真实命中点击断言。真实验证仍待CI，不把jsdom焦点测试当绘制证据。
- 首轮整体S22 lint/types/build通过，但测试4失败/581通过：旧App/product测试仍要求modal打开时背景可访问，与新增aria-hidden隔离冲突；正在保留背景DOM/关闭后恢复的契约修正测试。没有将失败批次报告为通过。
- 实拍恢复按钮缺少间距，使用已有8px/wrap行动组并弱化移除；行为与二次风险确认不变。恢复真实矩阵由四宽浅色扩至四宽双主题（12测试总计），新的深色及按钮层级像素等待CI。
- 最终S23集成lint/typecheck/串行build通过；100文件587单测通过、10跳过（201.02秒），QA10通过。背景旧断言修为保留原DOM/项目与表单合同，同时验证modal开启时背景不可访问和portal位置；未删功能断言。修复后的6文件35专项通过；两份真实Prompt/恢复文件独立类型与20项collection通过，包含实际Select命中点击与焦点验证。新真实CI和像素仍待发布后执行。


### M1.2j Run 准备失败与未知派发（第一切片）

- Run 插入后的消息/输入关联/启动状态持久化异常，只有在 sendTurn 尚未调用时才能归为准备失败；先保留恢复标记，通知当前 Task/Worktree 并恢复 Session，全部成功才标为已收敛。恢复未完成时阻止新 Run，异常不输出 SQL、正文或适配器原始原因。
- sendTurn 调用后拒绝、ack 保存失败或后续执行绑定失败均为结果未知，不盲目 FAILED/READY/BLOCKED，也不自动重放；权威完成回调可能先到，不能覆盖其结果。
- 独立 CR 拦截并修复 Worktree 未知派发丢失新 Run 关联：持久关联按 Execution→Task→Session 加锁，校验 latestRunId 与归属；取消独立解析真实新 Run，取消请求尚未收到权威终态不释放队列。初始、返工、完成竞胜和绑定写失败均有专项。
- 原有启动恢复已处理 QUEUED，早期台账判断已纠正。若第一笔恢复标记写入失败，完整 startup 会将活动 Run 改 SERVER_RESTARTED，不能保证此场景的持久隔离；普通 Task 启动恢复仍需第二切片。AH-015 保持开放，不把新对象模拟重启当完整启动验证。
- 隔离工作树 83 项定向、db/server 类型、lint 通过，独立复审无新增阻断；集成全量lint/types/build通过，101文件633单测通过/10跳过（213.16秒），QA10通过。

### M2.8 精确 Agent 默认设置管理

- Agent 卡片新增明确管理入口，详情按唯一 Agent ID 读取，不回退列表首项；执行环境显示实际类型/ID，已保存能力不冒充实时探测。只修改既有 API 支持的默认模型/模式，不提供未经实现的启停、删除或专属诊断。
- 默认字段 trim 后空值为 null；只影响后续会话默认选择，供应商支持不保证。服务端没有 revision/CAS，页面明确最后写入覆盖，不宣称并发编辑冲突已解决。
- 保存冻结 Agent/目标身份及字段，错误或丢响应保持未决，不自动 PATCH 重试；只读核对后显式采用。CR 发现错目标 GET 恢复风险，已改目标不一致锁存身份异常，禁止假称匹配、采用或继续保存。卸载、认证切换撤销迟到结果所有权。
- 30 项定向、web 类型和 lint 通过；新真实服务 E2E 九项加入 CI（四宽双主题读写+刷新，以及实际保存后丢响应的只读核对）。独立E2E类型与9项收集通过，实际浏览器和像素验证待新 HEAD CI。

- 已发布7bbead8精确CI run43217804652双绿：verify587单测/10跳过、48fixture浏览器；real52真实浏览器及140几何截图检查。独立下载artifact13944394856并核对SHA256，实际查看Prompt/Select、Home选择、深色恢复和Agent能力截图，未见本轮阻断。Prompt390空库页头仍有约180px留白，另列P2密度改进，不泛称全产品完成。


### M2.9 Prompt 空库页头密度

- 已发布后端ad0a218、Agent管理6a5eaa4、台账23a2a51，远端fetch核验源码树一致；新CI43222305725进行中，不复用7bbe旧绿灯声称新切片已验收。
- 真实7bbe390截图定位根网格自动分配剩余高度，空库header约180px多余留白。仅.promptPage设置align-content:start，Settings与共享header不改。
- 真实Prompt八组合每次截图附header几何JSON，断言外层仅比内容多0–2px边框，不限制自然换行；加长中文模板名保留实际绑定/筛选/返回流程。独立CR确认断言符合DOM及样式合同。
- 最终集成范围：Prompt5专项、真实E2E独立类型与8项收集、lint、web构建通过。该CSS变更后的全套未重跑，前一集成633单测为上一树；实际像素与几何效果待新HEAD CI。


### 后续发现与优先级

- AH-039普通Task假取消已用实际TaskService+stub复现，优先处理：不能允许IN_PROGRESS只变CANCELED而Agent继续执行。首片保守阻止该转换，明确引导所属工作区停止Run；终态与最终Task取消不混淆。独立工作树实施中。
- AH-015第二切片设计采用新增持久dispatchState：新Run PREPARING原子插入，sendTurn前先提交ATTEMPTED；旧行LEGACY_UNKNOWN。完整startup按证据分流，未知断连保持隔离/Worktree占位，恢复失败不开放监听；已权威终结不永久隔离。实现与重启回归进行中，尚未发布。

- 精确23a2a51 CI43222305725已双绿：verify633单测/10跳过及48fixture；real61通过（13.3分钟），Agent新增9项全部通过，140几何检查通过。artifact13948305085 SHA256 a2388ab13cff4d2e68740fee77b1525da5a6380f51c07709f8911fafddf1c6c0。Prompt密度后续d4bccba真实门禁仍待完成，不复用旧图。

- d4bccba精确CI43222614378已双绿：真实61项（13.2分钟），Prompt新页头几何八组合通过，Agent9项通过。实际像素复审仍区分可见区域：内部滚动容器使部分390全页截图未包含编辑器，需专门滚动后补取证，不能以fullPage文件名假设全部表单已看见。

### M1.2k 普通任务假取消保护（AH-039）

- 手动转换在Task行锁内核对关联活动/未决Run，覆盖直接取消及先BLOCKED/WAITING_REVIEW再取消的绕过；Session关联的IN_PROGRESS不得手动离开，权威生命周期不走这条人工门禁。
- 包括DISCONNECTED、恢复标记及已知历史合成终态错误码；不因为旧状态为FAILED/CANCELED就宣称Agent已停。无Session且无未决Run的手工任务保留服务端核对后取消，不让安全修复把手工任务永久卡住。
- 进行中关联Session的界面明确进入原工作区停止执行，说明停止请求不是停止证明。首片仅阻止虚假Task状态变更，不声称现有Workspace取消超时语义已修；该问题在AH-015第二切片处理。
- 独立CR仍记录反向准入边界：Task先被取消，后旧READY Session直接发起新Run，当前Run admission尚未按Task终态拒绝。此片只保证转换时已有未决Run不能被假取消，不声称双向竞争全部关闭。
- 新真实服务测试以fixture ACP等待批准保持任务执行，校验三种手动离开均409、四宽双主题精确工作区入口；未调用用户Agent。集成完整门禁651单测通过/10跳过，lint/types/build、QA10通过；新增真实类型及10项collection通过。
- S26集成lint通过但typecheck失败：新增Testing Library测试误用了Playwright的exact选项，三处类型报错；未将该轮当作通过。删除无效选项（RTL字符串name仍精确匹配）后S27重跑，lint/types/build已通过，完整单测102文件651项通过/10跳过（215.36秒），QA10通过。
- Agent管理补充证据：针对内部主区域滚动，初始/保存时显式滚动默认设置卡，未知结果/核对时滚动恢复区域；要求目标区域完整可见并附几何JSON。只补证据，不改产品布局，实际截图待新CI。

### M2.10 Agent 管理主操作前置

- 依据实际390图，身份/状态摘要压缩，编辑卡前置，UUID/能力/诊断放下方原生技术展开区；不改保存/异步/身份守卫，关键风险说明保留主表单。
- 29项组件、web/E2E类型、lint已在隔离工作树通过，独立CR无阻断。CR指出滚动后可见不能证明首屏改善，已加初次进入且未滚动前默认模型输入全可见断言和位置JSON；真实效果待新HEAD CI。
- UI层级最终集成范围：29组件专项、全项目typecheck、定向lint、web build、真实E2E类型和9项收集均通过；完整651单测对应前一提交，不冒充本次重跑。默认模型初始视口断言没有提前滚动，实际改后像素待新CI。

### M1.2l 持久派发与完整启动恢复

- Phase2增量新增0008 dispatchState及实际index调用的串行恢复；PREPARING可证未发，ATTEMPTED/历史UNKNOWN保守隔离，取消超时/拒绝不再伪造终态。详见RUN-PREPARATION.md。
- 两次独立CR拦截恢复风险并修复：MERGING不能因旧Run完成恢复REVIEW；旧Execution的Task/Session/Agent归属错配不能覆盖新Task。错配仅隔离自身，合并中断明确人工核对。
- 隔离最终119项通过，旧代码4项红测失败后修复通过，types/lint/core/db build通过。根集成保留AH039行锁人工门禁，三方冲突只合并恢复方法与新transition签名；并将历史异常谓词与Phase2一致，新增3例确认真实终态不被旧诊断码永久阻断，TaskService28项通过。
- 完整S29 lint/typecheck/串行build通过，104文件681单测通过/10跳过（252.86秒），QA10通过；已完成独立集成CR，发布后精确CI另验；单实例范围、恢复UI/真实Agent/NAS及反向Task取消后Run准入边界均不被本片关闭。

### M2.11 Prompt正文真实性、Work空态与Settings密度

- 12张代表性跨模块实拍发现三项，按用户UI优先推进：Prompt占位混入正文/草稿、空Work过重筛选/重复占位、Settings根网格页头拉伸。未声称全部140图逐张人工审完。
- Prompt分离实际版本/元数据/空提示，版本加载错误不显示真空态，首次版本明确创建且空草稿；根CR补CHAT同时有text额外字段仍必须复制完整JSON。13专项通过，真实八矩阵补实际创建与唯一正文API核验。
- Work原始任务成功为空才展示单指引面板，保留header唯一精确项目CTA，不显示无用筛选/Inspector；6专项通过（旧源3失败/3通过），新真实八组合覆盖首屏入口、创建、筛选无匹配和视图切换。
- Settings只改根网格align-content:start，新增真实八组合高度JSON；不解决移动分区导航末项问题，不把局部密度修复当整体改版结束。
- 17566真实CI56通过/6失败均Agent容器ratio:1边界（.99919/.99992）；实际失败图输入/保存完整，下边框贴视口，trace未记录精确rect，不声称测得某个小数像素。新增native IntersectionObserver测量含滚动祖先的真实交集，容器四边最多1 CSSpx裁剪，先存JSON再断言；关键控件和不滚动的主输入仍ratio:1，不全局放宽。新CI仍须通过。
- 三个UI片与AH040窄持久门禁合并S30完整门禁进行中；旧SHA绿色不代替当前树。

### M1.2m 已取消Task的反向准入

- RunRepository持Task锁时拒绝CANCELED，Run与Session taskId必须一致，全部在插入Run/latest指针前；Session局部映射409，不伪造已派发/准备失败。
- 保留WAITING_REVIEW/DONE直接Session turn且不自动重启Task；continuation保留归属且不能绕过取消门禁。旧源7新例4失败/3通过，修复后86专项通过；PGlite受控交错不冒充PostgreSQL多连接实测。
- S30混合集成lint/types/build通过，但完整单测701通过/1失败：旧所有权用例在fixture阶段创建错误归属Run，被AH040新准入正确提前拒绝。已改为有效准入后模拟历史关联漂移，保留全部回调拒绝断言；该文件10项重跑通过。未把失败轮次称为全绿。
- UI分片已分别通过Prompt13/Work6专项、E2E类型及33项收集；本轮先提交这些独立UI改动及容器取证修正，不让尚在重验的AH040后端片阻塞UI交付。AH040和fixture修正仍在本地，后续完整S31验收后单独提交；实际页面效果必须再验新CI。

### M2.12 Prompt 草稿归属与运行环境状态真实性

- AH-046 将版本编辑从当前选中资产解耦，每次打开冻结资产、账号、路由和选择归属；重复提交同步锁，关闭/导航撤销本次 UI 所有权，迟到结果不能清空新草稿或写向新资产。对同一资产重开后旧请求迟到失败，当前有效编辑器同步进入未知状态，不覆盖正文。
- 非法或未知响应不自动重试；用户可只读查看版本列表，再明确选择重新编辑。此检查不证明旧请求已结束，不承诺 exactly-once；刷新后不保留该内存隔离，后端幂等化仍是后续范围。忙碌/未知时正文、变量、说明均禁用。26 项专项通过，独立 CR 无阻断，真实 Back/资产 A/B 请求归属测试已加入 CI。
- AH-047 保留供应商 statusText 非空原文，缺省才依据 READY/STOPPED/UNAVAILABLE/UNSUPPORTED/BROKEN 映射；未知状态不升级就绪。实际历史图已确认矛盾，13 项专项、web/E2E 类型、lint 与八项收集通过；真实浏览器未在本地执行。
- 最终 S31 将 AH-040 和上述两片一起完整重验：lint、typecheck、串行 build 通过；108 文件 726 单测通过 / 10 跳过（262.31 秒），QA 10 通过。独立 CR 无阻断，新增真实浏览器仍待新 SHA CI，不把 collection 当执行。
- 精确 4156787 CI：真实 53 通过 / 9 失败，全为 Agent 技术详情或恢复区域 ratio:1 边界，与 70c838 相同；140 几何检查通过。095485c 已提交原生 IntersectionObserver 精确裁切取证修正，当前 CI 尚未完成。

### M2.13 可见导航与非空 Workspace 证据

- 精确095485c CI43230535288双绿：真实78项通过（13分钟），Agent9、Work空态8、Prompt正文/Select8、Settings页头8和140基线几何均通过。artifact13950437808 SHA2561199f36ff65a27f0193b63461d9a5883407dbb88942aead553d41ee627beb90a；实际像素复核另记，不把自动门禁等同全部审美验收。
- AH048依据d4bcc实际390浅深图，移动分区从横滑隐藏尾部改为六项3×2网格，44px，长标题可换行；桌面和所有路由/保存状态不改。真实新增760/768边界，交互前验证全部六项首次可见，逐项导航、Enter高级与返回。
- Workspace现有基线是空消息/干净Git，新增真实四宽双主题批准→消息/工具→文件预览→Diff→提交回执证据；每例只用一次隔离ACP运行，附内部滚动几何，源码与类型通过不等于80张计划图已产生。
- S31发布HEAD6ab6ef5对应726单测/10跳过全通过；本次后续UI/证据限定范围另行检验，不复用前一完整单测数字冒称重跑。

- S32限定验证通过：Settings新增3项CSS合同、全项目typecheck、web build、定向lint、新E2E独立类型及18项收集通过；独立CR补120秒余量和六分区内容标题断言，后续类型/lint复验通过。未重跑完整726单测，未本地运行浏览器。
- 095485c实际原生IO数据复核：editor/saved四宽双主题ratio=1、四边裁切0；技术区底边390为0.1875px、768为0.015625px、1024/1440为0.234375px，其他边0；未知恢复框底边0.1875px、readback全0，内部overflow全部0。此为新CI实测，不回填旧失败trace。

### 视觉方向暂停与功能修复隔离

- 用户最新明确否定现有整体 UI，已停止将微调描述为设计改版。AH049 概览及 AH051 会话工具栏未发布草稿完整保留，等待新设计方向；AH051 仅4组件通过/1失败，其余门禁未执行，不作为完成品。
- 新设计工作独立推进参考学习与完整视觉方案；当前根树仅整合 AH041 手工任务开始功能，不混入暂停的视觉草稿。
- AH041 原 BACKLOG 直接跳 IN_PROGRESS 被状态机拒绝。保持状态机，按真实状态合法 READY→IN_PROGRESS；冻结任务/账号归属，同步防重复，授权失效和导航迟到停止后续写；同挂载每任务保留未知闸门，先只读核对再明确继续，不自动重试、不创建 Session/Run。
- 根 CR 拦截初稿账号失效后续写及切选中任务丢未知状态，已补修；58专项及web/E2E类型/lint、真实八矩阵收集通过，最终S33完整 lint/typecheck/串行build 通过，110文件753单测通过/10跳过（273.69秒），QA10通过；独立CR无阻断，真实8矩阵等待发布后精确CI。跨刷新不保留内存闸门，刷新不会自动写，仍不声称跨进程幂等。

- 精确6ab6ef5 CI43233364567双绿，真实87项（14分钟）和140几何通过，新Prompt草稿归属1项及Runtime8项已实跑；这不代表用户认可现有视觉。

- 精确 ce6994b CI43234032803 双绿，105真实测试（17.3分钟）、140几何通过。新增Workspace四宽双主题8项均真实执行。artifact13952812083，SHA256600eac6e998c2091e9c13a338890ca0d35d5185ba37b473330a274bdce217d86。实际内容图仍暴露768文件区约230px、1024Diff区约280px且主对话闲置的空间分配问题，已交新设计工作，不以功能绿称视觉合格。
- 新视觉方向等待用户选择，暂停实现；继续独立核查批准投递反馈（AH053）及项目资格计数真实性（AH050，只读复现），不混入未经选定的视觉方案。c69e88c精确CI尚未完成。

### 功能状态真实性（不实施新视觉方向）

- AH050复用原NewWork项目资格解析，Overview/项目页头改用project-scoped登记资格；加载/失败不计0、不假绿，工作/会话错误不冒充空态。项目切换、旧缓存刷新失败均覆盖。89项隔离专项通过，新增真实资格启用→禁用1项待CI；原坏行为审计不作为修复期望合并。
- AH053批准反馈改为按同approval/session/run/option/delivery的权威记录派生，终态不被旧缓存回退，矛盾记录显示未知；Session/账号/授权撤销/新决定隔离迟到响应。旧组件4新例均失败，修复后33专项通过；原Workspace真实8场景追加outbox DELIVERED与界面一致断言，无新轮询/重发。
- 两片根整合S34：lint/typecheck/build通过，完整单测运行。旧WorkspacePage组件fixture缺少认证上下文可能被新增生产守卫拒绝，等待实际结果后修正fixture，不放松生产授权检查。

- S34实际结果：lint/types/build通过，111文件通过/1文件失败；792单测通过、1失败、10跳过。唯一失败为旧WorkspacePage fixture未声明认证上下文，新生产guard正确不提交；QA因前序失败未运行。已明确模拟local_trusted，并将旧重试成功{}改为真实形状的ApprovalRecord，增加等待投递断言；42项定向通过。S35最终全门禁重跑中，未提前写绿。
- c69e88c CI43236840650已双绿：113真实项（17.9分钟）和140几何，manual-start新增8条全部通过；artifact13952914401 SHA256a4f402f53cac3680028e44cee4df23eee2694590d15b469f75fddc20804390c4。该结果不代替本地AH050/AH053新树。

- S35最终完整重验通过：lint、全项目typecheck、串行build、112文件793单测/10跳过（270.95秒）、QA10；独立CR无阻断。UNKNOWN/null投递状态文案不推断未发送，旧fixture明确授权并返回真实形状响应，未删除或放宽原失败/禁用/重试断言。新增真实资格1项与原Workspace8项追加断言仍需新SHA CI执行，布局/设计方向未改。

### 等待设计选择期间的独立正确性审查

- e866e28 exact CI43241581160：verify已绿（793单测/10跳过、48 fixture）；real仍运行，未复用旧114计划数当完成。
- AH052 5项真实页面/AccessGate+延迟API mock诊断证实创建归属及迟到副作用缺陷；未证明服务端跨账号写入。仅功能状态机修复中，不恢复AH051布局微调。
- AH055真实Service+PGlite的2项故障注入证实未激活handle泄漏与二次DB故障遮蔽。纠正最初假设：persistEffectiveConfiguration自己吞错，activate的事件失败走异步consumer；本片只覆盖真实READY持久化失败的所有权回收，不扩大到这些相邻路径。


### e866e28 真实 CI 红灯及下一轮修复（未验收）

- run `43241581160`：verify `131263119518` 成功（793单测、48fixture）；real `131263120260` 失败，104通过、10失败。artifact `13955298951` 已校验 SHA256 `ca48e26fc5ea9aecd2fa7c738d174fabb1366bd12e5ea0817630ea2cd8bf3616`。
- 八条 Workspace 失败揭示 AH053 产品缺陷：决定提交返回 DISPATCHING，但列表接口仅含未决请求，终态从列表移除后 UI 永远读不到 DELIVERED。实际单条 GET 已返回 DELIVERED，不能靠延长等待或删断言掩盖；正在增加有界、可取消、归属隔离的只读核验。
- AH050 新测试调用不存在的 Agent enabled PATCH 合同导致400。修正为使用真实项目 archive 接口，确认 Agent 仍全局 READY/enabled 但项目资格为 PROJECT_INACTIVE/0；不新增服务器接口。
- Settings 390 light 实际44px行测得43.99998474121094px，六项均在容器内。测试只容许0.001px浮点误差并附原始矩形，保留点击高度/3×2/完整交互断言，不改产品样式。
- AH052会话创建归属及AH055失败资源清理补丁已合入本地待最终门禁；新增 API 安全文案10项通过，原始提供商cause不显示。UNKNOWN不伪称资源已清理，ACTIVE_OWNED指向现有受管会话。
- 当前未发布下一轮，未宣称新浏览器通过。用户已拒绝全部三个设计方向，功能修复不表示视觉方案获选。


### S36 整合范围与边界（本地门禁通过，真实CI待验）

- AH052：17项真实组件验证；原项目/Agent/账号/路由冻结，重复点击同步锁，迟到成功不抢新窗口。已确认成功保持锁直到明确创建另一会话；只读核对失败不沿用旧列表。未知清理提示持续保留、显示冻结Agent ID。真实两条测试使用实际服务POST后延迟或丢弃响应，未伪造成功响应，待CI运行。
- AH055：旧源7新用例均红，修复后96专项通过。只清理本次未转交的handle，最大1秒等待；超时/拒绝为UNKNOWN，保留原始创建错误，FAILED写失败不遮蔽原因。若已active接管，不关闭且不改FAILED。API默认错误不再错误地建议只做preflight，限定502/特定code映射清理提示，原始cause不显示。
- AH053追加：旧源pending列表消失3例全红；修复后hook/render/WorkspacePage63通过。单条GET最多20次/总60秒/单次10秒，终态、换会话/身份/决定或撤权停止，失败只提供只读重查，不新增决定POST。真实Workspace8原始断言不删减，待新CI。
- S36最终lint/types/serial build、113文件839单测通过/10跳过（265.20秒）、QA10通过；4个E2E文件类型检查及21项collection通过。已保留本地S36日志。collection只是定义检查，不能当真实浏览器验收。

- 独立只读复审确认 AH053 的请求取消、终态停止、只读重试及预算不随响应重置；非阻断防御缺口：同一不可变决定记录若返回相反 APPROVED/REJECTED status（其余身份全部相同），当前未要求 status 与初始值完全相同。正常服务无此记录路径，本片不宣称覆盖该异常，后续补定向防御测试。


### S36 发布与 S37 窄范围强化

- 已发布且本地/远端树一致：`f37e101` AH055，`16d5dd4` AH052，`f9d6765` AH053单条核验，`e84ee75`真实测试合同，HEAD `02eb01bd541d0ee97844e8dccbee0124915e12c2`。
- exact-head run `43248017262`：verify `131285852399`、real `131285851971` 均已启动，最终结果尚待核验。e866历史红灯不被覆盖。
- S37 AH054：旧源10/10新组件红；最小统计/历史分支文案修复后相关29组件绿，独立web/E2E类型/lint通过。保留未结束集合，不称活动Run；无Session不虚构main，缓存刷新/失败不当成功。未改CSS/布局，真实基线增加合法BACKLOG创建与历史分支对照，未宣称浏览器通过。
- S37 AH053防御强化：上一轮非阻断的相反decision status边界已补两行严格等同检查，双向四例旧源红、修复后67专项绿；错detail为核验失败只读重查，错列表不污染已确认记录。正常服务不可变记录无需触发该边界，未冒称生产曾实际出现。
- S37完整门禁通过：114文件853单测通过/10跳过（275.51秒）、lint/types/build、QA10，E2E类型及1项collection通过。尚未发布，先处理新CI阻塞；本轮不改变用户尚未选择的视觉方向。


### 02eb01b verify 新阻塞（AH056）

- exact verify `131285852399` 失败：839测试断言均通过，但存在1个未处理 ReferenceError `window is not defined`，栈定位 WorkspacePage/React Virtualizer/上游scroll-end debounce。fixture48未执行，不能称verify通过。real `131285851971`独立仍运行。
- 独立源码定位到上游observeOffset cleanup只移除监听，已排timer未取消；正在以官方observer包装隔离已卸载/替换订阅的迟到回调，保留活跃滚动与RTL/scrollend，不复制上游实现、不吞异常。不会声称timer本身已取消。
- S37本地完整门禁通过不覆盖该CI失败；等待确定性负控/修复与最终重新门禁后再发下一版本。


### AH056 确定性回归与 S38 最终门禁

- 采用官方observeElementOffset，清理时先将本订阅标为失效再调用官方unsubscribe，禁止该已销毁订阅的迟到回调通知React。未吞活跃回调异常、未全局stub window、未改ignoreUnhandledErrors；RTL/scrollend沿用官方实现，上游timer仍自然到期，不声称被取消。
- 原官方observer负控2失败/1通过；修复后新3项+原Chat/Workspace63项共66通过，webtypes/lint通过。覆盖活跃scroll/end、卸载后的已排timer/新scroll、同元素重新订阅隔离。
- root已整合AH054、AH053 status强化及AH056，S38 lint/types/build、115文件856单测通过/10跳过（274.32秒）、QA10全部通过，无unhandled；按逻辑切片发布后仍须核对新SHA真实CI。


### 已发布2ecf46f的CI跟进

- `02eb01b` real job `131285851971` 已通过：116真实测试（18.0分钟）及140几何检查，包含Session创建2、Workspace投递反馈8、项目资格1、Settings导航10。artifact `13958124356`，91,899,028字节，服务端SHA256 `39441bea0d25fe75f98be8129b47354563775290251d287f9106b84ef12d8ca2`。该run整体仍因verify卸载异常失败，不称双绿。
- 最新 `2ecf46f9cd5d3231cdd5ca1efcec2c55cff9c6e3` run `43250972055`：verify `131296335362` 已绿，856单测/10跳过及48fixture通过；未再因上述unhandled退出。real `131296335223`仍运行，尚未宣告全门禁通过。
- 视觉方向仍未获选择，继续只做独立正确性审查；下一项仅审计Session resume的handle所有权，不能把create已修结论直接推广为resume已安全。


### Session resume独立审计（AH057/AH058）

- 真实Service+PGlite+受控adapter的3条诊断通过=坏行为复现，不是修复验收；生产代码尚未改。新handle失败泄漏及FAILED二次写遮蔽原因、并发迟到resume关闭已成功赢家均已证实。
- 下一片先建立同Session本次恢复准入和activation归属，失败清理/状态写入不得伤害并发close或后来的active赢家；仅按当前单实例能力陈述，未知清理不伪称完成。仍不实现未选择视觉方向。


- 后续直接核验：`2ecf46f` run `43250972055` 两个job均 completed/success，已成为新的双绿基线；真实逐项结果及artifact仍由专门检查收集。新AH057/AH058只在独立树实施，不包含在此已绿SHA中。

- `2ecf46f` real精确结果：116通过（18.2分钟）、140几何检查。artifact `13960117527`，92,041,853字节；下载后实算SHA256 `bb800400b777db8652c18375d595a13954a3c2378386e3fc576b4cbb8d4853c8`匹配。此为功能/回归基线，不代表新视觉方向获认可。


### AH057/AH058实施与S39最终验证

- 已在本地整合：同Session恢复同步拒绝重入；close可撤销挂起的resume，不等待其adapter，不采用“resume挂起就一直禁止close”的方案。旧操作finally不能释放新操作token；迟到新handle仅清理自己，已交接/复用旧handle不被误关。
- READY/FAILED转换在DB行锁内仅接受DISCONNECTED；resume的配置读取返回后检查归属，配置UPDATE附DISCONNECTED条件，防止close已CLOSED后迟到配置继续写。其他create/live配置默认合同不变；不宣称阻止所有已发出外部副作用。
- 原activation自然消失不等于出现新赢家，允许正常恢复；只按捕获activation精确detach，旧连接关闭超时/拒绝会阻止新激活且明确旧/新清理未知。close本来的全局清理及AH059消费者跨await风险不在本片关闭范围。
- 原Service新增回归3/3红；旧DB产物真实PGlite条件更新2/2红，恢复新DB后同2/2绿；隔离树确实导入自己构建的DB产物。固定Session73+API13共86专项通过，server/webtypes、DB build、lint通过。
- root另外强化API错误文案4种断言，准确区分旧连接、本次新连接、两者未知与已受管资源，不回显原始cause。S39最终lint/types/build、115文件872单测通过/10跳过（269.15秒）、QA10全部通过，独立最终CR无阻断；真实Agent/NAS及多进程runtime激活仍未验收。

- AH057/AH058最终CR确认自然detach、旧handle复用拒绝、配置原子条件和默认配置合同均符合本片边界。AH059仍只记录既有源码风险，未运行复现、未修复、不声称关闭。


### 62b821d发布后核验与AH059定向审计

- 已发布代码 `4e731199c59a4eee14800a39d679fa3aa2d91ae5` 与台账HEAD `62b821dcd5d2e2a8eeb6b8fca8e23d3ccfa396d9`，远端树核验一致。
- exact run `43257274729` 的 verify `131318783184` 已绿：115文件872单测/10跳过、48fixture通过（1.8分钟）。real `131318783650`仍运行，未借用2ecf46f旧绿。
- AH059继续仅审计：要求实际Service/PGlite/受控adapter沿现有合法收敛路径构造barrier，不能靠任意改DB状态或新active对象伪造可达性。现阶段没有新增生产修复，也没有视觉实现。


### AH059由源码风险升级为合法竞争复现

- 独立62b树实际Service/PGlite/受控adapter审计3项通过，含2个坏行为正例与1个不可达否定对照，不是修复通过。
- 旧findActive snapshot迟到案例只损坏新Session状态，R2仍RUNNING，新handle未关闭，R1已COMPLETED/Task WAITING_REVIEW保持；旧Task callback迟到案例借合法Approval投递失败恢复窗口损坏新READY Session，原Run/Task未虚假终结。
- 未直接改DB状态、未伪造新active、未直接调用私有handler。此前“未复现”记录保留为当时状态；现在生产仍未实现修复，先审查最小本实例写入/activation互斥方案，不承诺跨进程或全部事件处理原子化。


- 后续直接核验：`62b821d` run `43257274729` 的 verify/real 两job均 completed/success，成为新的双绿基线；实际逐项/产物继续核对。AH059短提交队列仍在独立树，尚未进入该SHA，不借双绿称其已验收。
- AH059短队列初稿经独立源码CR：非拒绝tail且finally仅清理自己，未见锁嵌套；resume获得提交区后重验token、旧handler每个受保护提交区重验activation，provider/Task/handle.close留区外。双方提交barrier和失败后队列可继续已专项验证，最终整合门禁待实施片交付。

- `62b821d`逐项证据核对完成：verify872单测/10跳过、fixture48（1.8分钟）；real116（16.8分钟）与140几何检查通过。artifact `13963807810`，91,783,660字节，下载实算SHA256 `c995b31d064e08dcd9e341bab31e8530e4c36712c76d5d17f943db54237e607b`匹配。只覆盖已发布代码，不包含AH059未发布实现。


### AH059修复整合与S40门禁

- 已整合每Session短提交队列：resume READY+activate、失败FAILED条件收敛、close最终CLOSED、断连消费者Run/Session提交共享边界。队列tail不拒绝、finally仅清自身；锁内重验归属，Task/provider/handle.close不持锁。
- 最终Session81专项通过（基线73+新增8），servertypes/lint通过；旧源码两条合法正例均红，cancel反例绿。覆盖旧提交先行、新READY先行、排队恢复被close撤销、提交失败不毒化后续、长挂Task回调不阻close。
- 追加FAILED提交初轮曾暴露已撤销resume无意义等待close提交的回归，已改为失去ownership先跳过排队、仍owned者入队后再复核；保留原测试，没有延长超时或删断言。测试类型参数/外层错误码断言亦按真实接口纠正后重跑。
- 独立最终源码CR与root复审无阻断；S40完整lint/types/build、115文件880单测通过/10跳过（266.82秒）、QA10全部通过，准备按独立逻辑切片发布；新SHA真实CI仍待验。不保证挂起DB操作不阻队列，不取消已开始的任意外部Task observer，不覆盖其他persistEvent/Approval收敛或跨进程。

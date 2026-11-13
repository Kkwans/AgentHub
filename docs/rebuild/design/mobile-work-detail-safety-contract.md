# 手机工作详情：操作安全契约（待独立 CR）

日期：2026-11-13 08:38 UTC。本文是下一阶段方案，不是已经实现或通过验收的功能。**独立 CR 补充项已记录，尚未放行完整详情实现。**

## 结构与导航

同一路由 `/projects/:id/work`：手机无 `task` 参数显示列表，有合法 `task` 参数显示详情。桌面仍双栏。Inspector 在列表/详情切换时保持同一组件实例；只用 `hidden` 隐藏非当前视图，不复制 Review 组件。详情顶部为返回、标题、状态、主要操作；父项目导航/筛选不重复占据详情首屏。

- `task` 不存在于当前成功读取的任务列表：显示“找不到工作”，不 fallback 并开放另一任务动作。查询失败/未完成时显示真实状态。
- 手机点选 push，一次更新 task/view；返回优先回到本次列表 history entry。冷开深链的返回删除 task 并 replace，不依赖 `navigate(-1)` 离开本站。
- 列表搜索、状态、Agent、视图以 URL 为可恢复状态；原 `agentId` 是启动 Agent 选择，不能复用成列表 Agent 筛选，新增 `filterAgent`。搜索写 URL 用 replace，不为每个按键添加历史。
- 保存列表滚动锚点与触发按钮；返回后恢复到任务行，移焦点到该按钮。详情进入时焦点落标题或返回按钮。Back/Forward 同一协议。

## 1. 操作状态回调

建议 TaskReviewActions、WorktreeReviewActions 增加可选的兼容 props（桌面调用默认行为不变）：

```ts
type OperationPhase = 'pending' | 'unknown' | 'checking' | 'resolved' | 'retryable';
type OperationSnapshot = {
  projectId: string;
  taskId: string;
  executionId?: string;
  // 同一次提交/后续核对沿用同一token；与下一次提交不同。
  operationId: string;
  phase: OperationPhase;
  message: string;
  // 仅resolved且原响应身份校验通过时携带，供owner跨子组件卸载保留。
  resultHref?: string;
};
onOperationChange?: (snapshot: OperationSnapshot) => void;
// 返回当次操作是否仍可自动导航，不能用来授权提交或绕过资格校验。
canAutoNavigate?: () => boolean;
```

父页面同步更新 `ref` 中的锁及 React state。子组件在写请求开始之前同步报告 pending，不能等待 effect 才加锁。状态使用完整身份和 operationId 条件更新；旧请求终结不能清除新操作锁。pending/unknown/checking 均锁住“切换到其他任务”，但允许返回列表。resolved/retryable 释放切换锁。明确业务拒绝属于 retryable；网络失败或响应身份不确定属于 unknown。只读加载失败不得误报写操作 unknown。

已有 `onPendingChange` 暂不移除，保护现有禁用逻辑；新回调补足 unknown/checking，而不是用一个布尔值替代已有规则。组件卸载 cleanup 不可擅自报告 resolved。

## 2. 每个组件的接入点

| 位置                                | 操作状态来源                                                                                                                | 自动导航处理                                                                                     |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| TaskReviewActions                   | submit APPROVE/REWORK前报告pending；严格验证响应后resolved；safeRejections为retryable；无法确认为unknown；check期间checking | REWORK响应通过全部原身份验证后，检查导航门；不允许时保留成功通知及显式“打开新工作区”链接，不跳转 |
| WorktreeReviewActions               | 只读load不加写锁；继续修改/合并等提交按原unknown分支报告；核对checking，原有确认勾选与disabled全部保留                      | 返工有效sessionId验证后使用同一导航门；被拦截后保存已验证链接，不自动重试                        |
| TaskWorktreeQueueAction             | 复用已有onPendingChange/onUncertainChange/onAccepted；核对中仍视作unknown锁，不新增重复状态源                               | 目前无Workspace自动导航；如未来新增必须接入门                                                    |
| WorktreeCancelAction                | 复用父cancelStates，pending/unknown/checking保持锁，resolved/retryable释放                                                  | 无自动导航                                                                                       |
| useManualTaskStart                  | 复用manual.busy/manual.unknown与持久化恢复信息；check期间不释放unknown                                                      | 无自动导航                                                                                       |
| TaskPromptVariablesEditor           | 复用variablesSaving；保存未完成不允许切换任务销毁结果上下文                                                                 | 无自动导航                                                                                       |
| ProjectWorkPage start mutation      | 保留operationContext/eligibilityGeneration；pending切换锁不替代原校验                                                       | onSuccess原generation校验之后再检查可见性导航门；门拒绝后保留已验证session链接与显式入口         |
| ProjectWorkPage transition mutation | 保留原任务generation校验，pending期间不能切任务                                                                             | 无自动导航                                                                                       |

## 3. 晚到导航门

父页面维护 `visibilityEpoch`。离开详情（包括浏览器Back）、切换任务、切换项目或组件卸载时递增。发起操作时子组件保存该次 `canAutoNavigate` 闭包，闭包捕获项目/任务/epoch，调用时读取最新ref。条件同时满足才可自动导航：仍挂载、仍显示此详情、项目/任务身份相同、epoch未变化。

不能只判断此刻详情可见：用户返回列表再进入同一任务后，旧操作也不能突然跳转。禁止导航不等于提交失败；服务端操作结果仍按原规则验证、保存、通知，绝不能自动重试。显式结果链接只能来自通过原响应身份验证的session ID。

### 断点与可见性定义

手机：当前合法task详情且未显示列表时，detailVisible=true。桌面：选中任务的Inspector实际可见时detailVisible=true。每次跨越768px断点都递增visibilityEpoch，即使Inspector仍可见；这是对该次旧操作自动导航的保守失效，不重置其状态、不卸载组件。旧操作成功只提供显式结果入口。浏览器Back、项目/任务切换与离开work同样使旧epoch失效；route离开锁另按下一节处理。

## 4. 返回列表时的锁与反馈

列表顶端显示与原任务绑定的常驻状态条：“该工作正在提交 / 结果待核对”及“返回此工作”。它不是 toast，不能随时间消失。该任务的Inspector保持挂载，反馈/输入/确认状态不丢。

有锁时点击其他任务，保留选中任务并显示“请先核对原工作结果”；不给新任务挂载操作组件。浏览器前进或外部同页URL变为其他task时也必须经过相同选择守卫：在改变selectedId前拒绝切换，并 replace回可安全展示的URL，明确告知用户。无task的列表URL允许出现，但selectedId仍保留被锁任务。不得先渲染新任务后再用effect补救。

内部跨项目、切去概览/会话、离开 work 路由同样会卸载 owner，不能作为例外放过。实现前必须选择并验证以下其一：路由离开守卫（存在写操作锁时拒绝卸载，提供返回原任务核对入口），或将锁、未知状态及核对证据提升到可跨内部路由存活的 owner。不得只增加 epoch 后宣称未知状态已保留。当前 Router 能力必须先检查，不能假设普通 BrowserRouter 支持 data-router 的 useBlocker。不得提供一个直接丢弃 unknown 的“强制离开”按钮。

canonical URL 恢复只修 task/view，保留用户当前最新 q/filterAgent/status/promptId 等不相关参数，不能用旧URL覆盖刚修改的筛选。非法task且有未确认操作锁时，恢复原锁定任务并解释原因；无锁时显示not-found，不 fallback。

完整页面刷新/跨站导航的操作恢复不是靠本地ref能解决，仍有现存持久化缺口；本阶段不新增“刷新已安全恢复”的承诺。持久化审阅/返工结果核对需单独设计，不能把原始敏感数据写localStorage。

## 5. 必须通过的测试

1. 390手机点击任务后，首屏可见返回/标题/审阅主操作，列表/项目大header/筛选不可访问；桌面保持两栏。
2. 列表→详情→Back→Forward保留URL筛选、任务、滚动、焦点；深链冷开返回不离站；非法task绝不显示另一任务动作；看板只产生一个history项。
3. 同任务返回列表再进入，反馈文本、未知状态、确认状态不重置；同一Review组件仅挂载一次。
4. pending后Back，模拟成功/失败/错误身份晚响应：不自动导航、不重复提交；列表通知准确；显式返回原任务可核对。
5. pending→unknown→checking全程不能切其他任务，包括点击及浏览器URL变化；旧operationId终结不能释放新锁。
6. 进入/退出详情后再进入，旧成功不得因可见性恢复而触发自动导航（epoch测试）。
7. 390→1440→390不因布局切换卸载操作组件或丢unknown；pending跨两次断点后晚成功不自动导航，显式结果入口仍可用；原78项请求过期/资格/确认保护继续全过。
8. pending/unknown期间点击其他项目、概览、会话及浏览器返回离开work：验证route守卫或持久owner实际保留操作证据。canonical恢复保留最新q/filterAgent/status；有锁非法task恢复原任务，无锁非法task显示not-found。
9. 新精确提交的真实服务390截图和键盘交互、页面错误、横向溢出检查；不能用旧图或单元测试替代视觉验收。

## 实施顺序

先独立CR以上契约；然后只加操作回调/导航门及回归测试，不改UI；独立CR通过后再接URL驱动的单实例手机详情。每片分别提交，任何保护状态不完整则停留在现有布局，不发布半安全详情。

## 子组件契约首片（2026-11-13 08:42–08:45 UTC）

仅 TaskReviewActions / WorktreeReviewActions 接入可选快照回调与导航谓词，父页面未接入，不开启新列表/详情行为。每次写请求前同步报告 pending，合法结果 resolved，已知拒绝 retryable，无法确认 unknown；核对仅报告 checking→unknown，不把一次读取误当原请求已确认。只读差异加载不申请写操作锁，卸载不自动解锁；原请求最终结果仍以原operationId发回原订阅者。

导航谓词在提交时捕获；当合法返工结果被门拦截，保留显式“打开已提交的工作区”入口，不抹掉成功结果、不自动重试。省略新props时保留原调用行为。operationId仅需页面生命周期内唯一，不依赖非安全LAN来源可能缺失的crypto.randomUUID。

验证：新契约10项测试覆盖两组件pending先于POST、捕获旧epoch回调、有效结果链接、无效响应不生成链接、unknown核对仍锁定、重试operationId变化及卸载不释放锁。既有WorktreeReviewActions与ProjectWorkEmpty共91项通过。父route离开守卫、持久owner、列表状态条及真正手机详情仍未实现，不能依据本片宣称可以安全隐藏/卸载Inspector。

### 独立 CR 修正：结果必须交付 owner（08:50 UTC）

仅把成功链接存子组件不够：后台刷新会使任务离开待审阅状态，父条件随即卸载Review。现resolved快照同步携带通过原响应身份验证的resultHref，先于refresh及finally解除pending交给原owner；即使旧子组件已经卸载，合法旧响应仍以原operationId向原订阅者报告，不跨任务污染。UI setState与自动导航仍要求current归属，未知/无效响应从不携带链接。

新增query cache状态改变实际卸载子组件后owner仍保留链接测试，两组件都覆盖；卸载早于响应的测试也断言快照携带已验证链接。当前总验证103项通过（新契约12项+既有91项）。父owner接入仍未实现，本片只是可靠结果交付接口。

## 隔离 owner/hook 前置片（08:52 UTC，尚未接入）

新增 createReviewOperationOwner 工厂与 useReviewOperationOwner 订阅 hook，不创建全局单例、不自动接入路由、不增加手机显示切换。实例未来必须由**认证身份作用域内部、路由内容之上**的稳定容器持有。logout或身份改变在展示新身份内容前调用setScope，立即清空操作/结果并使所有旧身份callback失效；hook卸载不清空owner。不能把owner放在认证边界之上共享给不同用户，也不能仅在延迟effect里清理后再声称无旧用户闪现。实际认证边界接线仍待独立CR。

- 完整project/task/execution身份和operationId构成记录键。不同token分别保留，旧resolved只终结自身，不释放另一个pending/unknown/checking。未经pending登记的终结回调被拒绝；终态不接受迟到unknown反转。
- setView接收project/task/routeKey/viewport/visible；任何变化递增epoch，返回同一路由/同一详情也不会重新激活旧闭包。它只禁止导航，不作为离开守卫；原操作结果继续存owner。
- getSnapshot为不可变稳定快照，订阅者可跨路由卸载后重建，已验证resultHref继续可读。只保留resolved的本地/workspace/链接。
- 默认无scope时拒绝快照和导航。只用内存，无localStorage、凭据或跨刷新恢复保证。

验证：纯store9项与真实React订阅1项测试，覆盖多operationId独立锁、未知核对保持锁、身份隔离、退出再登录同一用户旧callback失效、route/hidden/task/viewport epoch、immutable快照以及订阅组件卸载后结果保留。父组件选择守卫、App认证边界owner挂载、route/view同步、结果状态条、其它manual/queue/cancel锁的聚合仍未接入；完整手机详情仍未放行。

## 审阅 owner 实际接线片（2026-11-13，待独立 CR）

认证边界内、Routes 上方挂载按身份隔离的 Provider。StrictMode 重放后首次 pending 才绑定原操作订阅；导航门在实际提交时捕获，避免 render 阶段旧 epoch 导致首次合法返工也无法导航。ProjectWorkPage 同步路由、任务、断点和可见性，离开再返回不会恢复旧导航权限。已登记审阅操作跨路由卸载仍保留；返回原任务时 owner 锁继续禁止再次写操作。

AppShell 提供操作状态、原任务入口及已验证结果链接；unknown 可独立只读核对原任务/执行身份，不重发请求，也不把查询成功误判为原请求成功。确认终态可主动关闭，pending/unknown/checking 不可关闭，关闭后的旧 operationId 使用 tombstone 防止晚回调复活。状态条仅在 AppShell 可见，workspace 全屏路由没有新增覆盖层，但同身份 owner 仍存活。退出登录清空 owner 并使旧回调失效；无浏览器持久化或硬刷新恢复保证。

实际 Provider 集成 6 项覆盖 StrictMode 首次 pending 登记与正常导航、离开后的晚结果交付、Task/Worktree 离开再返回同任务后禁止旧导航、unknown 回到原任务禁止重复提交并能核对、换身份后旧结果丢弃。owner/hook 共 11 项覆盖终态关闭与所有锁拒绝关闭、关闭后的旧回调不影响新操作等。

本片未开启手机独立详情、未改变 history 行为，未聚合 manual/queue/cancel/variables 的跨路由操作生命周期。因此不能声称完整列表/详情或所有操作的离开安全已经完成；最终布局仍需精确提交的真实浏览器验收。

### StrictMode warm-cache CR 修正

新增所有相关 query 预填、staleTime Infinity 的首屏测试，确认旧 setup 顺序会在父 scope replay 中清掉已注册的视图，导致首个合法返工错误地被阻止导航。Provider setup 现在先取子 layout 当次注册的 view，再恢复 scope 后重新登记；cleanup 仍同步清空认证状态，旧 operation callbacks 不复活。该测试先红后绿，集成共 7 项、owner/hook 11 项通过；首次异步加载和 warm-cache 均覆盖。扩大回归必须从仓库根运行以载入 test-setup，不能用 apps/web 目录无配置启动结果判断产品回归。

## 手机首个可见切片（2026-11-13，待精确提交截图验收）

本片采用受限的 replace URL 模式，不新增浏览器 history push/Forward 语义。手机默认列表；选择工作后隐藏筛选/列表及项目身份、metadata、tabs，只保留项目警告和单个 Inspector。返回按钮删除 task/view 参数，保留其它参数、selectedId、输入与组件实例；同一组件用 scoped `[hidden]` 样式隐藏而不是卸载。桌面仍为原两栏。非法显式 task 显示不存在，不暴露 fallback 工作的操作。

选择不同工作或转看板前聚合现有 start/transition/manual.busy+unknown/variables/review/queue/cancel 锁；原任务仍可进入核对。审阅 pending 返回再进入后旧成功不可自动导航，但已验证结果保留。Agent start 仍是原有多步 mutation，pending 时暂禁用新返回按钮，避免引入隐藏后自动导航路径；不宣称已解决全部操作跨内部路由/完整刷新恢复。浏览器返回依旧是旧路由行为，本片没有加入新详情 history。

键盘进入详情聚焦返回按钮；返回聚焦原任务行，若筛选已排除该行则聚焦列表容器。新增测试覆盖输入实例保留、unknown 改选受阻、非法 task 无写操作、Task/Worktree pending 返回再入与晚响应、筛选排除时焦点 fallback、真实项目头隐藏/恢复和参数保留。Fixture E2E 增加列表与详情两张手机截图；real-service E2E 增加新建后手机详情截图并返回再验证筛选。尚需 CI 对本次 SHA 的390实际图确认首屏主操作与警告布局，不能使用旧图作为验收。

## 平板单栏详情扩展（2026-11-13，待精确提交 CI 视觉验收）

工作导航与手机筛选断点分离：phoneFilter <=767，singlePaneWork <=1023，1024+ 保留双栏。局部 useWorkViewport 供 Work/ProjectContext 使用，不改变全局 compact hook。手机/平板沿用 replace URL 与同一 Inspector 的 hidden 模式、原选择锁和返回限制；没有新增写操作、history push 或跨整页重载恢复保证。

owner viewport 使用 phone/tablet/wide 三档，跨767或1023后再返回不能恢复旧导航门。Context 的详情警告从 phone-only 分支移出；平板隐藏身份栏时仍显示资格/分支/任务统计未知或失败，并避免重复渲染已隐藏 identity 中的相同事实。焦点只在原节点隐藏或失去焦点、列表选择进入详情时迁移；仍可见的 textarea 跨断点保持焦点与同一节点。无 task 的桌面默认 Inspector 缩至平板列表时，隐藏编辑器的焦点转回选中任务行或列表容器。

测试覆盖768/1023的30任务列表互斥详情、1024双栏、767/768/1023/1024 warm-cache 首次合法返工、两类审阅 pending 390→768→1024→768晚成功不跳转且结果入口保留、三个窄宽度unknown选择锁、编辑焦点与字段实例保留、平板资格错误警告。fixture E2E 拆分手机筛选与单栏详情断言，tablet截图按实际选择/返回/警告流程采集；真实空态流程768进入详情后返回再筛选，axe仍仅390明暗两次。单元/类型检查不是新布局截图验收，精确SHA的768/1024图仍必须检查。

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

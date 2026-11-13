# C22：Prompt 绑定操作跨内部路由归属合同

状态：**实现候选已接线，本地回归通过，真实浏览器门待验证**。

下方推荐顺序及设计章节保留评审时的历史背景；当前实现与测试边界见末尾更新。

实查时间：2026-11-13 13:35:59 UTC。依据 C21 `db2f1f2`、共享 Select 修复 `3c2a9b3` 的源码及已发布 `7bc23e8` 整合状态。当前全量单测与 154 状态 axe 已通过；真实绑定正向/晚响应流程仍待 CI。axe 不验证此并发合同。

## 推荐实施顺序

先等当前真实绑定门通过，再做一次小范围的 owner 提取与 Provider 接线。此候选只提交合同，不新增独立未使用的 owner 工厂：现在工厂会与 C21 的响应校验、错误分类、锁逻辑形成两份实现，而接线时仍需再迁移和验证。正式实施应一次提取唯一规范实现，删除页面里重复的操作存储和锁，不叠加新旧双 owner。

这不是无限等候：若真实门失败，先修已经发布的真实行为；真实门通过即可按下列边界实施。跨路由 owner 值得做，因为普通内部导航当前可以绕过页面级 pending/unknown 锁。

## 树结构与认证边界

现状：全局 `QueryClientProvider` → `BrowserRouter` → `AccessGate` → `AuthenticatedRoutes` → `ReviewOperationProvider` → `Routes`。`/workspace/:id` 不经过 `AppShell`。

目标：在 `AccessGate` 内、`Routes` 上方增加独立 `PromptBindingOperationProvider`。与 Review provider 为同层嵌套关系，不复用其 project/task/execution 类型或导航有效性规则。Review 的 keyed identity 模式可借鉴，操作归属不可混用。

- 授权身份明确为 local_trusted，或 token 模式中确定的 user ID。未知身份不得创建 owner 的写权限。
- 使用 keyed scope 创建全新 owner，使身份 B 的首 render 不可能读到 A 的记录。无需等 passive effect 才清旧状态。
- Scope 激活/撤销有单调授权 epoch。A→B→A、撤权后同 ID 重登、StrictMode cleanup/setup 都不能复活旧操作 capability。
- Provider 在 layout cleanup 立即撤销 owner；同时订阅 `authSession.onAuthorizationRequired`，事件到达时先撤销，再清视图。旧 Promise 即使持有 owner 引用也没有写记录或 invalidate cache 的能力。
- Provider 缺失必须明确拒绝写入或抛出开发错误。**不得为旧测试保留生产 global singleton、unknown-auth 写入或页面 fallback owner。** 测试显式注入 local_trusted/token 认证和真实 Provider。
- 没有 Prompt 页面订阅者时，Provider 仍在 auth 域内存活，请求可以完成并记录结果。页面卸载不销毁 owner。

## 两类生命周期，不能合并

### 操作 owner：只与授权会话关联

保存冻结操作 ID、授权 epoch、完整请求 payload、原 Prompt/目标名称与 ID、pending/saved/rejected/unknown 结果、已验证 binding ID。

记录是否接收完成结果不依赖当前 route、selected Prompt 或弹层 generation。去 Home、Workspace 或另一 Prompt 时，仍应收录原操作结果。有效的旧成功只 invalidate 原 Prompt 的绑定 query；不得从当前页面反推目的 key。

### 页面 draft：仍与视图关联

保留 C21 打开时的 Prompt 身份、scope、route、generation 与当前可见性校验。页面卸载或切换后，旧操作不能关闭/改写新页面弹层，也不能显示为新草稿的错误。只有页面本身仍持有匹配的 draft capability 才能关闭原弹层。

跨路由不恢复草稿输入，本片只恢复原操作记录与锁。回到 Prompt 页不自动重开旧弹层，不自动导航，不替用户选择另一个 Prompt/目标。

## 纯 owner API 的建议合同（将随接线一并实现）

- `begin(snapshot)`：同步验证有效 scope、同步检测全绑定锁、拷贝冻结 snapshot，分配不可复用 operation ID 并占锁。必须在任何 await 和 React state 更新前完成。
- 返回一次请求 capability，携带 owner 实例/授权 epoch/operation ID；不能只凭数值 operation ID 在另一个 owner 中操作。
- `settle(capability, result)`：只在 capability 仍属当前授权代际且操作 pending 时更新。重复回调无效；旧 terminal 不解锁新的 pending。
- `subscribe/getSnapshot`：快照只读，未变化时引用稳定。任何消费者都不能直接更改 payload、phase 或 lock。
- `dismiss(id)`：仅可移除 saved/rejected，pending/unknown 无法由关闭弹层、关闭提示或返回按钮移除。
- `revoke()`：立即失效所有旧 capability、清除记录与锁；新会话是新 owner，不在旧 owner 上偷偷重新授权。
- 网络请求执行与可信响应校验由同一规范路径持有，不能允许任意 UI 调用 `settle('saved')` 绕过真实结果校验。

## 保留 C21 已验证安全规则

1. 提交前同步读取最新 Prompt/目标 query cache：status=success、fetchStatus=idle、当前成员包含已选 ID。A 删除后 fallback B 不能提交给 B。
2. 完整冻结 payload，不从未来 render 读取目标、版本或 Prompt。同步双击只能一条 POST。
3. 成功响应 binding.id 非空、enabled=true，所有 payload 字段逐项一致；非活动 selector 必须 null/undefined。2xx 身份错误或畸形是 unknown。
4. 只有服务 insert 前明确的 code + status 拒绝才可判 rejected。网络、超时、5xx、未知响应一律 unknown。
5. 不自动 retry POST；不自动 GET 猜测成功；相似绑定不能被当作当前请求的证明。
6. Auth 失效后的结果不可写新身份记录，不可 invalidate 全局 QueryClient 中新身份同名 key。

## 锁的可用性代价与结果展示

继续采取**同一授权会话内全绑定锁**：一个 pending/unknown 会阻止另一个 Prompt 或目标的新建绑定，直到该请求得到已验证 saved 或明确 rejected。普通内部导航不再解除它。这比 C21 的同页锁更持久，代价是真实 unknown 可能让整个会话的绑定创建持续不可用。

必须在页面可读提示中直说：原 Prompt/目标、状态与人工核对需求；关闭弹层不会取消请求。不能以“重新读取”按钮暗含解锁或重新 POST。人工核对只能提供核对信息，本片没有安全的“我看过了，继续创建”绕过入口。

后续若设计“人工明确结束跟踪 / 允许新操作”，必须独立评审并要求明确确认，说明不能取消已发服务请求、可能造成重复绑定；必须保留旧 operation 与所有晚结果归属，旧结果不能解锁新的操作。本片只记录此未来选择，不添加该按钮或隐含绕过。

返回任意 Prompt 页面都可看原操作记录与已验证 binding ID。saved/rejected 可手动关闭提示，unknown/pending 不可关闭。首片不增加 Workspace 横幅、不在每个业务页面堆新状态卡；离开期间记录存续不等于全站持续显示。

硬刷新、新标签页、浏览器关闭、服务重启、重新认证不提供去重保证；不能把重新登录或刷新推荐为解除 unknown 的操作。服务端 createBinding 没有幂等键，每次请求可插入新记录。跨这些边界的 exactly-once 需独立后端合同，本片不承诺。

## 真实 Provider 回归矩阵

测试应挂载真实 Provider 与 MemoryRouter/Routes，在 route 元素层真实卸载 Prompt consumer；仅在同一 hook 上改 URL 不足以证明跨路由保护。

| 场景                               | 必须断言                                                              |
| ---------------------------------- | --------------------------------------------------------------------- |
| pending A → Home → 回 A            | 原记录与锁仍在，第二次提交拒绝，POST 总数 1                           |
| pending A → Home → 打开 B          | B 草稿可查看但不得创建第二绑定；原记录仍明确属于 A                    |
| 无 Prompt consumer 时成功返回      | owner 保存已验证 ID；回页可见结果；只刷新 A 的 query                  |
| 无 consumer 时明确插入前拒绝       | 回页看到原拒绝结果，锁释放；后续新操作只属于新 ID                     |
| unknown → Workspace → 返回         | 记录/锁保留，不因新 mount、查询成功或相似 GET 结果解锁                |
| A pending，返回后打开 B 草稿再成功 | 原结果被保存，B 草稿不关闭、不改字段、不误领原错误                    |
| 同步双击/两个 consumer 同时提交    | 同一个 owner 同步占锁，仅一条 POST                                    |
| 旧 terminal 重放/旧 finally        | 不更新已终态记录，不释放另一 operation 的锁                           |
| auth A→B→A、撤权再登录同 ID        | B 首 render 无 A 信息；旧 capability 永久失效，旧结果不污染记录/缓存  |
| StrictMode warm cache 初次操作     | 首次合法提交、完成、查询失效都正常，不因 setup replay 丢失 capability |
| Provider 缺失/unknown auth         | 无 POST，不创建独立 fallback owner                                    |
| 长名称/ID 的手机结果               | 信息可读且无水平溢出，提示不能遮蔽新草稿操作区域                      |

浏览器门沿用真实 loopback/PGlite：`route.fetch()` 取得真实提交响应后延迟 fulfill，真实离页/回页，再释放并核 GET 持久记录、POST 一次及截图。finally 必释放、等待 handler 结束、清 route。保持已有三类目标正常成功、负向来源状态和 C21 晚结果用例，不以伪造成功 JSON 替代。

## 放行条件

当前真实 CI 通过后，独立 CR 先审实际 Provider 生命周期，再审页面迁移；原 C21 回归不得删除或降低。范围完成必须同时具备真实内部离页/返回证据，不可用纯工厂单测宣称已经跨路由保护。未覆盖边界持续标注，严禁把本合同当作已实现状态。

## 2026-11-13 13:38 UTC 实际卸载复现

`repro/prompt-binding-route-unmount.patch` 在精确7bc的默认 hook 测试上追加两个预期正确行为的测试。与此前仅改变 location、保持 hook 挂载的测试不同，这次使用真实 `Routes`：在 `/prompts` 提交后进入 `/other` 卸载页面，再回 `/prompts` 挂载新实例。pending 和网络失败 unknown 两种状态都先确认原锁有效，回来后 `bindingBlocked` 实际为 false，原记录也不再保留。结果为原15通过、追加2失败，日志 `c21-route-repro`；并未发第二次 POST 来制造重复数据。

补丁独立存放，不进入默认发现路径，不使用 skip/xfail 冒充修复。默认源码测试已恢复，后续真正 Provider 接线必须把这两项断言纳入正常门禁并转绿。当前合同和复现不是跨路由修复完成证明。

## C22 实现候选与边界更新

2026-11-13：操作规范已一次提取到 `binding-operation-owner` 并由认证域内、Routes 外的独立 Provider 持有；页面只保留 draft/route/generation。Provider 缺失或身份不明拒绝写入，测试显式挂载授权 Provider，不保留生产 fallback owner。

StrictMode setup replay 在同一个 owner 实例上签发新的单调授权 epoch；不是恢复旧 capability。cleanup/revoke 立即失效旧 epoch，后续 activate 不能使旧 Promise 再有写记录、解锁或刷新缓存权限。认证 scope 改变仍以 keyed 子树创建新实例。完整快照包含 authorized/epoch/records，activate 完成后发布新引用，避免暖缓存初次 bindingBlocked 停留在未授权状态。记录、数组与 payload 均冻结。

内部路由卸载不再销毁操作 owner；无消费者期间也可接收已验证成功或明确拒绝，回页看到原结果。unknown 锁跨内部路由保留，仍不保证硬刷新/新标签页/重新登录去重。新增回归覆盖真实 Routes 卸载后 pending/unknown、无消费者完成、两个入口同步争锁及授权 epoch 回放；真实浏览器门另由整合 CI 验证。本文设计部分保留评审背景，候选通过本地测试不等于真实门已通过。

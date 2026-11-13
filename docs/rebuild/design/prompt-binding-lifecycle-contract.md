# C21：Prompt 绑定弹层与请求身份合同（阶段一已实现，真实晚响应门待验）

记录时间：2026-11-13 13:11 UTC。复现基线 `37324e5`。此文档不是安全实现验收。

## 已实测的问题

独立 hook deferred-response 回归证明：

1. 在 A 提交，关闭并重开 A，旧成功会关闭新的弹层。
2. 在 A 提交，关闭并切到 B，再开弹层，旧成功关闭 B 弹层，且仅 invalidate B 的绑定缓存，而实际 POST 的 promptId 是 A。
3. 在 A 打开弹层后，来源刷新删除 A、当前 selected fallback 到 B，直接提交会向 B 发 POST。不能只修完成回调。

附件 `repro/prompt-binding-lifecycle.patch` 是预期正确行为的红测补丁，不在默认测试发现路径，也没有 skip/xfail 冒充修复。应用后执行该文件，预期原 9 项通过、3 项失败。后续实施时将这些断言纳入正常门禁，必须变绿。

## 最小阶段一：同页面存活期的请求与弹层隔离

### 打开时固定 owner

- 打开弹层捕获 Prompt ID/名称、项目作用域、selectedId、route key/path/search、auth scope 和单调 dialog generation。
- close/open 同一事件循环也推进 generation；不能只依赖观察 boolean 的 effect，否则 false→true 批处理会漏掉重开。
- selected、路由、作用域或身份变化使原 owner 不再有提交资格。A 从来源列表消失（即使 fallback 到 B）也必须拒绝；不得自动把草稿或请求归给 B。
- 提交时重新核对 owner、当前来源包含原 Prompt、当前 target cache status=success / fetchStatus=idle / membership，保持上片来源 guard。

### 请求快照与回调

- 提交入口同步冻结操作 ID、owner 与完整 payload；mutation variables 携带快照。重复同步点击用独立 submitting ref 防抖，不能只依赖下一次 render 的 pending。
- 真正 POST 只使用冻结 payload。请求体与现有服务合同不变，不加重试、不改后端、不生成第二次 POST 来猜第一次结果。
- “已验证成功”要求 response binding.id 为非空字符串，且 promptId / targetType / targetId / slot / selectorType / priority 与冻结 payload 一致；VERSION 的 versionId 或 LABEL 的 label 必须逐项相等。2xx 但畸形或身份不符归为 unknown，不能关闭或宣称已保存。
- 只有可证明尚未写入的服务器明确拒绝才可标为 retryable 并释放该操作锁；network / timeout / 5xx / 无法验证的响应保持 unknown。未知错误默认不作“失败可重试”推断。任何旧 terminal 都不能释放不同 operationId 的锁。
- 已验证成功始终关联原操作身份。仅同一授权身份下 invalidate 原 `['prompt-bindings', submittedPromptId]`，绝不能读当前 selected.id 来选择缓存。
- 只有 mounted、owner/generation、route、auth 都仍匹配时才能关闭当前弹层或更新当前草稿错误。旧成功/旧错误不能冒领新弹层。
- 同页面保留独立只读操作记录：原 Prompt 名称/ID、目标类型/名称/ID、提交状态及结果。旧成功显示“已保存原绑定”，旧失败/不确定显示属于原请求的说明，而不是简单 mask 后消失。已确认成功可手动关闭记录；pending / unknown 不可被普通关闭弹层抹掉。
- 当前操作错误可在弹层内呈现；旧操作结果在页面级只读区域呈现。新弹层不继承旧错误。回调必须按操作 ID 更新记录，不能让旧 finally 解锁新请求。
- 阶段一保守禁止当前页面存在 pending / unknown 时再发绑定 POST，仍允许关闭、查看新草稿。解释锁所属的原 Prompt；关闭重开不释放该锁。

### 授权与卸载边界

- `QueryClient` 在全局，不随 AccessGate 身份自动隔离。捕获 `useAuthMode/useAuthUser` 身份，并监听 `authSession.onAuthorizationRequired`；撤权或身份变更使旧操作回调失效，不写新身份的记录或缓存，也不 invalidate 新身份相同 key。
- 同身份普通 route 卸载：禁止 setState / 关闭新组件；授权仍有效时可 invalidate 原 QueryClient 的原 Prompt 缓存。需要能在请求完成前持续观察撤权的短命 operation subscription，而不是组件 cleanup 后失去撤权通知。
- 不能仅用“unmounted”推断仍同身份。若没有可靠授权代际快照，保守不做卸载后缓存刷新，记录这个限制，而不是执行可能跨身份的刷新。
- 阶段一页面级记录不等于跨路由持久 operation owner。离开页面、刷新、重启后不能保证原 pending/unknown 记录或锁还在；需在 pending/unknown 可见说明中明确提醒勿重复创建。不会引入 BrowserRouter 不支持的 useBlocker，也不借机迁移路由。

## 非幂等与未覆盖边界

后端 createBinding 每次 randomUUID 后 insert，没有 requestKey 幂等。传输错误可能已经保存，必须视为结果未确认，禁止自动重试。GET 出现相似绑定不能证明是本次请求，不可据此自动解除 unknown 锁。

阶段一不得声称解决：跨路由/硬刷新/跨标签页去重、完整认证持久化、后台请求取消、服务端 exactly-once、未知结果自动恢复。若未知状态使继续创建受阻，应说明需人工核对，不能提供暗含再次 POST 的“重新读取/恢复”按钮。服务端幂等与稳定授权 owner 是后续独立片，不与此 UI 修复捆绑。

## 必须通过的验证

- 原 9 来源 guard 不退化；A 打开后删除/切 B/路由变化均不向 B 提交。
- 正常首次成功关闭原弹层、刷新 A；关闭重开后旧成功只更新 A 记录，保留新弹层及草稿。
- 旧拒绝只显示原操作记录，不在 B 弹层显示旧错误；pending/unknown 关闭重开仍禁止第二次 POST。
- 提交 payload 在草稿变化后不改变；同 tick 双击只有一次请求。
- same-auth 卸载无 UI 更新；撤权后成功不刷新新身份缓存、不恢复旧敏感记录；StrictMode 初次操作仍可用。
- CI 真实浏览器已有三类目标成功创建测试仍通过。新增 deferred 浏览器回归必须抓真实响应后延迟交付，不能伪造成功 JSON。

以上为阶段一实施合同；原红测记录保留作为缺陷来源，下面说明当前实现及验收边界。

## 阶段一实现候选边界

2026-11-13：实现选择保守策略，组件卸载后不刷新任何缓存，也不更新 UI。原因是当前认证事件监听属于组件生命周期，卸载后不能持续证明授权未变；因此本片不宣称同身份离开后后台刷新原缓存。仍挂载的同身份页面中，旧操作成功只刷新原 Prompt，并保留带原 Prompt / 目标名称与 ID 的只读结果。

原三条红测已纳入默认测试并转绿；补充 StrictMode 首次成功、同 tick 双击、未知与明确前置拒绝、响应身份错误、auth A→B→A、撤权与卸载、同页 route 变化。未知锁只有本页存活期，关闭弹层不释放；离开/刷新会丢失保护，不代表取消服务端请求。真实浏览器晚响应证据由单独测试片补充，尚未验收。

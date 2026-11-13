# Git 提交操作 owner：跨生命周期设计与可执行核心

2026-11-13 19:03 UTC。基线 f9efbde。**核心实现已加入，但尚未接 UI/Provider；当前用户界面仍只有同挂载保护。**

## 已实现并单测的核心合同

`apps/web/src/features/workspace/lib/git-commit-owner.ts` 是可执行设计，不持久化到浏览器 storage，不创建服务端操作键。

- 一个已认证 app 生命周期一个 owner；同项目 pending/unknown 禁止再次提交，不同项目可独立推进。
- 提交入口同步冻结 projectId、paths、message 与操作序号/授权 epoch，再调用 transport。无身份或输入不完整不调用 transport。
- 提交者组件消失不影响 owner 收集结果；只读操作没有解锁 API。pending/unknown 不可 dismiss。
- revoke/activate 都变更 epoch，清除旧记录；旧 pending 在 ABA 后完成不能改新记录、释放新锁、刷新缓存或返回旧结果给新 consumer。
- 订阅者可在 pending/终态发布时同步撤权，因此发送前、终态发布后及异步刷新后都检查 epoch。
- 仅 `GIT_COMMIT_PATHS_REQUIRED` + HTTP400 是审查过的写入前拒绝。其他异常、畸形响应均 unknown。完整40/64位 SHA 是回执格式验证，不是操作身份认证。
- transport 成功和缓存刷新是不同阶段：回执进入 committed 后，刷新失败不会降级 unknown。异步刷新错误被等待/交回仍有效的 consumer，撤权后不传播旧错误。

25 项单测覆盖上述合同。独立 CR 发现终态发布期间撤权仍返回旧结果、async 刷新 rejection 无消费者两点，均修复并新增回归。尚无跨路由 UI 或真实断网端到端证据。

## 下一片接入步骤（尚未完成）

1. 在 AccessGate 内、Routes 外加入 auth-scoped Provider，遵循现有 PromptBindingOperationProvider 的身份/StrictMode合同。认证身份使用 `browserCreationScope`，不存 token。授权失效事件必须同步 revoke，不能仅依赖组件晚到的 effect。
2. WorkspaceInspector 传入明确 projectId。GitChangesTree 从 owner snapshot 恢复 pending/unknown/committed 记录，锁由 owner 决定；不再单独维护会错误重置的局部锁。保留 standalone 测试适配，但生产路径缺 owner 必须 fail closed。
3. 实际 transport 不经会把 invalidateQueries rejection 混入 mutation rejection 的旧回调；直接捕获 project endpoint + payload，成功后单独刷新原项目缓存。禁止导航到当前新项目、清空新项目草稿或用旧结果覆盖新输入。
4. UI 显示原 project 名称/ID、说明、路径、状态与人工核对入口。历史/状态 GET 只提供核对信息，不能凭相似 message/HEAD 变化自动解锁。unknown 永不“重试旧 POST”。
5. 集成门：关闭/打开抽屉、切 tab、项目 A→B→A、同项目多个 session、路由离开返回、无consumer完成、auth A→B→A、严格模式、旧终态晚到、失效事件同步 fence。覆盖390/1440截图、长路径、axe及真实HTTP传输失败。

## 不在本阶段承诺

硬刷新、重新登录、多标签页、服务端重启与多客户端不提供去重保证。需要服务端 operationId/request hash、持久结果查询及仓库级互斥/expectedHead协议另立设计。Git hooks/外部并发修改不能靠前端 owner 完全解决。不得以 HEAD/message 相似推断某次未知操作已经成功。

## 视觉证据分开记账

19:03 UTC 新核验旧提交2bc0086的CI43482131266手机40文件图：390×844，目录clientHeight203/scrollHeight1932，首屏Diff可见238px；滚到末项scrollTop1729仍保留Diff；axe=[]。这是旧产品变更的新证据核查，不算当前阶段新增UI优化。新unknown提示390/1440浏览器门已加入，运行截图待新CI。

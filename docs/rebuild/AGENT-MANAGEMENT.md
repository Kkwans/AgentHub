# Agent 精确管理切片

基线 7bbead8。新增 /agents/:agentId 与卡片管理入口，GET /agents 精确唯一ID读取，不回退首项。只使用既有PATCH /agents/:id更新defaultModel/defaultMode；trim后空值为null。页面不提供启停/启用禁用/删除/preflight，不展示原始config/args/connection。

展示名称/Agent类型/状态/启用标志/精确目标ID及可用名称，能力为已保存报告而非实时探测，最近检查时间不冒充最近成功时间。LOCAL_HOST/Docker/REMOTE_NODE/未知与缺失类型准确区分。默认设置仅用于未来会话默认选择，供应商支持不保证，现有会话不在此更新；服务端无revision/CAS，最后保存覆盖同名字段，页面明确提示。

保存所有权绑定route ID与认证身份；卸载、身份改变、auth-required使旧结果无效。成功响应必须完整、ID/targetId匹配冻结对象、默认值匹配提交。异常/丢响应进入未决，不重放PATCH；只读GET比较当前值，用户显式采用服务器值后才恢复编辑，或离开页面放弃本页核对。离开不撤回请求，草稿及未决状态不持久化；刷新后只显示当前服务器状态，不声明先前请求归属或成功。

初始环境名称读取与编辑解耦，缺失环境名称不伪装Local也不无限阻塞Agent默认编辑。异步结果不会跨Agent/管理员覆盖页面。仅显示已知true能力与可解释状态，未知响应阻断保存确认。

验证：AgentDetail+AgentCenter+原合同共29项定向通过（含StrictMode、精确ID、无效/重复ID、null清空、错误ID/目标/值/形状成功响应、丢响应readback、不同readback、缺失readback、身份变化/迟到响应、auth撤销与重复提交）。web typecheck通过；修正2处lint后ESLint通过。真实E2E已收集9项：4宽双主题真实PATCH与reload，另1次真实提交后故意丢响应/只读核对；验证其他Agent不变、无Session创建。浏览器/像素门禁尚未运行，需加入CI显式文件清单。已集成开发工作树，等待完整门禁和发布后的精确HEAD验证。

CR修正：未决请求保留冻结expectedTargetId，readback必须同时匹配Agent ID与目标ID。目标变化即锁存身份异常，不能显示值一致、采用或继续保存，必须返回列表重新进入。标签/能力函数抽出纯agent-presentation模块，详情不依赖整页Center。此增量30项专项通过（18详情+10卡片+2原合同），web typecheck/ESLint均通过。

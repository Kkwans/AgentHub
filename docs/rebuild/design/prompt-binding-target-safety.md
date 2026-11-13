# Prompt 绑定目标来源边界

本片只处理 Project / Agent / Task 绑定目标的可确认性，不更改版本来源选择器或绑定请求 payload。

- 初次不自动选首项，用户明确选择目标；切换类型仍明确清空目标 ID。
- 读取失败、首次加载、任何非 idle fetchStatus（含 paused）均不能提交。刷新失败保留原选择，但不能当作当前有效记录。
- 成功响应删除原 ID（包括全部删空）后显示需重选，不自动替换为另一个目标。
- 按钮禁用之外，mutation 在实际执行前再次检查对应 QueryClient 当前状态和 ID membership；旧 render 的提交函数不能绕过更新中的缓存。
- 重试只调用目标源 GET，不创建资源或发送绑定请求。成功空列表明确告知需要先创建项目/工作或接入 Agent。
- 现有标签/版本选择、绑定 onSuccess 与版本创建生命周期保持不变。

## 验证范围

参数化三类来源的首次 pending/error/empty、缓存 error/fetching/paused、保留原 ID、全部删除、显式重选 payload；直接调用 mutation 检查拒绝时无 POST。真实 Prompt 流程保持弹窗键盘、Escape 与焦点回退，并新增无 Agent 的真实空态、注入 GET 503 错误、移除拦截后的真实恢复截图。实际浏览器验收以发布后的 exact-SHA CI 为准。

## 未解决的既有边界

本片没有修改绑定请求发出后关闭/重开弹窗或切换 Prompt 的 mutation 所有权、迟到成功回调、未知结果核对机制。不能据本片声称这些生命周期已经安全。仍由后端校验真正的对象存在性与权限，前端 membership 不是授权机制。

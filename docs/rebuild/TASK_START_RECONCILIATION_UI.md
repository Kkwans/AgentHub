# 普通任务启动记录：只读核对

## 边界与方案

现有普通 Task 的启动/返工可能返回未确认结果。服务端已有启动尝试只读接口，但此前前端只刷新 Task，不能看到原 attempt 的阶段与 Session/Run 身份。本片在普通任务详情提供显式“查询启动记录”，不自动查询、不启动 Agent、不释放 claim、不修改任务/unknown状态，不提供重试写入口。

- 先 GET Task 核对 projectId/taskId，再 GET `/tasks/:id/start-attempts`。
- 查询键含授权 scope、projectId、taskId；切换身份/任务时卸载旧实例，授权失效即隐藏结果并拒绝查询，迟到响应不得返回到新视图。查询缓存 gcTime=0，不持久保存记录。
- 服务端采用统一认证，现有 principal 均 ADMIN；接口没有按发起者 owner 过滤。显示“历史记录”，不能称“你的操作”。
- 只接受公开九字段，校验归属/阶段/时间/重复编号，不渲染额外输入摘要或正文。阶段文案保留保守语义，RUN_ADMITTED 不等于完成。
- 历史按创建时间倒序仅为展示，不由排序推断当前操作。技术身份与原始阶段/安全错误码/时间收进原生 details，正文保持紧凑。
- 空数组、404、读取失败都不是原操作未执行证明。面板永远只读，不影响既有按钮许可、未决锁或导航。

## 验证要求

专项覆盖：显式两次GET且无POST；UNKNOWN无解锁/重试动作；空记录与错误保留不确定；任务/账号切换及授权撤销丢弃迟到回包；项目身份错误阻断后续GET；公开字段白名单与混合归属/重复ID拒绝。真实四宽视觉及关键交互须在精确提交CI补验，不把静态测试称实际浏览器证据。

## 独立后端发现，不在本片修复

2026-11-14 03:47:17 UTC 前完成隔离 memory PGlite 复现：两个实际 TaskStartAttemptRepository 共享内存DB，A reserve→markCreateAttempted，B recoverAfterRestart 将原尝试置 UNKNOWN，A recordSessionReady 返回 false。全 startup 在 listen 前调用全表恢复；另一个活跃服务可能被恢复流程误伤。

复现使用 `node --input-type=module` 导入当前 `packages/db/dist/index.js`，只在内存创建 Target/Project/Agent/Task，Agent executable 为未调用的 `/bin/false`；核心调用如下：

```js
const a = new TaskStartAttemptRepository(memoryDb);
const b = new TaskStartAttemptRepository(memoryDb);
await a.reserve(validStartFixture);
await a.markCreateAttempted(attemptId);
await b.recoverAfterRestart();
await a.recordSessionReady(attemptId, { externalSessionId: 'still-live', startedAt: new Date() });
```

实际结果：CREATE_ATTEMPTED → UNKNOWN，ready accepted=false。这仅证明双Repository持久状态冲突，不是独立PostgreSQL多连接、完整双Service启动或真实Agent双派发验证。旧“S64双创建Session”已被S66持久预留修复，不能混为当前缺口。后续需要完整双Service barrier回归和明确单writer/实例fencing合同，不能简单跳过恢复或超时释放UNKNOWN。

03:54 UTC进一步核实 `packages/db/src/client.ts` 支持真实 PostgreSQL（DATABASE_URL，pg.Pool），不只是单文件PGlite；所以不能用“数据库只能单进程”排除恢复归属风险。必须先明确是否支持多活runtime。若选择单writer，需在恢复之前取得持久排他所有权，并设计连接丢失后的撤销/fencing；仅在启动时拿一下锁再释放不足够。若选择多活，需实例epoch与全部异步副作用/恢复选择条件联合设计。两者都不是本次只读UI片的隐含承诺。

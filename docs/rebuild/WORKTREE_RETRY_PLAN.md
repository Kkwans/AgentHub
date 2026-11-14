# Worktree 合并显式重试方案

状态：2026-11-13 23:52 UTC 代码与本地回归实现完成，精确CI/真实浏览器待验收。设计审查时间23:22 UTC。

## 问题与目标

当前合并键由 executionId + runId 固定派生。权威 REJECTED_PREWRITE 可安全证明旧键没有派发，但同审阅重复点击仍只能重放旧拒绝。不能在 catch 中直接更换 UUID，也不能凭 execution.errorCode 或 GET 404 推断未执行。

目标是在用户重新读取差异、再次确认后，为已证实未写入的合并生成新持久 attempt；未知、执行中及成功操作不轮换。旧请求不得派发任何新代际。

## 数据与协议

1. 为 worktree_executions 增加 git_merge_generation，整数 NOT NULL DEFAULT 0，CHECK >= 0。generation=0 保留现有 v1(executionId, runId) 键，确保历史 ledger 仍可查。后续使用 v2(executionId, runId, generation) 派生；不伪造历史 owner/ledger，不把未知旧记录自动迁移成安全记录。
2. review 返回 expectedRunId、expectedOperationId 及从权威 ledger 得到的 retry eligibility。资格不是客户端授权，数据库仍必须重验。
3. 所有 merge POST（包括首次）必须带 expectedRunId + expectedOperationId。显式重试额外带 retryOfOperationId。不能仅保护 retry：延迟的旧普通请求同样可能错误地派发新 attempt。
4. 客户端在只读更新 review 后重新勾选确认，确认标识包含 run + attempt。新 token 不能沿用旧差异和旧勾选。

## 数据库原子决策

扩展 claimReviewForMerge，维持 Execution → Task → Session → Run 锁序，并验证当前审阅、归属、Project、run、generation 与请求CAS。普通请求只可领取其对应 attempt。重试在同事务读取旧 ledger，严格要求 owner/project/operation 一致且 phase=REJECTED_PREWRITE；再原子递增 generation、进入 MERGING、返回新 operationId。越界、过期、缺失、错误归属及所有非拒绝终态都拒绝轮换。

成功只指事务提交，不把回执丢失当事务失败。领取后响应丢失保留 MERGING，重复请求不能再递增；协调器仍是唯一 Git dispatch 授权来源。错误 claim 不能通过通用 catch 将较新的执行倒退为 REVIEW。

## 实施切片

- DB：schema、迁移/meta、持久代际与CAS回归。
- 服务：统一派生 helper、review admission、merge请求契约、事务异常与重启恢复。
- UI：权威可重试态、重新确认、stale response丢弃；不得只按错误码解除未知。
- 更新API类型、真实HTTP/浏览器测试及三份台账后统一启用，不单独上线未闭环的随机新键。

## 验收矩阵

并发重试只有一方递增和派发；旧普通/旧retry请求不派发；跨run stale token被拒；服务重启键稳定；事务回执丢失不重复；UNKNOWN/DISPATCHED/成功/404/错误scope均不轮换；winner claim不变；请求消息变化不能复活旧键；前端必须重新读取差异和确认；新旧版本请求明确拒绝，不降级成legacy不带CAS写入。

完整类型/lint/build、全量回归及真实四视口浏览器验收通过后才宣称闭环。此文档不是实现完成的证据。

## 实施验收记录（23:52 UTC）

已实现0013迁移及持久generation、兼容v1派生、DB原子claim和权威拒绝重试、HTTP全部merge请求CAS、review快照绑定许可、UI按原attempt核对并重新确认。普通请求存在旧ledger或非空errorCode一律拒绝，防止缺失ledger+失败标签绕过只读许可。

最终冻结tree7d78d9f：1698测试通过/10跳过，168文件通过/4跳过，402.81s；DB55、server66、UI61定向、types/lint/build通过。测试包括磁盘重开generation、事务提交后回执丢失模拟、真实PGlite/coordinator预写拒绝与一次Git回调、UI晚到响应。Git回调为替身，不称真实Git retry浏览器验证；PostgreSQL多进程与断电未验收。现有四视口真实Worktree流程已更新CAS协议，待精确CI；本地Chromium启动仍受socket限制。optional live协议已同步但未运行真实外部Agent。

00:12 UTC新增真实HTTP/Git验收已通过：双仓库实际hook竞争、目标实际merge、重开后旧key不能提交后续草稿。Agent审阅链条seed。四视口浏览器实际Git测试已纳CI，执行仍待远端结果，不能从静态/list推定通过。

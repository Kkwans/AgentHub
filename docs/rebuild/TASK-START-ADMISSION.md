# 普通 Task 持久启动预留方案

状态：S64 设计与复现阶段，尚未实现；不将本文当作运行安全保证。
基线：S63 `7b05581`。关联 M1.2、AH-001；S62/S63 的 Worktree 护栏不能关闭本问题。

## 1. 需要解决的用户问题

同一任务在两个服务实例同时启动，或普通启动和隔离入队竞争时，只允许一个启动尝试取得执行所有权。刷新、请求超时、进程重启后仍可核对原操作；不得因为没有收到响应就再次创建 Agent Session。返工同样适用，且迟到的旧结果不能覆盖新一轮。

不是新增一把进程内锁。当前 TaskService 已有单实例同步准入；缺的是副作用之前的持久归属及恢复证据。

## 2. 已有事实与不能采用的捷径

| 现状                                                               | 后果                                   | 方案约束                                                         |
| ------------------------------------------------------------------ | -------------------------------------- | ---------------------------------------------------------------- |
| TaskService 先调用 SessionService.create，再把 Session 绑定到 Task | 两个调用可在归属写入前各自创建 Session | 预留、Session 行和 Task 绑定必须同事务，且早于 adapter 调用      |
| 创建失败返回 handleCleanup，但 Session 只存 FAILED                 | 重启后无法区分未尝试和结果未知         | 错误响应不是恢复账本，需要持久阶段                               |
| Session 恢复不包括 CREATED；Task 恢复只处理已有 Run                | 在新 Run 之前崩溃不能靠现有恢复收敛    | 必须覆盖预留至 Run 落库的每一处崩溃窗口                          |
| 普通 Run 准入不要求 Session 是 Task 当前 Session                   | 孤立或旧 Session 仍可能新开 Run        | 预留与后续 Run 所有权必须共同闭环                                |
| 已有普通关联 Session 允许直接继续发消息，但不自动重启 Task         | 全面禁止所有旧状态消息会改变产品合同   | 明确区分当前 Session 继续对话与旧/孤立 Session，不能暗中改变两者 |

拒绝的捷径：仅提前更新 IN_PROGRESS；仅增加另一个 Set；先查 Session 再更新 Task；把任何 FAILED 或 createSession 抛错认定为无副作用；用超时租约自动释放；只阻止第二次 HTTP 请求而允许旧 Session 派发。

### S64 确定性复现

在基线构建上使用独立内存 PGlite、两个 TaskService 实例和 fake runtime。让两次 create 均持久化 Session 后停在 barrier，再依次放行；没有实际启动 Agent 或读写用户目录。

| 检查点                                           | 实测结果                           |
| ------------------------------------------------ | ---------------------------------- |
| barrier 放行前 Task                              | READY，sessionId=null              |
| fake create 边界／已持久化 Session               | 2 次／2 条                         |
| 第一请求／第二请求                               | 成功／INVALID_STATE_TRANSITION     |
| 第二条 Session                                   | READY，但不是 Task 当前 Session    |
| 对孤立 Session 直接调用真实 RunRepository.create | 成功；原 Run 与新增 Run 均 RUNNING |
| fake runtime startRun 次数                       | 1 次                               |

结论仅证明副作用边界已被两个调用越过、持久孤立 Session 可获 Run 准入。**不是实际适配器双派发证明，也不是独立 PostgreSQL 多连接测试。** 同一脚本按 barrier 控制，不依赖随机延时碰运气。首轮脚本误传 SessionRepository.list 参数导致的夹具错误已修正，最终断言全部通过；不把夹具错误当业务红测。

## 3. 最小持久模型

新增独立的任务启动尝试记录，而不是复用 Task 创建 operationId。创建 Task 的幂等和启动 Agent 的副作用是不同操作。

建议记录：

- attemptId、taskId、sessionId、kind（START/REWORK）、expectedOldSessionId；
- 预期 Task 状态、目标 Agent、项目，以及必要的不可变输入快照/摘要；
- phase、safeErrorCode、createdAt、updatedAt，以及恢复核对结果；
- 可选 runId：只在同一归属的 Run 已持久化后填写。

同一 Task 只允许一个未决启动尝试，数据库唯一约束与 Task 行锁双重保护。终态尝试保留审计，不删除失败记录。当前尝试指针与精确更新条件必须避免只靠时间戳选“最新”。实现时选定唯一来源，不同时维护两个会漂移的“当前”定义。

阶段不是外部 Agent 实际状态的猜测：

| 阶段             | 已知证据                                 | 允许的恢复                                                                    |
| ---------------- | ---------------------------------------- | ----------------------------------------------------------------------------- |
| RESERVED         | 事务已预留；尚未提交外部创建尝试标记     | 可确定没有通过该尝试调用 runtime；精确 CAS 结束尝试并保留可见失败，不自动重放 |
| CREATE_ATTEMPTED | 调用前标记已提交                         | 无论进程是否真的执行到调用，都按结果未知处理，不再调用 createSession          |
| SESSION_READY    | 当前尝试的 handle 已创建且结果持久化     | 核对原 Session；不能重新创建替代 Session                                      |
| RUN_ADMITTED     | 当前 Session 的 Run 已落库               | 转交既有 PREPARING/ATTEMPTED Run 合同，不另造终态判定                         |
| FAILED_KNOWN     | 具有明确、持久的无外部尝试或确定结束证据 | 精确更新本次归属后，允许用户重新发起新的尝试                                  |
| UNKNOWN          | 创建、保存或清理结果不能确认             | 保留归属，显示核对入口，禁止自动重试和手工改状态绕过                          |

RUN_ADMITTED 表示启动预留已移交给持久 Run，不是 Run 已终态。Run 插入、Session.latestRunId 和 attempt.runId/phase 必须同事务提交；不能留两套恢复证据的断档。唯一未决启动约束在移交后由 Task/Run 准入继续保护，不因此允许同任务再次 START。

FAILED_KNOWN 的证据白名单仅包括可核验的未调用标记和权威结束结果；NOT_ACQUIRED、Session FAILED 或 close 返回均不能单独成为释放依据。

`HANDLE_CLOSE_RETURNED` 只能记录 adapter.close 返回，不能写成独立证明 OS 进程已退出。没有 handle、超时和网络错误都不能证明创建请求未执行。

## 4. 事务与运行边界

### 4.1 预留

1. 完成项目、Agent、Prompt 等无副作用校验。校验快照不作为最终准入授权。
2. 锁 Task，核对 START 的 READY 或 REWORK 的 WAITING_REVIEW，以及精确旧 Session、Agent/项目、未决 Run 与 Worktree 归属。
3. 同事务创建 CREATED Session、启动尝试，并将 Task 绑定到该 Session/Agent，转为 IN_PROGRESS，清理只属于旧审阅轮的 finalRunId/completedAt。
4. 只有成功提交的赢家可以进入 runtime；失败者零 adapter.createSession 调用，也不创建孤立 Session 行。

与 Worktree 入队共享 Task 锁。不得反向取得 Execution 锁，避免违背现有 Execution→Task→Session 顺序。普通流程统一 Task→Session→Attempt/Run；实现前列出所有相关写路径的锁序并独立审查。

### 4.2 外部调用

RESERVED 的恢复释放与 CREATE_ATTEMPTED 标记必须对同一 attempt 做互斥 CAS，恢复先赢时原请求不能再调用 adapter；不能仅根据先前读到的 RESERVED 继续。只有成功提交 CREATE_ATTEMPTED 的赢家才调用 adapter。不能在长数据库事务里等待外部进程。成功、失败和清理回写必须 CAS 当前 attempt/Session 身份；迟到响应只处理自己持有的 handle，不激活已失去归属的 Session、不修改新 Task。

SessionService 的公开 create 与内部 Task 启动入口必须明确分离。REST 正文不能伪造内部准入参数。关联已有 Task 的公开创建不能静默绕过预留；需要拒绝或路由到相同合同，保留无 Task 的普通 Session 创建语义。

### 4.3 Run 准入及状态操作

- Task 关联 Run 必须符合当前 Task/Session/Agent/项目身份；旧和孤立 Session 直接 Run 应明确 409，不能误标派发未知。
- 当前普通 Session 的“继续对话不自动重启 Task”合同单独保留并测试，不将身份约束扩成未声明的状态禁令。
- 初始专属 Run 与 direct caller 的竞争仍需事务化归属，不能让 direct caller 抢走启动尝试后专属路径错误 BLOCKED。
- 手工状态修改、取消、Worktree 入队及重新启动均检查未决尝试；不能用 BLOCKED→READY 清除 UNKNOWN。
- 后续 Run 派发与终态继续使用已有最新 Run 所有权和 PREPARING/ATTEMPTED 证据。

## 5. 重启恢复与迁移

恢复在 listen/队列恢复之前完成，失败则不开放启动入口。重复恢复幂等且无 adapter 创建/发送调用。

- 新尝试 RESERVED：结束确定未调用部分，只更新仍属于本尝试的 Task/Session。
- CREATE_ATTEMPTED/UNKNOWN：保持隔离，不能用 Session.status=FAILED 猜为安全释放。
- SESSION_READY 无 Run：展示原 Session 和尝试，不创建新 Session；跨进程 runtime 连接另按既有恢复能力核对。
- RUN_ADMITTED：先核对关联 Run，再调用既有恢复合同；不得制造第二个 Run。
- 历史 Session/Task 无尝试证据：保留 LEGACY_UNKNOWN 或等价的保守语义，不能把 CREATED/FAILED 自动回填为“未调用”。
- 迁移增量保留旧行及正文，不删除会话、不重写用户 Agent 配置。升级、重新打开数据库、重复迁移均需验证。

## 6. 实施切片与完成条件

### S65 候选：持久预留与完整失败恢复

一起交付持久模型/迁移、事务预留、内部 Session 入口、Run 所有权、手工状态互锁及 startup 恢复。不能只上线互斥而遗漏失败后的 UNKNOWN；代码过大时可在分支分提交，但在完整合同验证前不称此问题已解决。

首片必须提供最小核对出口：错误回执携带 attemptId/Session/阶段/安全错误，授权读取接口能找回该记录。完整交互可后补，但只返回“未知”而不能定位原尝试不算合格。UNKNOWN 隔离仅保证不重放，不等于用户恢复闭环已完成。

验收：

1. 两个 TaskService 实例同时 START/REWORK，仅一条 Session 和一次 adapter 创建。
2. 普通预留先赢/Worktree 入队先赢，另一方零 runtime 副作用。
3. RESERVED、调用标记提交后、adapter 成功未回写、READY 未 Run、Run 已落库五处重启；未知均不重放。
4. 迟到成功、失败清理和回调不覆盖新身份；未持有的 handle 不被关闭。
5. 旧/孤立普通 Session 的直接 Run 拒绝，当前普通继续对话合同不回归。
6. 活动预留时手工转换和重复操作不能解锁；确定未尝试失败可以显式再启动。
7. PGlite 与持久重开测试；另有独立 PostgreSQL 多连接准入/死锁检查，缺失时明示未验证。
8. 冻结 lint/types/test/build、真实临时 Git/ACP 闭环、独立 CR、精确提交 CI；不使用真实用户项目做竞态试验。

### 后续独立切片：用户核对/恢复与请求级幂等

在已有组件内展示原 attempt/Session/Run、明确未知及可用行动，保留输入与操作身份，不自动重放。覆盖刷新、重复点击、多窗口、迟到响应与取消。启动 operationId 的请求重取不能等同新一次启动；认证归属沿用现有创建操作范围。跨进程 runtime 路由需单独设计，不能靠数据库预留冒称已有。

## 7. 边界

本文不改变 UI 视觉选择，不授权部署或合并 main。S63 的已有门禁仅验证 S63，不能当本方案已实施的证明。失败/未知恢复是否有用户可操作闭环是验收项，不允许以“数据库锁住了”代替可用性。

# Session 归档 / 恢复方案

## 状态与范围

2026-11-14 11:44 UTC：**仅方案，未实施**。当前先验收已发布 a2a0736 的文字搜索精确 CI、真实定位及新截图；不得把本方案当作已上线功能。重命名、文字导出与文字搜索不重复实施。

归档是持久化列表分类，不是关闭、删除、暂停或资源回收。恢复只取消归档，不自动 resume、创建 Run、重试 UNKNOWN 或调用 Provider。首片不包含批量归档、删除、自动归档、全文索引或跨会话正文搜索。

## 已核实基线

- `packages/db/src/schema.ts` 的 `agent_sessions` 已有 nullable `archivedAt`，无归档 revision。
- `SessionRepository.list(projectId?)` 当前返回全部会话，不过滤归档；`get(id)` 直接按 ID 查询。
- 生命周期状态为 CREATED / STARTING / READY / RUNNING / WAITING_APPROVAL / DISCONNECTED / FAILED / CLOSED。**不新增 ARCHIVED 生命周期状态**。
- 前端 `SessionRecord` 尚未声明归档字段；`SessionRail` 的本地搜索针对标题、项目、model/mode、branch/cwd，不提供归档切换。
- 未发现 Session 专用归档 / 恢复 API。已有 close/resume 不可复用为归档；CLOSED 也不代表底层进程退出已得到确认。
- Task / Run 准入 UNKNOWN、资源清理未确认及客户端请求 UNKNOWN 是独立事实；归档或恢复不清除任何这类标记。

## 数据与服务合同

### 独立 CAS

新增 `archiveRevision integer not null default 0` 及非负约束；不借用 `titleRevision`、时间戳或运行状态作为版本。

建议严格接口：

```text
PATCH /api/v1/sessions/:id/archive
{ "archived": true | false, "expectedRevision": integer }
```

- expectedRevision 范围 0..2147483646；严格拒绝多余字段及类型强转。
- 专用 repository 方法以 ID + archiveRevision 单 SQL CAS，返回 committed row；同值写也递增一次版本。
- 归档设置 archivedAt，恢复设置 null；只更新这两个归档字段，不改 lastActiveAt、状态、titleRevision、Run、messages、审批或任务关联。
- 服务区分不存在 404 与版本冲突 409；响应返回真实行，不客户端猜版本。
- 复用 Session 元数据写的 runtime admission + tracked Promise：停止后拒新写，已准入数据库操作必须排空后才能关闭数据库。不调用 Agent 新工作准入、Provider 或 Session close/resume。
- 当前认证遵循现有 ADMIN 模型，不声称用户级 owner 隔离。
- 保持所有既有后台 `list()` 默认语义不变。禁止全局默认过滤 archivedAt，避免后台恢复、任务关联、仪表盘、审批与运行查询意外丢对象。未来若加显式归档列表参数，应单独命名并保留旧调用行为。
- 避免通用 mutation 意外写归档版本；实施时核对 Session transition 的宽 patch 输入，保护专用 CAS 字段不被旁路覆盖。

### 活动与未知状态

优先以安全可发现性而非“看起来结束了”决定首片范围：

1. 理想完整分类允许任意状态归档，但必须保留运行 / 待审批提醒与直达入口，当前详情页不跳走、不卸载草稿；明确提示“归档不会停止已有工作”。
2. **若首片不能证明活动提醒仍可发现，只允许非活动状态归档**。保守候选白名单 READY / DISCONNECTED / FAILED / CLOSED；CREATED / STARTING / RUNNING / WAITING_APPROVAL 暂拒。
3. 白名单须结合真实最新 Run、未决审批和启动准入事实检查；仅看 Session.status 不能证明无活动或无 UNKNOWN。若无法在现有生命周期协调内与新 Run 启动正确线性化，不得做先读后写的伪安全门禁，应缩小范围并回报阻塞。
4. 有未确认启动或清理事实时不自动修复、取消或解除；可保守拒绝归档以保持可见。恢复作为纯分类读写不应要求 Provider READY 或重新连接。
5. 原先已归档的 Session 仍可通过 ID 读取消息、搜索、导出、审批、取消与清理；归档不新增对既有生命周期操作的隐式限制，也不在这些操作时静默恢复分类。

## 前端与响应丢失

- 操作放入现有会话工具区，不继续挤压 390px 标题；提供“归档会话 / 恢复会话”，明确与关闭区分。
- 侧栏显式“会话 / 已归档”切换；项目目录和 Home 的整理视图采用一致规则。后台总列表缓存仍完整，不能把局部过滤结果写回全量 `['sessions']` 缓存。
- 当前页归档后继续显示正文、真实运行状态和草稿，显示已归档标识及恢复入口。已归档筛选中仍可按已有元数据查找，不能没有恢复入口。
- 新客户端类型显式 archivedAt + archiveRevision。缺失或非法版本时只读，不推断为 0 后提交。
- 按认证主体 / epoch、Session ID、原版本及目标分类绑定操作；发送前保存并校验 pending marker。刷新、卸载或丢响应恢复为 UNKNOWN，仅允许显式 GET 核对，不自动重发 PATCH。
- 更高权威版本可支持用户发起新的明确意图，但不将当前状态归因为旧请求成功。同版本读回不证明原请求未发生；不得自动解锁重试。
- 旧 PATCH 成功、失败及 finally 都不能覆盖其他标签页的更高 pending marker。只读核对与展示文案不得持久写回旧阶段；真实跨标签页排他由服务器 CAS 保证，localStorage 不是锁。
- 认证变化、A→B→A、晚响应不能写新身份缓存。已确认成功后缓存刷新失败只提示尚未同步，不退回 UNKNOWN。更新归档字段不覆盖并发 titleRevision、正文定位、Composer 草稿和 Agent 配置草稿。

## 文件与分片

| 阶段         | 拟改文件                                                                                                                         | 放行条件                                                                |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| A：合同 / DB | `packages/db/src/schema.ts`、`repositories.ts`、migration SQL / journal、迁移及 CAS tests                                        | 原子冲突与真实返回；旧数据 default 0；无活动时间或运行数据改动          |
| B：服务端    | `apps/server/src/sessions/session-service.ts`、`session-routes.ts`、专用 archive tests                                           | 严格 API、运行边界线性化、停服 drain；零 Provider / cancel / resume     |
| C：UI        | `apps/web/src/lib/api.ts`；新增归档 state/helper/component/tests；`SessionRail`、`WorkspaceView`、项目目录 / Home 的显式整理筛选 | 未知写入跨刷新 / 标签页保护、可见恢复入口、草稿与历史不丢               |
| D：实际验收  | 新真实服务 E2E、PG CAS 集成、精确 CI 清单                                                                                        | 四宽双主题、原始截图、真实归档恢复 / 丢响应；不得仅靠组件 mock 声称完成 |

按阶段实现与独立 CR，但不得只发布隐藏会话而没有恢复入口的半成品。等待当前搜索 CI 验收后再决定代码片。

## 测试矩阵与迁移风险

- **DB**：双连接同 revision CAS 仅一胜；归档 / 恢复 / 同值写版本递增；非法版本；不存在；titleRevision、lastActiveAt、状态、Run 和 messages 不变。
- **旧 schema fixture**：新增列后，旧迁移测试若使用当前 Drizzle schema `.returning()` / `.select()` 会查询旧数据库尚未存在的 archive_revision。用明确旧列投影或原始 SQL 建旧数据，再迁移验证默认值；不要跳过旧版本迁移测试，也不要把新 schema 提前应用来制造假绿。
- **服务**：认证拒绝、严格 body、404/409；暂停 CAS 的 barrier 下停服等待；停止后拒新写；活动启动与归档交错的确切允许 / 拒绝结果；归档不触发 cancel/resume，恢复不启动，UNKNOWN 保持。
- **列表**：后台默认 list 仍含归档对象；普通 / 已归档视图互相切换；当前会话仍可读；活动 / 审批入口不丢；部分筛选不污染全量缓存。
- **客户端**：PATCH 实际提交但响应丢失、刷新、跨 tab 新 marker、迟到成功 / 失败、同版本读回、版本冲突、认证切换、A→B→A；无自动重试，核对 GET 不写 marker。
- **视觉与真实服务**：390 / 768 / 1024 / 1440 × 明暗，标题宽度和44px移动触点、横向溢出、键盘与焦点；实际数据库归档 / 恢复及原消息仍可搜索导出；无真实 Provider 调用。

**本文件未执行迁移、修改产品、调用 Provider 或证明真实浏览器通过。**

## 2026-11-14 12:18 UTC：DB候选与服务准入收窄

DB层已实现未发布候选，隔离PGlite 19文件193通过；0015旧schema实测不存在新列再升级0016。独立CR确认只新增归档列/非负约束、专用CAS、通用写入保护与后台list完整性。新增真实PG双连接锁竞争用例已发现4例，**尚未执行真实PG**，不得声称实际多进程验证通过。服务和UI未实施。

服务首片拟仅允许 **CLOSED且无待处理/未知操作或资源清理风险** 的会话归档。READY/DISCONNECTED可能随后启动，仅短锁检查不足以保证隐藏后不会出现工作；在活动/审批发现入口完整前，不支持这两类归档。CLOSED本身仍不是安全证明：还需核对blocking Run、approval pending/outbox UNKNOWN或DEAD、task-start UNKNOWN及准备阶段、preparation/run/lifecycle admission，以及未确认handle/资源清理。恢复始终只改变分类，不清理这些未知事实。

拟复用runtime admission tracking和activation commit队列对短DB检查+CAS线性化，停服应等待已准入写入；不得把Provider调用放进队列或把状态假定为资源已退出。该服务合同仍需专门竞态测试及独立CR，不能凭DB候选推断安全归档已可用。

12:23 UTC DB独立分片2a1f30f819准备发布；最终同树19文件193通过（51.69s）与drizzle check通过，指纹一致。只发布可单独验证的迁移/仓储能力，不提供隐藏会话的UI，因此不形成无恢复入口的半套用户流程。新增真实PG测试仍待专用CI执行；服务/UI没有完成。

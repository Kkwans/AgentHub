# ADR：Git 提交的持久派发与结果恢复

2026-11-13 19:33 UTC。状态：**源码审计与方案，不是已实现的服务端功能**。前端 owner 已接入，但本方案尚无 migration、生产API或Git派发接入。

## 目标与不承诺

目标是持久“至多一次派发”、同一请求结果可查询、未知操作禁止自动重复写入。不要宣称外部 Git 与 SQL 的 exactly-once 原子事务。前端刷新、认证提示重现后，重新认证的原账号应能查询原操作；GET/POST重放不能重新运行 Git。

已有 Task 创建操作可以在同一个 SQL 事务里创建 Task、绑定和映射。GitService 的 `git add` / `git commit` 是外部进程，数据库回滚不撤销 index、HEAD、hooks、签名、外部推送等副作用。

## 本轮核对的现状

- `apps/server/src/tasks/task-creation-operation.ts` 的owner从认证principal推导：browser按accountId、API token按tokenId、本地可信固定scope。不接受客户端owner。
- `TaskRepository.createIdempotent` 使用(ownerScope, operationId)唯一键抢占并在同一事务写任务及映射，不能直接复制其原子性到Git。
- `GitService.commit`：检查项目→验证paths→git add→读before HEAD→git commit --only→读after HEAD。没有操作键/持久结果/资源互斥。
- `runGit`超时30秒，非零统一409；Hook失败、超时都不能证明没有修改。add后即可能有index副作用。
- GitService明确拒绝REMOTE_NODE，但targets参数可选。新权威入口必须有明确已解析执行目标，不能将缺失target解析当成本地执行许可。
- Project唯一(targetId,realRootPath)不足以消除指向同一Git资源的别名；WorktreeGitService已有canonical common-dir校验可参考。
- 当前after HEAD是观测值。外部Git在commit完成后继续提交时，该值可能不是本次产生的commit；未来协议不得把它无条件叫“本操作精确SHA”。

## API候选

新增受认证的 `POST /api/v1/projects/:id/git/commit-operations` 和 `GET .../commit-operations/:operationId`。暂不更改旧commit端点的成功语义，先实现账本和只读查询，再迁移所有AgentHub写入口。

POST请求：protocolVersion=1、operationId(UUID)、mode、paths、message、expectedHead（完整40/64位SHA或明确null表示unborn）。客户端先保存只含scope/project/operationId的恢复标记，再发送；标记不是授权凭据，不存cookie/token。存储失败应显式提示恢复能力不足，不能静默声称可跨刷新恢复。

请求hash：固定字段顺序与协议版本，UUID小写；message与现有schema一致trim；path保留大小写与字符语义，不做操作系统无依据的大小写折叠。是否对paths去重排序必须先确认selected pathspec语义，首版保持原数组、重复key不同数组拒绝，避免过度规范化。

响应返回operationId、projectId、requestHash、phase、created/updatedAt、脱敏错误码及结果证据类型。GET的路径projectId必须与原记录projectId一致，并同时验证当前认证授权；不能仅按owner+operationId跨Project路径返回记录。GET不得运行Git写命令、刷新claim租约或自动重试。404可能是不可见/不存在，**不等于未执行**，不得自动解锁前端。

## 持久数据与资源身份

建议两表，独立migration并升级/重开测试：

- `git_commit_operations`：ownerScope + operationId复合主键；projectId；protocolVersion；requestHash；冻结payload；target/执行设备身份；canonical common-dir与worktree identity（仅服务器内部）；expectedHead；phase；dispatchToken；before/observedAfter；commandExit；resultEvidence；错误码/时间。不可用级联删除把unknown账本与锁一起丢弃。
- `git_write_claims`：repositoryKey主键；ownerScope/operationId外键；dispatchToken；phase。repositoryKey按明确执行设备+canonical Git common-dir保守串行，覆盖关联worktree/别名；worktree identity另存并在派发前复核。首版不使用仅projectId内存mutex。

local target别名不能绕过锁：同一执行进程上的多个LOCAL_HOST target仍须映射同一实际设备身份。remote暂继续拒绝，不能靠字符串targetId分离同一磁盘资源。

## 状态与派发权限

| 状态 | 本操作还能派发Git吗 | 重放/查询行为 |
|---|---|---|
| RECEIVED | 仅原子claim胜者、尚无任何写命令时 | 返回状态；竞争者不得启动第二进程 |
| DISPATCHED | 否 | 返回运行/待确认状态 |
| COMMAND_SUCCEEDED | 否 | 返回持久命令成功证据，不重新执行 |
| REJECTED_PREWRITE | 否 | 返回原拒绝；改内容需新操作键 |
| UNKNOWN | 否 | 保留资源禁写并要求核对 |

创建operation+抢repository claim在同一短事务中完成，hash不符409。同操作键不能靠改payload重用；新键也不能绕过UNKNOWN资源claim。**先提交DISPATCHED记录，再调用第一条写命令git add**。不能持有长SQL事务运行Git并用回滚假装去重。

expectedHead须在获得资源claim并复核资源身份后、第一条写命令前重新读取并严格比较。null必须证实为unborn分支，读取失败不能当unborn；不匹配仅在尚无写命令时记录REJECTED_PREWRITE。它只能检测该时刻已发生的HEAD变化，不能消除外部Git随后并发；路径/说明hash也不绑定文件内容快照。是否要求已审阅index/tree指纹以及如何原子验证，需单独协议决策，不能拿expectedHead冒充内容快照。

终态更新与claim释放必须在同一事务，CAS严格匹配ownerScope、operationId、dispatchToken及允许的前态；不能覆盖UNKNOWN或释放不属于本次派发的新锁。仅已持久化的COMMAND_SUCCEEDED和可证明无写入的REJECTED_PREWRITE可在上述事务中释放；UNKNOWN/DISPATCHED不得释放。命令成功但结果落盘失败保留UNKNOWN禁写，不用catch/finally无条件删除claim。

不要因超时/lease过期自动夺锁。旧worker、hook或子进程可能仍活着。启动恢复扫描必须记录并核对worker/boot身份，多实例不能把其他仍活跃实例的DISPATCHED一律当遗留；确证遗留后标UNKNOWN并保留资源隔离；除非有可证明的进程终止/结果证据协议，不重新派发。无“清错误即重新提交”按钮。

## 崩溃窗口

1. 记录创建前：无Git写入。
2. RECEIVED到DISPATCHED前：仅原子claim获胜者可进入派发；若实现重领，须证明状态从未派发。
3. DISPATCHED到第一条命令前：崩溃也保守UNKNOWN，牺牲可用性换不重复写。
4. add后失败：index可能变动，不能称前置拒绝。
5. commit成功到SQL结算前：UNKNOWN；不得靠HEAD变化、message相似、时间接近恢复成成功。
6. SQL成功结果已持久化、HTTP响应丢失：原owner通过同操作查询获取记录，零Git重放。

## SHA归属的开放决策

首版应区分“Git命令已成功退出”和“本操作精确产生的SHA”。可记录observedAfterHead但必须标为观测，不让UI当作精确操作链接。仅凭readHead、短stdout文本、message/reflog相似均不是充分的跨并发归属证明。

更强证据可能需要操作标识绑定的Git ref/reflog或原子ref更新协议；必须单独审查禁用reflog、外部并发、hooks、GPG签名、index语义、worktree及恢复可用性。不得偷偷改用commit-tree来绕过用户hooks/签名。方案未决前，不发布“精确SHA已权威恢复”的承诺。

## 权限、前端与未知处理

- 每次GET/POST都重新校验当前principal。browser同账号重新登录可读原记录；不同账号/其他token返回不暴露存在性的404。operationId不是能力令牌。
- owner离线或撤权不能抹除服务端record/claim；前端只清视图。新身份不显示原payload/路径。
- 请求payload、内部root以及Git输出可能包含私密数据；只向当前可授权scope展示必要记录，日志不复制完整路径/说明/输出，限制保存量并制定保留策略。unknown不能TTL静默释放。
- 人工核对后的解除隔离必须作为独立审计动作设计；本阶段不提供删除unknown/重新执行捷径。

## 按顺序落地与验收

1. DB migration/repository：唯一键、hash冲突、资源claim竞争、terminal CAS、关闭重开、升级与重复migration。旧数据保持；不执行用户Git。
2. 受权GET和reserve/claim API：跨账号/token/撤权、404不推断未执行、大小写operationId、同key不同hash、两个project别名同repo锁。保持写入口未迁移时明确“不具备权威幂等”。
3. 隔离/tmp Git执行器：注入每个崩溃点、真实add/commit/hooks超时、并发重复请求；记录子进程调用次数和HEAD/index变化。任何测试均不得操作实际用户仓库。
4. 所有AgentHub Git写入口统一claim，包括legacy commit与worktree动作的互斥关系；再切生产API。不允许旧端点绕过未知锁。
5. 前端持久marker与恢复查询：刷新/认证界面失败/重新登录/多tab、旧响应ABA、无consumer完成、只读恢复结果；390/1440截图和axe。
6. 服务重启后的UNKNOWN保持禁写、人工解除协议及SHA归属证据另行验收。当前未实现上述服务端功能。

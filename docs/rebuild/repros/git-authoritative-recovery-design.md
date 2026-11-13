# ADR：Git 提交的持久派发与结果恢复

2026-11-13 19:33 UTC。状态：**DB基础层已实现候选，完整恢复仍是方案**。前端 owner 已接入；0011 migration、操作/claim repository已加入；DB-only受认证GET已接入，canonical资源解析器和协调器已有可执行测试，但生产Git写路径尚未接入。

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
6. 服务重启后的UNKNOWN保持禁写、人工解除协议及SHA归属证据另行验收。当前仅第1项休眠DB基础层已加入；DB-only查询API与休眠协调层随后加入；生产写入统一协调、执行恢复与前端持久接入均未实现。

## 19:49 UTC DB基础层实现范围

`0011_git_commit_operations` 增加操作记录和canonical repository claim；Repository原子预留/重放、派发前CAS、UNKNOWN保锁、成功或可证无写拒绝与释放同事务。无TTL、无抢占、无UNKNOWN出边；无实际Git调用。claim冲突会回滚新操作行，旧请求只返回已存记录。

**可信边界**：Repository信任未来服务层从认证principal导出的owner、实际设备/canonical common-dir身份和规范请求hash；当前不独立证明payload/hash一致性。派发token不是客户端输入或访问凭据。PGlite并发测试只验证该适配器，不能替代真实PostgreSQL多连接测试。

## 20:05 UTC 资源/协调层与只读查询

新增 `git-write-resource.ts`：明确可信executionDeviceId，LOCAL_HOST资格、canonical worktree/common-dir；同设备project/target/symlink/linked-worktree别名共享资源key。探测使用隔离环境和`--no-optional-locks`，禁止环境GIT_DIR重定向；完整SHA或明确unborn才返回HEAD。嵌套项目根目录、REMOTE_NODE/DOCKER_CONTAINER与不支持精确missing探测的旧Git暂failclosed。**尚未安装到生产写路径**，不改变旧Git路径的目标支持。未来执行器必须使用与resolver一致的资源/环境语义，不能在校验后用继承环境重定向写入。

新增 `git-write-coordinator.ts`：冻结JSON请求、UUID小写与完整HEAD校验、稳定hash、重放只查记录；claim后重查资源及expectedHead，CAS响应不确定不写；callback异常持久UNKNOWN，成功先落盘再返回，落盘失败保留禁写。不返回无法持久重放的任意callback结果。测试涵盖真实PGlite并发与派发/结算丢响应、写异常、资源变化、payload冻结。

生产仅接入 `GET /api/v1/projects/:id/git/commit-operations/:operationId`：每次由认证principal推导scope，按scope+project+op查询，内部dispatchToken/worker/root等不返回；完全不探测Git、不改claim、不以404推断未执行。旧提交尚不创建此账本，故此接口**不是现有提交的自动恢复**。

### 全入口启用前的硬门

直接托管Git写方法为 `GitService.commit`、`WorktreeGitService.create`、`commitAndMerge`。后者的`merge-tree --write-tree`也写object，不能当只读。worktree queue需先持久保存认证owner和每写阶段操作身份；merge catch不能把派发未知一律还原REVIEW。不能以先GET无claim后旧命令执行代替原子reserve/CAS。三个入口必须统一协调后才启用新写API。PTY/Agent/hook/外部Git不受DB锁自动约束，承诺仅托管入口互斥，不是全仓排他或精确SHA归属。

## 20:19 UTC Worktree归属与真实未知结果止损

0012增加worktree execution的nullable `gitOwnerScope` / `gitCreateOperationId`，约束成对存在；历史行保持null/null，绝不猜身份。新HTTP queue从当前认证principal推导scope、服务端生成创建操作UUID并与execution一同入库；请求body不能覆盖。内部legacy调用仍显式ownerless，**完整coordinator启用前仍须决定历史缺失身份如何failclosed处理**。

真实临时Git实验表明：post-checkout hook失败后worktree目录/branch已存在；pre-commit hook失败后index已暂存且hook已写文件。因此 `WorktreeGitService.create` 自首次worktree add起、`commitAndMerge` 自首次add起，异常统一标 `WORKTREE_GIT_OUTCOME_UNKNOWN`，不再当作无写前置失败。已有merge失败处理仍可能调用`merge --abort`，不声称失败后零额外Git命令。

编排层未知create保SETTING_UP，未知merge或Git已成功但完成落盘失败保MERGING；已持久DONE不会因publish异常降回REVIEW。重启恢复也保留SETTING_UP/MERGING活动槽位：“尚无Session”不是“Git没运行”的证据。取消/rework/再次merge与后续同project队列不能绕过该槽位；身份错配不覆盖当前Task。

这是**实际生产worktree路径止损**，不是跨project别名互斥：普通commit和canonical repository claim尚未统一接入，其他project别名仍可能绕过project队列；用户终端/Agent也不受此锁约束。未知隔离目前不自动释放，无人工解锁API。

## 20:36 UTC 统一调用与客户端请求身份契约

`ManagedGitWrites.run<T>` 把COMMIT/WORKTREE_CREATE/WORKTREE_MERGE统一到同一coordinator；仅首次callback返回且成功持久化后交付临时T。重放不能凭持久状态重造worktree路径等返回值，更不能回退raw Git；结果未知/落盘响应丢失一律隔离。前置错误仅在协调器明确证明callback未进入时分类，不用任意异常猜测未写。**包装器尚未安装到三条生产写路径**。

客户端 `git-commit-recovery.ts` 只保存version/scope/project/op四字段，每op独立key；首次写入及读回成功才允许调用方考虑派发。原同op、损坏状态、存储不可用均要求恢复而非新提交。404/未知/网络错误不清marker；仅匹配当前认证scope/project/op且严格字符串终态的proof清单个marker。GET随后新增由认证查询绑定的scope，恢复driver同时核对当前auth epoch与返回scope，不信任客户端自报owner。跨标签页并发可能都通过前读，此模块不是互斥锁，必须依赖服务端claim。**尚未接Provider/UI/POST**。

新提交协议强制version=1、客户端UUID operationId和显式expectedHead（完整SHA或明确null），规范message/UUID/SHA但保留path顺序/大小写/重复。严格拒绝owner/device/dispatch等客户端伪造字段，STAGED不接受被忽略的paths。当前仅GET复用参数规范，旧POST仍未切换。禁止仅服务端每次给旧无key请求生成新key后宣称幂等：回执丢失后新key仍可能提交后来的改动。

## 20:52 UTC 持久逻辑协调域与只读恢复驱动

`getOrCreateGitCoordinationDomain` 在短事务锁app_settings/operation/claim后初始化唯一逻辑域UUID，多个初始化读取同一赢家。已有任意账本却缺域、设置损坏、active operation缺claim或双向key/token/worker/phase不一致、terminal残留claim，均拒绝启用；不修复、不续期、不生成新身份绕锁。文件DB重开及并发PGlite已测，**真实PostgreSQL多连接仍未实测**。

`createManagedGitRuntime` 将所有本地Project/target/mount路径强制映射该数据库单一claim key。它是逻辑协调域，绝不是物理设备证明；不同DB/外部Git不覆盖。保守代价：一个UNKNOWN将阻断该DB其他托管Git写。Factory未接index，生产三入口尚未启用它。worktree自定义base branch的baseSha不等于当前primary HEAD，接线时必须冻结正确expectedHead，而不是混用。

恢复GET现在额外返回认证lookup绑定的 `scope`（身份标识不是访问凭据），仍排除内部派发token和路径。新client只读driver按marker发GET，校验scope/project/op/version/hash格式与命令退出证据；已撤权/响应在途撤权不清marker或返回旧结果，404/未知/异常继续禁写。只有同scope精确终态才清单个marker，之后重读全部状态。**状态只属于marker原操作，不证明当前草稿已提交，不据此清当前草稿；未接UI或POST。**

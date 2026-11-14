# Infrastructure 视觉证据补齐方案

## 2026-11-14 16:51 UTC 现状核实

140张baseline是显式10路由×7宽×双主题，不代表所有页面。Runtime有14张；Nodes只有web-shell模拟API截图。真实agent-capability-truth进入diagnostics后只验标题/作用域，没有PNG。Node注册和详情有路由但暂无真实页面图。

| 路由 | 下一步 | 不得声称 |
| --- | --- | --- |
| /agents/runtime | 依据已实看旧图优化页头/扫描按钮/内容间距 | Runtime图覆盖全部基础设施 |
| /agents/nodes | 真服务空态四宽双主题 | 模拟API是实际远程连通 |
| /agents/nodes/register | 只读打开表单，验证字段/键盘与截图，不提交 | 已生成授权或注册节点 |
| /agents/diagnostics | 受控fixture下真实读取，收起/展开详情截图 | GET没有执行命令 |
| /agents/nodes/:nodeId | 后续隔离数据库合成离线Node详情/目录/inventory | 合成离线记录代表真实远程供应商 |

## 先决隔离

hostDiagnostics发现codex可执行时会运行版本与login status。当前fixture仅传AGENTHUB变量，服务器合并process.env，不能假定宿主PATH/HOME隔离。专用测试须显式使用受控PATH和临时HOME，保证不访问真实认证、不调用真实Provider；任何未知/不存在状态按事实展示，不伪造已连通。此文档阶段未运行新诊断。

## 首片验收计划

新增infrastructure-visual独立spec，390/768/1024/1440×浅深；Nodes空态、注册表单未提交、服务器诊断详情展开。保持真实服务读取、截图SHA/结果索引、页面无横溢、44px触点、键盘展开/回焦、console无错误。先补无授权写入流程，不生成注册码或撤销授权。纳入focused后独立人工审美，不仅看测试几何。节点详情另片建立明确合成离线证据。

## 2026-11-14 17:06 UTC 隔离设计进一步核实

现有fixtures在Playwright worker内startServer，服务器再合并process.env；只覆盖PATH/HOME不能称完全隔绝宿主凭据。新增独立、默认关闭的基础设施fixture应以process.execPath启动子进程，环境显式白名单、受控空bin PATH、临时HOME/XDG_CONFIG_HOME/XDG_CACHE_HOME/XDG_DATA_HOME/CODEX_HOME，不改全局process.env，不影响原Git/ACP fixture。不seedWorkspace、不注册Agent、不初始化Git。主诊断只从PATH找codex/opencode；空PATH可以阻断该路径启动CLI，但固定ACP adapter仍可能通过文件access显示INSTALLED，不能断言全部MISSING或将安装状态说成已认证/已连通。后续应验证子进程环境白名单与探测边界，再截图。

## 2026-11-14 17:18 UTC 首层测试基础

纯环境构造与absolute Node launch描述、空PATH零命令诊断回归已实现。正控制使用仅供PATH/access识别的临时无效文件哨兵，真实hostDiagnostics的版本/登录状态调用必须恰被两次mock拦住，并核绝对路径/隔离环境/参数，Provider launcher零调用。3个专项通过及独立审查通过。尚未创建目录验证/启动子进程/连接HTTP/浏览器；下一片必须补readiness、严格退出清理及运行前白名单/空目录核验，不能把当前描述对象称为已隔离运行。

### 2026-11-14 17:26 UTC 独立健康起停基础

新增测试专用独立Node child：导入真实server前检查环境白名单、空PATH与自有canonical目录，使用IPC报告固定就绪证明。父进程只请求loopback health确认PGlite/web。关闭必须收到close确认和正常exit后才清理自有目录，异常/超时保留；强杀不作健康关闭证据。

默认生命周期6通过1显式跳过；opt-in实际健康起停7通过，独立CR无阻断。仍未连接浏览器、执行诊断GET、注册节点或调用Provider；普通Git/ACP fixture未改，也不是OS沙箱。启动期IPC断开和强杀后未exit两分支尚缺直接测试，接线下一片先补，不用健康成功替代这些故障门禁。

### 2026-11-14 17:41 UTC 独立真实页面门禁候选

新增独立8例（四宽双主题）只在受控child访问Nodes空态、注册空表单未提交/返回、主诊断折叠展开。HTTP API限定auth/status、remote-nodes、agents/diagnostics/host三个GET；任何业务write或未知读取abort并失败。另有同源/ws，仅记录path和同源布尔，不记录帧/凭据，故不称全部网络只有三个GET。空PATH下源码已核不启动codex/opencode CLI，pinned adapter安装状态不代表认证或Provider已连通。

保持44px、overflow、console硬门禁，主/页面真实滚动到底≤1并恢复原位置；context关闭失败仍在finally关闭child。仅focused接线，普通Git/ACP fixture及full baseline未改。类型/lint/list8/独立CR过；本地首例因浏览器启动socket权限受阻，正文未执行，诊断GET与截图尚未发生。待精确CI实际图后才能验收，不是OS沙箱或生产服务隔离。

### 2026-11-14 17:45 UTC Agent发现页的额外宿主边界

只读审计确认/discovery/agents自动GET并非数据库快照：会调用hostDiagnostics、agents.list、runtimes.list与remoteNodes.list；runtimes.list默认经Unix socket直连/var/run/docker.sock并list/inspect，绕过空PATH与临时HOME。当前独立fixture尚未隔离该socket，因此不得访问发现页/Runtime或声称可覆盖它们。本轮没有执行该GET，现b452的Nodes/注册空表单/主CLI诊断不走此链。

先增加测试专用DOCKER_SOCKET_PATH指向自有目录不存在socket，preimport检查严格路径/父目录非symlink/目标不存在，并以真实客户端参数拦截正负控制验证，再考虑只读发现页图证。禁止为截图点重新扫描（会多次扫描）或接入（会注册并smokeSession）。这不改生产设置或系统socket权限，仍不是OS沙箱。

### 2026-11-14 17:52 UTC Docker socket 前置冻结

专用child白名单新增DOCKER_SOCKET_PATH=自有root/absent-docker.sock，preimport拒外部路径、普通文件和悬空symlink；默认17通过1显式跳过，主工程opt-in18/18通过5.57秒。真实DockerSocketEngineClient在HTTP mock边界验证成功空响应/ENOENT都只传受控socket，未连接任何真实Docker。真实child仍仅GET health；发现页/Runtime尚未访问，不将这些回归称发现页截图验收。

### 2026-11-14 18:28 UTC 下一发现页只读覆盖边界（尚未执行）

先等待ae8b919的新Nodes/注册空表单/诊断闭环，不将新入口修复等同于后续页面已跑。发现页下一片仍用独立child，不回到普通Git/ACP fixture；增加确切GET /discovery/agents、/agents、/execution-targets白名单，保所有业务写入拒绝和严格清理。

发现结果固定含Codex/OpenCode候选；pinned adapter可能仅文件access就显示INSTALLED/adoptable，不可伪造“候选为空”或把它说成已登录。真正可验证的是注册目录为空、真实候选与缺依赖状态。其GET会诊断和尝试Docker列表，必须保绝对空PATH、私有不存在socket及preimport验证，不笼统称纯数据库读或OS沙箱。

四宽双主题需拍发现弹窗顶部与自身/内部滚动到底，保44px、console/overflow和零写入门禁；仅“完成”关闭/回焦，不点击重扫、添加或授权。Node详情离线合成态和实际远程节点接通仍另行覆盖，不能由空态图推断。

### 2026-11-14 18:51 UTC 发现页新spec接线，实际图尚待

独立discovery-isolated-visual.spec.ts已准备四宽双主题8例，真实扫描完成再截图；允许auth/status、agents、execution-targets、discovery/agents四GET，不新增注册/扫描POST。完整触点bbox与内部滚动范围附证据；只完成关闭，回焦严格验证可能暴露既有缺口。隔离18前置复跑通过，类型/lint/build/CR通过；本地浏览器受限，没有新发现GET或截图执行。只focused追加，不改变普通fixture或140full截图baseline。

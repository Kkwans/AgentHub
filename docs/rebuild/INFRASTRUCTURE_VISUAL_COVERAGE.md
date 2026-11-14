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

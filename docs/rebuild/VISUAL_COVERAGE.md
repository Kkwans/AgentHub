# 页面与模块视觉覆盖清单

更新时间：2026-11-14 10:34 UTC。覆盖、自动门禁通过、人工看图和真实供应商可用是四件不同的事；下表不互相替代。重定向路由不算独立页面。

## 版本与数据边界

| 提交 | 精确 CI | 当前证据 | 数据性质 |
| --- | --- | --- | --- |
| `c53ffc7ce79f09aa25fde0c410537d1f0d509f4e` | [43579386349](https://github.com/Kkwans/AgentHub/actions/runs/43579386349) | 四项成功；187真实服务/视觉用例、geometry 140页；process8、rename9、workspace8逐例零重试 | 真实本地HTTP/PGlite + 受控ACP合成fixture，不是Codex/Claude等真实供应商 |
| `84c7404d9a3934a2e9d480f0295fd5bfff5a755b` | [43580128547](https://github.com/Kkwans/AgentHub/actions/runs/43580128547) | verify/PG/a11y成功；real失败：390浅深标题实测54px，小于60px门禁。导出其余9例通过，不标整体视觉通过 | 同上；201条分页例明确为浏览器响应契约fixture，不是多页DB端到端 |
| `0a29d167bea9f7d148d6241d25ac5258d448a37e` | [43582917326](https://github.com/Kkwans/AgentHub/actions/runs/43582917326) | focused38逐例passed/retry0，PG/axe成功；verify也已成功；完整real矩阵仍运行 | 真实HTTP/PGlite/受控ACP；分页201条仍仅浏览器契约fixture |

c53真实artifact：`14108382083`，SHA256 `b8a9dcb5c350ab1e5bbe590af976eddca518b8b6e0c2b3f2bb29ab518175f688`，已核对。以artifact里的原图、report和audit.json为依据，不把旧版图片改名成新版。

## 全页面基线：c53 的 140 张截图

直接读取该artifact的audit.json：10条实际页面 × 7个视口 × 浅/深色 = 140张；sourceCommit精确匹配c53，complete=true。视口为 **390×844、768×1024、1024×768、1280×800、1440×900、1600×1000、1920×1080**。

| 页面 | 路由（ID参数化） | 自动截图/geometry | 本轮人工验收边界 |
| --- | --- | --- | --- |
| 首页 | `/home` | c53，14张，通过 | 未逐张人工复核，不能称所有状态美观通过 |
| 项目目录 | `/projects` | c53，14张，通过 | 同上 |
| Agent中心 | `/agents` | c53，14张，通过 | 同上；不等于Agent真实联调 |
| Prompt库 | `/prompts` | c53，14张，通过 | 未逐张人工复核 |
| 外观设置 | `/settings/appearance` | c53，14张，通过 | 未逐张人工复核 |
| 运行环境 | `/agents/runtime` | c53，14张，通过 | 未逐张人工复核；不等于NAS已部署 |
| 项目概览 | `/projects/:projectId/overview` | c53，14张，通过 | 未逐张人工复核 |
| 项目任务 | `/projects/:projectId/work` | c53，14张，通过 | 普通审阅另有历史专项；新启动恢复待精确新图 |
| 项目会话目录 | `/projects/:projectId/sessions` | c53，14张，通过 | 不代表已实现归档/正文搜索 |
| 工作区 | `/workspace/:id` | c53，14张，通过 | 下方专项已看部分原图；不是全状态均人工复核 |

基线audit自身明确列为未验证的状态：login、loading、error、running、approval、failed、closed、git-changes、terminal。专项可以补其中某个具体状态，但不可因此把上述整类或全部页面状态标绿。

## 交互模块证据

| 模块/状态 | 版本及自动证据 | 已实际人工看图 | 仍需确认 |
| --- | --- | --- | --- |
| Agent公开思考内容 | c53过程8例，四宽浅深，零重试 | 390浅色样本，明确合成/公开内容来源、竖线与阅读层级 | 不是模型隐藏推理；不是所有真实Agent会提供此内容 |
| 工具进行中/展开输出/失败/完成 | c53，5阶段×8=40原图齐备 | 390深色长输出、1440浅色失败、1440深色完成；容器滚动、失败摘要与就绪输入可见 | 标题/摘要略重复、手机长输出占屏多、焦点双线略突兀，非阻断后续优化 |
| 完成后的输入框恢复 | c53 workspace8零重试；此前fb也有独立8例 | 390与1440样本顶部就绪、输入恢复；提示/Terminal完整 | 不把受控ACP证明当所有供应商生命周期已实测 |
| 重命名表单/保存/未知核对 | c53 rename9零重试 | 390表单及响应丢失只读核对图 | 其余视口自动通过，未声称逐张人工看完 |
| 文字导出 | 0a29 focused中11例通过/retry0；390浅深标题实测66px，rename/export各44px、间距4px | 390浅色入口、390深色导出窗、桌面浅色导出窗，无重叠、内容完整 | 手机标题仍约4字省略，非阻断；201条分页仍不是多页DB端到端 |
| 原任务启动恢复 | 0a29 focused中10例通过/retry0 | 手机浅色unknown/READY历史恢复、桌面深色unknown，清楚说明不证明原请求成功、未重新启动 | 卡片在执行信息后较靠下；UNKNOWN为客户端丢响应，服务端RUN_ADMITTED；重开是同BrowserContext新页面 |
| 普通任务审阅 | 历史f84专项9例零重试与新图已核对；c53包含task-review专项 | 历史390/1024/1440浅深样本、反馈/结果入口 | 不用历史图证明未发布恢复面板 |
| Agent连接检查 | 历史3bc专项8例零重试、状态卡前置新图已核对；c53包含专项 | 历史390/1440浅深ready/unknown | 不是已连接真实付费供应商；更新该模块后必须换新图 |
| Diff词法/审阅主区 | 历史96d严格token6例、CSS/TSX截图；当前verify仍运行零重试token门禁 | 历史深色CSS/TSX删除词法与主区布局图 | 新Diff布局变更仍须独立当前版本截图 |

## 路由盘点：尚未形成逐页完整视觉签核的页面

根据当前App.tsx及SettingsPageView路由核对，以下页面不在上述10页基线里。部分已有行为专项，不代表已经逐状态、逐视口人工看图。

| 页面 | 路由 | 后续最少覆盖 |
| --- | --- | --- |
| 新建项目 | `/projects/new` | 空表单、目录选择、校验/失败、提交结果 |
| 新建任务 | `/projects/:projectId/work/new` | Prompt、变量、unknown恢复与移动端 |
| Agent发现/注册 | `/agents/agents/discover` | 扫描结果、不可用项、注册确认 |
| Agent详情 | `/agents/:agentId` | 默认model/mode、连接检查、长路径、unknown；启停仍是规划 |
| 节点目录 | `/agents/nodes` | 空态/在线/离线/未知 |
| 节点注册 | `/agents/nodes/register` | 表单/校验/结果，不暴露真实凭据 |
| 节点详情 | `/agents/nodes/:nodeId` | 已连接/断连/能力与诊断 |
| 主机诊断 | `/agents/diagnostics` | 正常/缺能力/错误长文本 |
| Prompt详情 | `/prompts/:promptId` | 版本、绑定、冲突/未知、编辑长内容 |
| 账号设置 | `/settings/account` | 未登录/已登录，不使用真实私人资料截图 |
| 安全设置 | `/settings/security` | 表单/错误/会话保护，不截图密码或密钥 |
| 集成设置 | `/settings/integrations` | 未配置/配置/错误；不把UI当接入验证 |
| 系统设置 | `/settings/system` | 健康/不可用/诊断信息 |
| 高级设置 | `/settings/advanced` | 危险操作说明、禁用态、校验 |
| 登录与全局加载/错误 | AccessGate及各路由边界 | 单独专项；不从健康页推断 |

## 更新规则

每次视觉相关提交记录：完整SHA、run/artifact、数据来源、页面/状态/主题/视口、自动结果、人工实际打开的样本、发现与未解决项。后续CI有5项job，focused交互artifact只是其中一部分；它通过不代表大矩阵、axe、PG或整个产品通过。

## 0a29 focused 精确证据

artifact `14108933174`，SHA256 `050d8ca724537ed114fc26e255363f241eb921be8b97187369b53413d4af1592` 已核对。38例包含process8、rename9、export11、task10，0skip/0flaky/全retry0；10:02:05 UTC测试完成，3.9分钟。截图人工样本如表，不将focused成功当五job全绿。任务prepare两例仅390默认主题；身份/存储/跨tab主要是单测覆盖，未直接计数外部ACP session/new，不能宣称全部真实Provider安全验收。

## 39362a4 / ca88877 最新增量

- `39362a4f1b531d30e31545e858b084e8e6faeeae`，CI43584844213，focused artifact14110017386，SHA256 `52ad6eaf717a325a643c404db873459f90b2d9206bcc6e7097eaef6e2c6125a9`匹配；38通过/0skip/0flaky/逐例retry0，其中任务恢复10。人工看first-unknown390浅深、1440深：卡片已在标题后执行前，手机左右16px，首次未滚动截图核对按钮完整可见，无重叠且UNKNOWN不冒称成功。原0a29卡片靠下/贴边问题已有新图确认改善。verify/PG/axe/focused成功，完整real仍待。
- `ca88877d1df62b5c1c4afa70bbdc5cf5e5856119`，CI43585415542，focused日志确认10:32:27原38项通过/3.1分钟；10:32:51独立Prompt修复四宽4项通过/23.2秒，配置零重试。它修复0a29完整real的四个失败，实际浏览器流程已复验，不仅单测；此处尚未逐例读新artifact或人工看Prompt新图。verify/full-real仍运行，PG/axe/focused成功。
- 启停候选8个E2E（四宽浅深、每例4状态section及整页，预期64图）仅类型/lint/list通过，尚无新精确CI或截图，不标为视觉完成。

## c508907 Agent 启停精确证据（2026-11-14 11:07 UTC）

- SHA `c50890706ede9085287dc5b4c10388f68d2d0400`，CI43586498468；focused artifact14110882209，SHA256 `4386d8f4bcc210dca40d39682ede6fe26afeef25de06664945b7bd67df05e262`下载核对一致。46主流程+独立Prompt4全passed、retry0、0skip/flaky，Agent启停8例四宽浅深通过。
- 64原图（32 section、32 page）来自受控真实HTTP/隔离服务测试，并非真实供应商。人工抽样覆盖四宽浅深与disabled/current/unknown/reconciled：草稿保留、unknown禁操作可只读核对、更高revision后新意图可用，未见重叠/横溢。
- page图是滚动后的页面视口，嵌套滚动上方内容可能被裁，不是“完整Agent详情全页”。尚有非阻断设计问题：说明重复、revision技术信息较多、unknown/reconciled层级相似、默认设置保存整行宽。
- 截至此时verify/PG/axe/focused成功，完整real仍运行。真实PG3例含跨连接启停CAS，不包括新正文搜索候选。
- 旧ca88877完整real已170通过、geometry140、五job成功；39362a4旧full-real因其尚未包含Prompt修复而失败，不再记为运行。历史成功不能替代c508或下一候选。
- 11:10 UTC更新：c508完整real已于11:08:33完成170 passed /25.2m，geometry于11:08:34通过140 page snapshots，五job全success。完整artifact人工抽样核查另记，不从自动通过声称每张都已人工看过。

## 搜索UI本批浏览器待验

前端7c35a358、E2E c0420974：新增8宽主题真实持久搜索/定位截图，另501turn、迟到取消、成功后SPA ABA共11例。断言精确id/sequence/focus与conversation容器交集，390标题>=64/三按钮44px/不重叠。仅type/list通过，尚无artifact或人工像素结论。数据由隔离PGlite fixture构造，搜索及历史读取真实HTTP；不得称供应商对话验收。

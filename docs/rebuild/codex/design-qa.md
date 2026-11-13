# Codex 设计 QA

## 参考

已实际打开并观察用户选中的最后一张 Codex 参考图。没有使用先前被否定的备选方案。

## 当前验证状态

- 新工作区导航链接指向真实项目、Prompt 与设置路由；新建会话保留 projectId。
- “审阅更改”接入现有 changes 检查器，窄屏打开抽屉、桌面展开已折叠检查器。
- 未改变消息/审批/运行/Terminal 数据契约。
- TypeScript、改动 TSX lint、针对性测试可通过。
- 实际浏览器截图：**阻塞 / 尚未取得**。本地 Playwright 启动提示 browser executable 不存在。

## 必须继续的对照

同一实际会话，在 1440px 与参考图并排对照侧栏宽度、顶栏结构、正文行长、气泡与 composer；再检查 1024/768/390px 与 dark。验证发送、停止、审阅更改、文件切换、审批、抽屉关闭、键盘 focus；检查 console/pageerror 和水平溢出。视觉通过前不得把 C01 当成完整设计交付。

## C02/C03 独立 CR 与修复

- 发现会话列裁切旧 Agent 弹层：改以整列顶栏定位和限宽，保留内容换行。
- 发现按项目分别窗口化破坏全局结果上限：改为先全局窗口化、再项目分组；200 项目搜索回归覆盖 80 项上限、当前会话和加载更多。
- 新回归测试漏导入常量造成一次失败，已补齐，19/19 重新通过（包含 App、SessionRail、Git、Diff）。
- 再尝试从 Playwright 官方下载 Chromium；下载包无法解压，浏览器安装失败。保留 CI 截图验收路径，不把失败安装当成截图完成。

## C01 实际截图发现与修正（非最终验收）

已下载 CI 43379868312 的 fixture 浏览器截图，实际查看 1440px 与 390px 的 Workspace。这是实际前端渲染，但数据为 fixture，不是 NAS/真实供应商 Agent 验收。

发现：用户气泡出现两层灰背景、边框与阴影；助手 Markdown 内联 13px/灰色仍覆盖设计；390px 的 turn 横向超出视口导致裁字，状态顶栏挤压。

修正：移除内层用户气泡渐变/边框，只由外层承担表面；助手 Markdown 读取作用域字号/颜色变量；turn 显式 width:100% 且最大 820px；手机隐藏面包屑和冗余 Agent 名称，保留状态和操作。新增所有 viewport 的 turn 横向边界断言以及桌面 Agent 弹层边界断言。

16 项消息/Markdown/虚拟滚动回归通过。修正必须由新提交截图验证，旧 C01 图不是修正后证据。C04 非工作区页面同次集成，需查看 Home/Projects/Tasks/Settings 新截图。

## C02 实际截图复核与 C03 审阅密度

已实际查看 3d6102f 的 1440px fixture 截图：项目树、中栏独立顶栏与右侧审阅标题生效，三栏无重叠。仍发现右侧默认深层目录树占用过多高度，左侧会话多余缩进加剧长标题省略。

据此改为默认扁平文件行，展示真实文件名和父路径，提供“按目录显示变更”切换；切换不丢失勾选，文件预览仍以完整路径区分同名文件。扁平列表来源于已校验的目录树，不直接绕过路径过滤。没有自动预取 Diff 或自动替用户切换文件。左侧减少12px额外缩进。

新增渲染回归覆盖默认列表、目录切换、勾选保留、同名文件完整路径预览与 untracked 文件入口。Fixture 增加明确打开统一 Diff 的截图，避免把“文件预览”误当 Diff 验收证据。此片新实际截图仍待 CI。

C01 真实服务 dark390 图也已查看，双主题中性映射生效；发现 textarea 聚焦时有刺眼的内部矩形白框。已把该输入焦点指示改为整个 composer 的圆角轮廓，按钮焦点轮廓保留。不得直接去除键盘焦点标识。C01 精确 CI 43379868312 的 verify 与 real-service 现均成功；该结果不替代之后提交的截图。

## 495361b 实际图复核

已实际查看该 SHA 的 fixture Workspace 1440/390：前轮四项修复可见生效，气泡单层并右对齐，助手正文清晰，390px 无原横向裁字，状态和 Agent 不再重叠。仍发现 USER 使用同一 Markdown 的默认13px/灰色，现把作用域正文变量也用于 USER；没有扩大工具 Markdown 的字号。

同 SHA 的 Home1440、Projects1440 也已查看：Projects 筛选项内部断成2+1，Home 实际仍约1153px而非计划960px。修复为桌面筛选整组单行、平板整组第二行；Home用限定page root的max-width抵抗旧全局覆盖，不修改全局布局。另统一工作区品牌图标，并将设置入口移至侧栏底部以匹配所选参考，保留原路由与抽屉关闭回调。

独立静态审查通过。495 的已查看图仅证明此前修复，不作为本段新增调整验收；新SHA需再查看1024筛选行、390侧栏footer与用户正文、Home居中宽度。

## 03aa10a fixture 红灯及真实 Diff 缺陷

CI 43382919595 的 lint/typecheck/单测/build 通过，fixture E2E 在新增 Diff 断言失败。保留原红灯，不重跑旧 SHA 当修复。

Trace 确认 `.monaco-editor.first()` 命中 display:none 的 gutter；真正的 `.editor.modified .view-lines[role="presentation"]` 已渲染 `display: grid;`。修正定位器为该明确修改文档，并检查真实代码文本，不删除可见性验证。

同时实际查看失败截图发现产品缺陷：`.git-selected-diff` 没有显式 grid 行，header 与工具栏被拉高约160px，代码区只剩124px。修正为 `auto auto minmax(260px, 1fr)`，去额外容器padding/gap，header与controls保持内容高度，剩余高度分给代码。新增几何断言：header≤64、controls≤56、editor≥260。新源码仍须真实浏览器图验证，不把定位器修复当布局验收。

## 0de8d1 截图复核与任务入口修正

CI 43384706087 的 fixture verify 已成功；实际查看 `workspace-review-diff-desktop-1440.png`，此前拉伸的标题/控件空白消失，修改侧红绿代码可读。此证据只覆盖 fixture，real-service 矩阵及可输入 composer 的暗色焦点仍待独立复核。

继续根据 495 的真实服务截图修正：新任务 BACKLOG 原来显示泛化“状态”，现在明确为中性灰色“待规划”，不修改状态机；手机工作页保留搜索，把状态/Agent 次要筛选折叠，显示激活条件计数和清除入口，桌面仍常驻。原生按钮提供 aria-expanded/controls，隐藏控件不进入键盘导航。真实390 light/dark E2E新增 Enter/Space 切换、计数和清除验证，新增展开图；新图仍待此次精确 SHA CI。

暗色真实图还显示长项目名把 Folder 图标挤缩，现为图标保留尺寸、仅名称省略，完整名称仍保留于 DOM 和 title。以上修正须继续以新截图验收，不把本地单测、静态审查当视觉完成。

## 审阅身份与主动作层级（803deaf 后续）

0de8d1实际Diff图中，标题只露出 `apps/web/src/features/workspace/works...`，无法直读选中文件名。后续标题改为 basename；完整路径仍用于 section accessible name、code aria-label/title 和预览请求，不改变文件身份或目录切换。分支图标固定不可压缩，长分支文本仍省略。Git渲染回归验证 basename 和完整路径同时保留。

## Prompt 与项目概览的剩余卡片布局

实际查看0de8d1的Prompt1440/390与项目概览1440：Prompt仍有大圆角外框、目录选中卡片、内部绑定卡片三层表面；概览的右侧最近会话将左侧审阅队列挤至约y910。不能仅因中性配色已落地就判定这些页面完成。

Prompt后续去外框阴影/圆角，目录使用安静选中行，版本/标签/绑定改为横向分隔行，保留编辑器的有意义边界与所有操作。项目概览单独调整网格/分区以消除空态拉伸。以上均基于旧图发现问题，新实现需新SHA截图确认，当前CI等待artifact并非截图已验收。

## 803deaf 移动筛选回归断言修正

CI43386402209的fixture手机工作页三次一致失败：旧测试直接查找可访问的“工作状态”combobox，但新交互默认折叠它。已实际查看失败图：筛选（1）和待审阅任务仍正确展示，首任务约y494，较旧图约y578提前；这不是新页面最终验收，详情主动作前置在后续a85才实现。

更新fixture按真实交互验收：先验证折叠与条件计数，展开后仍保留“待审阅”选中断言，保存展开截图，再收起验证并拍默认首屏。没有删除原状态正确性检查。803红灯保留，后续精确CI需重新通过。

## 可输入 composer 的焦点证据补齐

0de8d1真实服务矩阵已成功，实际查看dark1440就绪对话图：焦点沿整个composer圆角显示，旧textarea内部矩形白框消失。dark390当时仍处于运行中禁用输入，不能据此称已验证移动焦点。

后续真实服务用例在发送之前明确断言输入已启用且已聚焦，新增 `workspace-composer-focused.png` 与区域截图，覆盖该用例的浅/深1440/1024/768/390八项组合。原运行、审批、文件与Git断言全部保留，不以禁用状态截图替代键盘焦点验收。

## Agent 与基础设施目录

根据0de8d1节点页1440/390实际图，节点列表仍以大卡片占据空白。后续Agent中心使用语义article行，节点/Runtime使用平面分区；保持原enabled、readiness、Provider/Model、能力、检查时间和管理/诊断链接，不把未知能力显示为成功。新增独立CSS作用域，不修改全局表面或安全流程。新四宽fixture增加agent-center、agent-runtime截图，原agent-nodes截图保留。

a85c13c小artifact已确认失败仍是旧手机隐藏combobox断言，已由455修正，未发现另一失败。a85任务实图确认审阅分区前置，但mobile首屏尚不能看到完整动作且数据仍加载；不能把顺序生效当操作验收。455的lint/types/单测/build通过，浏览器矩阵仍等待结果。

## 455/e884 实图检查与抽屉表面修正

已实际查看455的概览1440、工作390、Prompt生命周期390及e884 Agent1440/390。确认概览审阅首列、筛选首屏节省约84px、Agent目录和移动事实列落地。发现Prompt生命周期抽屉仍透出底层文字，原因是旧 `--surface-elevated` 含alpha（light .98 / dark .96）且深色为冷蓝灰，未在Codex主题映射。后续将该语义表面统一为不透明中性浅白/深灰，保留外层遮罩与焦点行为；fixture新增真实计算背景色和完成动画透明度断言。不是通过隐藏背景内容规避问题。

## 手机项目头收拢

以455手机工作图中约294px的页头为基线，<768将次要描述、类型、已确认分支/计数和编辑类型放入原生项目详情；标题、状态、新建工作及真实可继续会话入口常驻。分支未核验/失败/确认中、Agent未知或0可用、任务计数未知仍在展开区域之外，不能靠收起错误换取好看。桌面保持信息与动作。

回归增加健康/异常手机渲染与信息可见性；fixture通过Enter/Space展开收起，并约束健康状态的项目tabs底部小于270px，待新实际截图确认真实首屏收益。概览非必要英文统一为“待审阅”和“工作”。

455精确CI43387781545现verify和real均成功；e884 fixture成功、real仍运行。新手机头与浮层修复没有沿用这些旧成功宣称验收。

## e884 双主题四宽焦点实图后的390修正

e884精确CI43388743407现verify/real均成功，八组可输入composer聚焦图已逐张查看。1440/1024/768浅深正常，390浅深两行文本第一行贴近外框上缘。实际检查CSS/组件：初始高度40px，正文两行加上下padding需要约77px，焦点光标滚动吞掉顶部留白。

修正为作用域内border-box、最小高度calc(2lh + 26px)，保留手动拉高与内部滚动；拖拽起点读取实际高度，避免CSS最小高度与40px旧状态之间跳动。新增拖动不跳动/松手不继续调整的回归；真实八组用例对两行输入断言padding≥12、scrollTop≤1且clientHeight容纳两行和padding。不是全局禁止滚动，长输入和低高度/软键盘仍需后续专门验收。

ff89491 fixture verify已成功，新页头图正在复核；real仍运行。本轮输入高度修复须新SHA截图确认，不以e884成功覆盖新改动。

## 2026-11-13 08:34 UTC 检查点与未覆盖状态

本轮新核验：ff89491精确CI43391063658的verify/real均成功；53c2b9a精确CI43392883171的verify成功，real仍运行。53两行输入留白尚未实图验收，不重复把上一轮ff默认页头图算作新增工作。

现有ff截图只覆盖手机项目详情收起状态；展开/错误并没有独立图。新增fixture截图：原键盘展开步骤保存项目详情展开图；默认图后仅在390模拟资格服务503并硬刷新，断言“Agent资格读取失败”在折叠区外可见、编辑入口仍隐藏、新建工作仍可见，再保存警告图与无横向溢出结果。属于明确失败fixture，不是真实供应商故障证据。

手机独立任务详情仍处于安全拆片：首先修board连续URL写入与历史选择基础，不先隐藏或卸载审阅组件；现有unknown/pending分散状态与晚响应导航需另片保护，不能声称独立详情已经上线。

## 08:34–08:40 UTC 手机详情安全拆片

只读评估发现看板点击先选择任务、再切列表，两次URL写入基于同一旧参数，可覆盖task/agentId。此次修为单次更新，保留status等参数及原replace行为。

候选曾包含手机history push与URL清空后重置选择；审查发现Back可新增卸载局部unknown审阅状态的路径，因此该候选未集成/未发布。最终仅保留看板原子URL修复，79项工作页保护回归继续执行。完整手机独立详情、历史与离页守卫仍待安全契约实施，不能把本片描述成详情已上线。

## 2026-11-13 08:45–08:47 UTC 新证据与安全前置片

53c2b9a精确CI43392883171现verify/real均成功。新下载并查看390浅深聚焦图，两行输入有稳定顶部留白、圆角外框和操作栏完整；本轮已亲自复核深色图。该修复可按此明确范围确认，不扩大为软键盘/任意长输入全部验证。

审阅子组件新增向父层报告pending/unknown/checking/resolved/retryable的可选快照及捕获发起时导航门。被阻止自动导航时保留经过原身份验证的显式工作区链接，不重发请求；旧调用不传参数保持原行为。父层尚未接入锁/epoch与独立详情，完整手机详情仍未上线。本片为后续安全接线准备，不计作可见新布局。

## 08:50–08:52 UTC 资格失败图复核

5c42049 fixture已成功并产出展开/警告图；实际查看390警告图，资格503提示在收起区外可见，但11px灰字与次要元信息过近。本片只对已失败或零可用Agent使用语义警告色、图标和12px文字；纯确认中不伪装失败。保留role=status、换行和原所有状态条件，桌面不变。新增严重性属性回归；新样式仍待后续精确截图。

审阅前置API独立CR发现成功链接仅存子组件、刷新卸载后丢失的缺口，未将未修候选发布。修正要求resolved快照同步向父owner交付已验证resultHref，包含卸载前后回归；父安全接线与手机详情仍未完成。

08:52 UTC复审补充：已验证resultHref随原project/task/execution/operationId在刷新前同步交付owner；无效响应不带链接，子组件卸载前后均覆盖。独立CR确认缺口已修。组合116项测试通过；发布边界仍为兼容子API及警告样式，不含尚未完成的父owner接入、离页守卫和手机独立详情。

## 2026-11-13 09:00–09:10 UTC 父层接线检查

本轮本地集成并复跑owner基础10项回归，更新主设计台账；新查看a503手机资格失败图，语义警告样式生效。5c精确CI现双绿，a503的real仍待结果。

父层接线在独立工作树实际开发：认证内部、Routes外持有owner；提交时捕获导航门，首pending才绑定认证generation，以免StrictMode布局effect重放使首次操作丢记录；跨路由未知结果提供独立只读核对，不自动解锁。四项初始集成回归已通过，仍在完整回归和独立CR中，未发布也未启用手机独立详情。

新增审查要求：已完成操作必须可显式关闭，pending/unknown/checking不可关闭，防止永久通知堆满界面；补同任务离开再返回的晚响应与Worktree集成测试。操作记录面板当前仅计划放AppShell，Workspace不显示常驻面板，但owner必须继续存续。不得把这一可见性边界描述成全路由常驻UI。

## 09:14–09:19 UTC 接线回归与发布门禁

扩大回归曾因从apps/web目录启动Vitest未加载根test-setup出现6项scrollIntoView缺失错误；根目录正确配置重跑155项通过，不更改业务逻辑掩盖错误。随后独立CR要求热缓存StrictMode专项，新增用例真实失败，确认父scope重放会清掉子layout已注册view。

修复只恢复子layout当前登记的view，不恢复旧记录/认证generation；热缓存用例禁止靠异步GET重新渲染，修复后18项专项通过，最终156项扩大回归通过并独立CR放行。本地整合后另复跑真实Provider/owner/工作页97项，继续复核App/AppShell、审阅及页头组合；类型、lint、build、CSS预算通过。

已接入认证内部/Routes外owner、Task/Worktree提交时导航门、跨路由结果与unknown只读核对、仅终态可关闭及tombstone防旧回调复活。操作记录仅在AppShell显示，Workspace无状态条；持久化仅同页面生命周期，完整刷新不恢复。手机独立详情仍未开启，下一片保留原replace导航，用显式返回与同一隐藏Inspector避免引入新历史卸载路径。

a503精确CI43396836789现verify/real均成功；本轮新接线仍需发布后的精确CI与实际截图，不沿用a503成功。

## 2026-11-13 09:30 UTC · Mobile work list/detail implementation

- Integrated the single mounted Inspector mobile slice after independent safety CR. At 390px, list and selected task detail are separate visible states, with an explicit 44px return action. Project metadata/navigation no longer displaces detail actions; warnings remain visible.
- Return uses existing replace semantics and retains the selected Inspector, drafts and feedback. Pending review late results stay in the authenticated owner and do not navigate after leaving/re-entering detail. Local operation locks prevent selecting another task; Agent start pending disables the new return path. Invalid task URLs, including board combinations, never expose fallback writable actions.
- Integrated focused tests: 95 passed; worker final expanded regression: 165 passed. Web TypeScript and CSS budget passed after conflict resolution. Independent static CR approved the integrated source; no new important declarations.
- This is implementation, NOT visual acceptance. Exact published CI and new 390px list/detail/back screenshots are still required. Browser history push/Back restoration and generalized non-review cross-route persistence are not claimed.

## 2026-11-13 09:38 UTC · Browser evidence coverage follow-up

- Published mobile implementation is 8db535b / CI 43402016110; its new screenshots are pending, not accepted.
- Added a real task detail route to the accessibility matrix, retaining the list route, with explicit Inspector/title readiness. This closes the gap introduced when mobile hides the Inspector on list entry.
- Added a real 390px review test that fetches an actual service response, delays only its browser delivery, returns to the list and verifies focus, re-enters the same task, then releases the response. It requires one POST, unchanged task URL, preserved input and the server-confirmed session result link, with pending/result screenshots. Cleanup releases the gate; no synthetic success JSON.
- Unified the back control with the existing ChevronLeft icon and a plain accessible name. Integrated 95 tests, types/lint/formatting passed. The two real E2E files collect 6 tests; actual browser execution remains CI-only. Independent static CR passed, including review of the current query lifecycle that preserves the form before delayed response delivery.

## 2026-11-13 09:45 UTC · Actual mobile layout review (8db535b)

Personally inspected exact 8db535b fixture `project-work-mobile-390.png` and `project-work-list-mobile-390.png`. Detail now removes the project/list chrome: return is around y74, title y177, review section y264, review-load action y333, and merge confirmation fits within the 844px capture. List has no visible Inspector. This establishes the new visible-state structure, not the pending-operation or warning variants.

Remaining visible defect: return control touches x0, project identity also touches the screen edge, and the detail's full-width card outline adds a redundant shell. The next CSS-only slice applies a consistent 16px mobile context/toolbar/back inset and removes only the mobile Inspector's exterior border/radius; internal spacing/dividers and every safety control remain. New exact screenshots are required before accepting this refinement. Qualification warnings in task detail need their own fixture capture; the old overview warning screenshot is not equivalent evidence.

The mobile gutter candidate passed 95 work/owner and 13 header tests, TypeScript, formatting and CSS budget. Fixture coverage now verifies return focus/filter retention, 16px back inset, unboxed Inspector and visible qualification failure in task detail, with separate back-list and detail-warning captures. These are collected test requirements, not claims that the new browser checks have executed.

Final integration caught a test-authoring error before publication: the new Playwright focus assertion used the jest-dom matcher `toHaveFocus`. Corrected it to `toBeFocused`; lint and collection alone had not caught it. Explicit E2E TypeScript validation is added to this slice's checks (ESNext/Bundler matching the test transpilation; NodeNext gives existing axe default-import interop errors).

Explicit E2E typing also exposed pre-existing axe report schema drift: axe impact can be undefined and frame selectors are not always string arrays. The report now uses the library's actual target type and serializes absent impact as null, without changing severity filtering or dropping violations. All three affected E2E files now pass explicit ESNext/Bundler TypeScript validation.

## 2026-11-13 09:54 UTC · Exact CI follow-up

- 8db535b / CI43402016110: both verify and real-service jobs succeeded. The mobile list/detail structural slice has exact browser execution evidence; this is not a claim that every page has final visual approval.
- b5fb80c / CI43403104547: verify succeeded, real-service still running. Personally inspected its exact `project-work-mobile-390.png`: the ChevronLeft icon is rendered and detail layout is stable. Its delayed real-response test has not yet been confirmed.
- 9e4c1fd / CI43404482539: both jobs still running, no new artifact at this check. The 16px inset, border removal and detail-warning checks remain unverified visually.

## 2026-11-13 09:57 UTC · 9e4c1fd fixture inspection

Verify succeeded. Personally inspected its exact mobile detail, qualification-failure detail and returned filtered list: 16px inset and unboxed detail are correct; amber warning survives, and the returned list retains status filtering. The failure capture exposed a double focus treatment on the back button (module outline plus inherited global shadow). The small follow-up keeps a visible 2px outline but removes the duplicate shadow and uses a 6px radius; screenshot assertions will check the focused state. Necessary warnings legitimately push some form content lower; they will not be hidden to force every action above the fold. Real-service results are still pending.

## 2026-11-13 10:05 UTC · Verified real late-result path and accessibility gap

b5fb80c's real job succeeded, and the exact log explicitly reports the new 390px late-response review test passing (5.8s). Personally inspected its pending-list and reentered-result screenshots: operation status is retained above the list, the confirmed result links to the real session, the app remains in the original task detail, and the unverified-branch warning remains visible. This is b5 evidence, not newer gutter/focus screenshots.

Important correction: `.github/workflows/ci.yml` explicitly enumerates real tests and does NOT include `v1-accessibility.spec.ts`. Its updated full matrix is therefore still a runnable candidate, not CI execution proof. A targeted 390px light/dark detail axe scan is being inserted into the existing CI-covered `project-work-empty.spec.ts`, rather than claiming the full matrix ran or silently doubling the CI workload.

The targeted scan candidate now runs within both existing 390px theme cases, with no viewport/theme cases removed. It attaches actionable id/impact/target diagnostics and fails on serious or critical WCAG issues. This visual/axe flow uses reduced-motion media and disabled screenshot animations for stable captures, without changing product styling or disabling rules. Four E2E files pass explicit TypeScript; lint and the original eight-case collection pass. Browser results remain pending publication/CI.

10:09 UTC: b9d3faa verify succeeded. Personally inspected its exact detail-warning mobile screenshot: the duplicate focus shadow is gone and the single rounded visible outline remains; warning and detail layout are intact. This small focus polish is closed for fixture visuals, not a reason to continue cosmetic churn while real-service checks are pending.

## 2026-11-13 10:21 UTC · Prompt mobile reading hierarchy and Agent source truth

Personally inspected b9d3faa's 390px Prompt screen: directory plus page/editor headers postpone the actual binding section to about y690. The next slice makes only the mobile directory a 44px-toggle disclosure. Search/filter DOM and values remain mounted; editor is not keyed/moved/unmounted. Selection preserves existing URL semantics, closes the chooser and restores focus. Escape closes; desktop keeps the directory visible. Breakpoint focus handling moves focus only when a directory-owned control is about to become hidden, never stealing focus from the editor. Integration covers mobile/desktop transitions, search persistence, selection, focus and no writes. 27 Prompt tests passed; exact visual effect remains unverified until new CI.

Independent inspection of the Agent directory found a separate P2: auxiliary environment/discovery request failures were presented as missing environments or zero pending discoveries. The companion slice distinguishes loading, failed, missing association and registered readiness, adds read-only retry, and prioritizes errors over old cached values. It does not change runtime eligibility or service state. Focused worker validation is 47 tests plus types/build/lint; actual error-state layout still needs screenshots.

Final integration: main Agent source failures also display unknown totals/readiness instead of zero, including cached-data refetch failure, while preserving the original error and retry controls. Combined Prompt/Agent regression: 79 tests across 10 files passed. Web and explicit E2E types, lint, CSS budget and production build passed; fixture collection is now 52 cases, real Prompt flow retains all 8 theme/viewport cases. These are pre-publication checks, not screenshot acceptance. The mobile chooser breakpoint focus regression and no-editor-focus-steal path are covered.

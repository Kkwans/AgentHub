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

## 2026-11-13 10:35 UTC · 27faa1b exact fixture review

Personally inspected mobile Prompt collapsed/open and Agent source-error/recovered screenshots. Agent errors are explicit with separate retries and unknown discovery count; recovery restores a legitimate zero and retains registered identity. Both error messages remain visible rather than being hidden to move the row higher. This closes the pictured error/recovery presentation, not every real Agent capability.

Prompt actual content improved but the collapsed directory is still 151px tall with about 90px empty gray space. The 680px minimum-height layout's automatic single-column grid rows distribute extra space. The follow-up sets `align-content: start` only in the single-column breakpoint and adds a direct closed-directory height gate (<=100px), instead of trusting the previously permissive tabs-position assertion. The open search screenshot also shows nested global focus shadow inside the existing field focus-within ring; only the inner duplicate is removed, keeping the enclosing focus indicator and asserting both in the browser. Product selection, mutation and state logic are unchanged.

## 2026-11-13 10:46 UTC · 平板窄屏安全切片（候选）

b9的768px实际图只有一项任务，详情也从约y454开始。源码在<=1023宽度改为单列、列表全量渲染而无高度上限，因此多任务会继续把详情向下推；这属于代码与单任务实图支持的风险，不是已完成多任务视觉验收。

候选将phoneFilter<=767与singlePaneWork<=1023分离，保持1024以上双栏；警告不再依赖手机专属分支，owner按phone/tablet/wide记录两断点，沿用replace历史与单Inspector。初轮测试覆盖30任务及晚响应，但独立CR发现桌面无task默认详情缩至平板列表会隐藏仍聚焦的Inspector，需要先修焦点迁移再放行。没有以初轮测试通过宣称候选完成。

另已亲读8362的真实报告附件：390 light和dark各自`violations: []`，对应精确CI双绿。只关闭当前两扫覆盖缺口，不代表完整无障碍矩阵已运行。

## 2026-11-13 10:48 UTC · dd3e0f3真实fixture图复核

亲自查看精确`prompts-mobile-390.png`与`prompts-directory-open-mobile-390.png`：收起目录从151px降至约73px（y239–312），绑定tabs从y565移至y485；展开搜索只保留父级圆角焦点。此灰块/重复焦点切片已完成fixture视觉复核，不继续无意义抛光。27faa已双绿，dd3 verify成功、real仍运行。平板工作详情候选仍独立验证，不能混用本次图作为其验收。

## 2026-11-13 10:55 UTC · 平板候选最终整合验证

本片分离phone/tablet/wide，一次读取两个媒体查询并更新统一band，避免独立状态不同步；筛选仍按767断点，单面板工作详情按1023断点。初版182项扩大回归通过。独立CR随后发现并修复两类焦点边界：桌面无task的Inspector缩小被隐藏；详情任务被删除刷新后或进入看板时旧列表同样隐藏。现在仅迁移失效/隐藏/body或显式返回的焦点，分别到返回按钮、可见列表切换按钮、选中行/列表；外部仍可见链接与编辑器textarea不被抢焦点。

最终整合125项聚焦测试通过，覆盖30任务768/1023、1024双栏、两断点晚结果、警告与焦点迁移；另三项动态回归覆盖删除/refetch及看板转换。Web与显式E2E类型、lint、CSS预算和生产build通过，独立CR无剩余静态阻塞。52 fixture与8 real项目工作用例保留，真实axe仍只在390浅深两扫，不扩称平板已扫。新的768图和真实流程需该发布SHA的CI；原desktop看板卸载策略与无锁看板草稿恢复未扩scope。

## 2026-11-13 11:07 UTC — 192a evidence and navigation follow-up

192a341 fixture job succeeded. Actual 768 work detail/list-return/warning captures and 1024 dual-pane capture were inspected; tablet primary review content is now reached directly and qualification failure remains visible. Real job is still pending. The tablet return control is flush with the rail, clipping its focus outline; the next slice adds the same 16px margin as phone, with a CSS browser assertion.

The prior b9 phone Workspace capture shows duplicate outer and inner view strips. Current source still matches it. Removing the inner strip was rejected during CR: immersive mode hides the outer strip, and Inspector focus trapping prevents keyboard access to it. That candidate was withdrawn. Instead, keep the complete inner tabs and hide the outer duplicate only while the phone Inspector is open. Closing restores the outer navigation. Also stop re-focusing the close button on every tab/URL change; initial opening and the existing focus trap remain. Unit coverage checks retained focus and immersive navigation; fixture coverage uses arrow/Enter switching, close/restore and a new screenshot. Real file/diff helper now uses the inner tabs when already open. New visual approval remains pending.

Settings token read-state follow-up: the empty-state bug was source-confirmed, not claimed as an existing captured failure. Added a fixture failure/recovery case in the actual CI file, checking no write request on retry and taking settings-token-read-error/recovered screenshots at all four viewports. The new five unit tests cover pending/disabled/error/stale failure/recovery. Create and revoke handlers are unchanged. Visual result is pending the next exact run.

## 2026-11-13 11:16 UTC — Sessions directory evidence gate

Old exact 27faa phone sessions capture was personally inspected: all four records fall under earlier with individual timestamps hidden, and stacked filters delay the list. Current source confirms the same breakpoint behavior. The new slice keeps dates readable including an explicit absent-time label, folds only phone secondary filters, preserves active conditions and offers clear/reset. Tests cover actual Agent/status selection and selective focus recovery on desktop→phone resize. Desktop/tablet filters stay visible and original session URLs/creation ownership remain unchanged. Added actual fixture checks/screenshots for dates, keyboard selection and cleared state. Candidate tests are not a claim that the new screenshots have passed.

## 2026-11-13 11:21 UTC — Workspace close-focus follow-up

A source-confirmed keyboard defect remained after the single-navigation slice: closing a phone Inspector/session drawer restored focus to `.workspace-support-toggle`, which the existing phone browser test explicitly asserts is hidden. Restore to the current Workspace's visible selected outer tab instead; in immersive mode use its visible exit control. Tablet retains its support entry. Initial-open focus, Escape handling, focus trapping and requests are unchanged. Unit tests cover Inspector close, Escape, session drawer close and immersive close; actual fixture asserts visible/focused conversation tab. Final 23 Workspace tests, web/E2E types, lint/format and independent CR pass; browser execution and new visual evidence remain pending.

## 2026-11-13 11:25 UTC — Settings fixture locator correction

While the d892 browser job remained running, source inspection found that its new Settings error-state check incorrectly requested a heading. AhErrorState renders an alert containing strong text, not a heading. The test now locates that real alert for error visibility and recovery removal; all empty-state, read-only retry and overflow assertions remain. This is a source-confirmed test defect, not a claim that CI logs have already established every failure. No production semantics were changed to satisfy a test.

## 2026-11-13 11:30 UTC — d892 partial visual evidence and full axe gate

Personally inspected d892's phone single-navigation Workspace screenshot and 768 warning screenshot: the inner Inspector tabs remain, duplicate outer strip is gone, and the tablet return focus is fully inside the content edge. Its automatic failed Settings screenshot shows the correct error alert, retry and explicit warning that failed reads do not mean no tokens. Recovery was blocked by the bad heading locator, so it is not verified. Exact old fixture remains failed with four locator failures; 7cabc25 corrects the locator and awaits its own CI.

The independent real-accessibility job is now implemented locally. It preserves the full 154 combinations and severity threshold, initializes partial reporting before seed/git, requires real route content, records unique coverage and passed separately, saves axe results before screenshot attempts, and uploads partial evidence. Three report logic tests and explicit types/lint/YAML checks pass. No claim of completed full axe execution; see ../design/real-accessibility-ci.md for lifecycle and unverified boundaries.

### 11:33 UTC — Initial workflow admission failure

Exact dd9511a / CI43417817374 was rejected before any job started: GitHub annotation reports `Unrecognized named-value: runner` in job-level env. Generic YAML parsing did not validate Actions context availability. Moved the temporary directory expression to the scan step's env, matching the existing real-service pattern. No matrix execution occurred in that run; the old failure remains recorded. The next run must first prove all three jobs actually start before claiming the new gate is active.

## 2026-11-13 11:38 UTC — Sessions screenshot-driven correction

Exact e5 fixture archived five failures: four old Settings locator failures and one new phone Sessions locator failure. The filter's accessible name changes from 筛选 to 筛选（1）, so an exact initial-name locator stopped matching. Use an anchored name pattern while retaining exact count, keyboard, clearing and focus assertions.

The actual failed screenshot also exposed a production layout defect: status badge and activity time overlap. AhStatusPill emits role=status without the old module .ah-status class, so its automatic placement fell into the 30px avatar column while the restored time occupied column2. Added an explicit metadata wrapper with 8px wrapping gap; narrow metadata occupies row2 after the avatar, desktop uses one metadata column. Removed the ineffective selector. New four-viewport geometry asserts that status/date rectangles have at least6px horizontal or vertical separation, alongside the original visible time and no-overflow checks. Integrated21 tests and static CR pass; new actual screenshots remain the final gate.

## 2026-11-13 11:39 UTC — Real phone file/Diff helper correction

Archived d892 real logs show two failures, both 390 light/dark file→Diff navigation timing out on the medium-only auxiliary tablist. The phone-already-open path skipped its first open branch but then fell through to `width <1180`. Restrict the medium branch to768–1179 so an already-open phone Inspector goes directly to its inner tabs. All eight real content cases and assertions remain; this fixes test control flow, not the production feature. Also, exact7c fixture logs confirm all four Settings recovery cases passed; its remaining single failure is the old Sessions dynamic-name locator fixed in4b54ce9. Subsequent exact CI remains required for both corrections.

## 2026-11-13 11:48 UTC — Actual axe violations remediation

The extracted cdaa audit is complete with154 pages, zero missing combinations and zero pageFailures, but46 violations:36 serious color-contrast,10 critical aria-valid-attr-value. Targeted fixes cover SessionRail code text and dark sidebar group labels, plus real Workspace tab→panel references. Shared dynamic panels keep existing component lifetimes; explicit IDs override Radix's orphan generated references, and active panel labels track selected tabs. New DOM tests check every trigger target and active label at390/1440; browser checks cover all visible Workspace tabs before/after navigation.

The first combined unit run had37 passed assertions but3 unhandled asynchronous Monaco-import teardown errors, so it was not accepted. The existing FileInspector loading/error-only test now isolates Monaco startup; its assertions are unchanged and real editor behavior remains in the eight-case browser matrix. The final combined run passed37 tests with no unhandled errors. New exact browser/axe results remain pending; no rule or severity gate was relaxed.

## 2026-11-13 12:03 UTC — Exact df73 evidence closure (partial CI)

The real accessibility artifact records sourceCommit `df73eb418cb1b0bde83bacbbc2e9ee98002af7f5`, phase finished, complete=true, passed=true, all154 unique combinations, zero violations, zero pageFailures and zero missing combinations. This closes the46 findings in cdaa without removing routes, widths, themes, rules or the serious/critical threshold. It is not a claim about dialogs, expanded/error states, axe incomplete checks, full keyboard journeys, zoom, authenticated deployments or NAS.

The exact verify job also succeeded. Personally inspected its1440 Workspace/file and Diff views plus390 single-navigation Inspector, cleared Sessions directory, Agent source-error and Settings token-error captures. Restored text contrast, real tab-panel relations and metadata separation introduce no observed clipping in these captures; the error states keep explicit read failures and retry controls. Fixture captures are not real deployment verification. The real-service business job is still running at this checkpoint, so the overall three-job CI is not yet declared green.

The first broad local unit invocation could not import four suites because dependency links were missing in this worktree. After restoring links to existing installed workspace dependencies, those four suites pass9 tests; the fresh whole-suite invocation completed successfully at12:03 UTC:130 files and1290 tests passed,4 files and10 tests skipped, exit0. Earlier partial results are not aggregated into this clean run. No source or lockfile change was needed for that environment correction.

### 12:05 UTC — Real phone file/Diff helper closure

Exact37cf real-service logs now report150 passed and140-page geometry success, including390 light and dark file→Git cases (9.4s each). This verifies the phone-already-open helper correction against real local-service content; that old SHA still fails the separate accessibility gate with the historical46 findings and is not overall green. The newer df73 real-service job remains pending, so its deep-theme visual verification is not inferred from37cf.

## 2026-11-13 12:09 UTC — Projects truthful auxiliary data

Personally inspected exactdf73 desktop Projects. The Agent column uses global READY+enabled count but said available, and source inspection confirms unrecorded Git branch falls back to inventedmain; auxiliary read errors leave cached figures looking current. The new slice changes labels and read-state semantics, preserves entry links and mutations, adds compact read-only retry/status rows, and distinguishes project updates from session activity. Static CR caught invalid date ordering and required null/invalid/all-unknown regressions before approval. Hidden-filter focus recovery is narrowly scoped and does not claim open-portal resize coverage. Integrated15 tests pass; four-viewport failed/recovered captures are newly added but not yet executed on the new SHA.

### 12:11 UTC — First exact three-gate success

Directly checked all three jobs fordf73 / CI43420082576: verify, Real accessibility matrix and Real service and visual evidence are all success. This closes the earlier pending business job, not the new Projects slice. Publishedad732da / CI43422963012 is running; its error/recovery screenshots remain unverified until that exact run returns. No main merge or deployment occurred.

At12:12 UTC personally inspecteddf73 real-service1440 dark conversation and390 dark Diff captures. The neutral dark surfaces, readable branch/code text, full rounded composer focus and single inner tab row are present. Code scrolls inside its pane instead of widening the page. Archived real logs report150 passed and140-page geometry success;390 light/dark file→Git cases both pass. This is the isolated real-service fixture, not a claim of NAS or paid-provider validation.

## 2026-11-13 12:18 UTC — Overview Agent metadata investigation

CurrentOverview code uses an Agent-name lookup fallback of “尚未分配 Agent” even when the task has an assignedAgentId but the auxiliary Agent request is pending, failed or successfully missing that record. It also uses cached names after a failed refresh without any source warning. This is source-confirmed; the existingdf73 Overview capture is a successful state, not evidence of the failure UI. The candidate keeps task/session links and the separate server eligibility/preflight logic unchanged, and adds explicit name-read states plus a GET-only retry. New failed/recovered captures and focused regression are being prepared, not yet visual-approved. Home was checked separately and already gates source errors and handles invalid activity dates, so it is not included in this slice.

At12:19 UTC the integratedOverview andProjects regression passed30 tests, including existing eligibility/preflight protections; independent static CR approved the bounded Agent metadata change. Separately inspectedad732da Projects390 failed/recovered captures: individual failures and retry controls remain visible and the project stays navigable. Three simultaneous source failures occupy roughly309px and delay the first project toabouty711, so this is recorded as a non-blocking density follow-up rather than pretending the source rows are already optimally compact. No failure semantics should be removed to save space.

## 2026-11-13 12:24 UTC — Screenshot-driven source notice density

The actualad732da phone failure capture confirms that three independent full-width notice rows plus parent grid gaps consume about309px. The bounded candidate groups onlyProjects notices, retains every source error and GET retry, uses a two-column text/action row and44px targets, and connects each alert to one shared explanation that failure does not mean no records. Overview styling is unchanged. Static review caught a visible-label/accessibility-name mismatch in the initially abbreviated retry button and corrected it before publication. New browser assertions preserve visible alerts, exact accessible descriptions, visible-label inclusion,44px targets and no overflow, while requiring the group to occupy less than30% of viewport height; screenshots and measured JSON will establish the actual improvement, not a theoretical pixel claim.

Integrated31 tests and static CR passed for the source-group slice; web/E2E types, lint and production build passed. Actual compact-group height remains a new-SHA browser gate.

## 2026-11-13 12:35 UTC — Fullscreen long-form workflow

Personally inspecteddf73 realNewWork390 Prompt-preview capture: after scrolling the long form, title/close and final actions are outside the viewport. CurrentCSS confirms the fullscreen width/max-height are also overridden by later ordinary/mobile dialog rules. OnlyNewWork,CreateProject andDiscoverAgents request fullscreen on phone. The candidate fixes only that variant with higher-specificity viewport sizing, a bounded independently scrolling body and retained header/footer; normalPrompt dialogs keep their existing model. Body content aligns to start to avoid stretched grid rows, footer wraps and controls retain44px targets. No close/focus/operation handlers are changed.

New actual-browser gates exercise all three fullscreen forms at390×600 and realNewWork content scrolling, recording geometry and a separate short-height screenshot before restoring the original viewport. OrdinaryPrompt non-fullscreen behavior is explicitly checked. These are browser layout tests, not evidence of a physical soft keyboard or safe-area device. New exact screenshots remain pending.

### 12:36 UTC — Earlier slices' exact evidence

Exactad732da now has all three jobs successful. Exacteee3791 verify and accessibility are successful; personally inspected its390 Overview Agent error/recovery screenshots, which preserve a useful unknown label for assigned work and restore Codex after GET recovery without horizontal clipping. Its real-service job is still pending at this checkpoint. CompactProjects and fullscreen candidates require their own exact images; older green runs do not approve those layouts.

At12:37 UTC integrated validation completed in two scoped runs:85 FormDialog/NewWork/CSS-contract tests and24 CreateProject/Agent tests passed. The candidate worker's combined109 tests also passed. Web and explicit E2E types, lint, CSS budget, production build and independent static CR passed; none substitutes for the new fullscreen browser geometry gate.

## 2026-11-13 12:38 UTC — Compact source notice visual closure

Exactcd66 fixture and accessibility jobs passed. Personally inspected the new390 source-error capture; its browser layout attachment reports195px group height and44px buttons across all four viewports. Relative toad732da's approximately309px group, the first project moves fromabouty711 to597. All three source failures, independent retry controls and the shared failure-not-empty explanation remain visible. This closes the bounded density issue; no additional cosmetic refinement is planned. The real-service job remains pending at this checkpoint, and fullscreen08ea has its own new evidence gate.

## 2026-11-13 12:42 UTC — Prompt binding target investigation

Personally inspecteddf73 real390 binding-dialog keyboard capture: Agent target control is blank with no explanation, while create is disabled. Source confirms target queries are reduced todata-or-empty with no pending/error/empty distinction, cached target errors can still leave create enabled, and a disappeared selection can silently fall back to the first target. This is not a claim that the screenshot captured an API failure. A bounded follow-up is being assessed: explain target source states, GET-only retry, preserve chosen identity during failures and require explicit reselection when removed, plus submission-time membership/source checks. Binding request payload, operation lifecycle and selector mutation behavior should not be silently redesigned. No binding fix is yet claimed as implemented.

### 2026-11-13 12:45 UTC — Exact08ea complete local regression

A fresh complete local unit invocation on08ea ended with exit0:133 files and1306 tests passed,4 files and10 tests skipped, duration347.56s. This is one full run, not summed focused runs. It does not establish browser geometry or the next unpublished Prompt binding change.

## 2026-11-13 12:51 UTC — Binding target safety candidate validation

The bounded implementation now requires explicit target selection forProject/Agent/Task and distinguishes pending,error,refreshing,successful-empty,removed-selection and ready. Failed/paused/refreshing sources cannot submit; an existing ID is preserved, and removal never selects another target automatically. Mutation entry synchronously reads the current query cache status,fetchStatus and membership before callingPOST. Selector/version behavior,payload and success callback remain unchanged. The known pending-close/reopen ownership boundary is not fixed by this guard. See../design/prompt-binding-target-safety.md.

Integrated all fivePrompt unit files passed36 tests, including direct-mutation refusal for unknown/removed targets and unchanged payload after explicit reselection. Web/E2E types,lint,production build and exact static CR passed. The new real-service browser path captures empty→narrowly injected GET503→real GET recovery, retains keyboard/Escape focus checks and counts bindingPOSTs to require zero during this invalid-target journey. That browser path is not yet executed on the new SHA, and the hook's positive payload test is not a claim of a new real successful-binding browser run.

## 2026-11-13 12:57 UTC — Real binding positive-path gate added

Added one separate390-light browser case to the already-listed realPrompt file; the original eight empty/error cases retain zero-binding-POST assertions. The new case seeds isolated local resources, explicitly choosesProject,Agent andTask, submits each through the real UI, checks exact fixed-version payloads and three POSTs, then verifies response IDs, persisted GET records and visible binding names. It captures three saved-state screenshots and checks dialog/page overflow and console/page errors. No production code changes are included in this follow-up. Explicit E2E types,lint,nine-case discovery and independent static CR pass; discovery is not execution. Actual success and runtime remain pending the exact CI.

Exactcd66's real job subsequently succeeded, closing all three gates for that SHA. Personally inspected08ea fixture390×600 CreateProject andDiscoverAgents captures: title/close/footer controls stay in view while the body scrolls. Its realNewWork short-height capture remains pending, so the whole fullscreen slice is not yet visually closed.

## 2026-11-13 13:06 UTC — Fullscreen real failure and single scroll owner

Exact08ea real-service run failed:149 tests passed and one390 NewWork case failed because the required shared body scrollTop was0. Its separate140-page geometry audit passed, which does not excuse this workflow failure. Personally inspected the failed screenshot; trace records the nestedNewWork FIELDSET usingthe sharedfeature dialogBody class scrolling to1263 whilethe outerah-dialog-body stays0. Legacy feature wrappers retainedoverflow:auto even after their mobile max-height was removed.

The correction scopes onlyfullscreen dialogBody/discoveryDialog wrappers tooverflow:visible,max-height:none andmin-width:0. The shared dialog body is the single workflow scroll owner; ordinary dialogs keep their bounded feature panes and textareas/editors keep their own scrolling. The CSS contract was first run red before the rule was added. Final110 scoped tests,web/E2E types,lint,CSS budget,production build and independent CR pass. The browser helper still requires positive shared-body scroll, retains all geometry checks and adds wrapper assertions plus nested-scroll diagnostics. No assertion was removed to make the case pass. New exact realNewWork evidence remains required.

In parallel, deferred-response reproduction exposed two existing binding lifecycle failures: an old request closes a newly opened dialog, and switchingPrompt causes success to invalidate the newPrompt cache instead of the request's originalPrompt. Those red reproductions are isolated and are not added as failing tests to this release. A separate owner/snapshot/auth-boundary plan is being evaluated; this scroll correction does not claim to fix it.

## 2026-11-13 13:18 UTC — Exact c7e fixture scroll ownership and binding negative gate

Personally inspected exact c7e35e3 CreateProject and DiscoverAgents 390×600 screenshots. Header/close and footer actions remain visible; the shared body reaches scrollTop 353 and 430, while corresponding feature wrappers remain at zero with content-sized heights. Verify and the full accessibility job succeeded. The real NewWork case that triggered the original failure is still pending, so this is not yet full fullscreen closure.

Exact 77526cd real-service archive contains 149 passes and one failure, solely the inherited NewWork shared-body scrollTop-zero case. All eight Prompt empty/source-error/recovery combinations actually passed. This proves the negative target journey, not the separately added 37324e5 three-target successful binding case, which still awaits its own result.

C21 contract and isolated red-test patch are now integrated locally. A third reproduction proves that deleting the Prompt while its binding dialog is open allows the current fallback Prompt to receive the POST. Implementation is authorized and underway, but none of the three lifecycle defects is claimed fixed yet. The contract requires original-operation results and conservative unknown locks, not merely hiding stale errors.

## 2026-11-13 13:24 UTC — C21 owner implementation and genuine delayed-response gate

Integrated the bounded owner implementation: open identity and submitted payload are frozen, same-tick submissions are locked, only verified matching responses become saved, known pre-insert rejects can release the lock, and network/5xx/malformed or mismatched responses remain unknown. Original Prompt/target names and IDs stay in a read-only result record; pending/unknown cannot be dismissed to retry. Render-time auth/epoch filtering hides old records and dialogs immediately, including A→B→A; authorization and mount checks prevent old callbacks from touching a new identity. Source cache membership is also rechecked synchronously to cover deletion before a rerender.

The chosen safe limit is explicit: after unmount there is no UI update or cache invalidation, and operation locks do not persist across route unmount or refresh. The UI warns that leaving does not cancel a server request. No idempotency, automatic retry or GET-match inference was added. Candidate validation passed55 Prompt tests, types/lint/build/CSS budget; the integrated six-file run also passed55 tests, web types, lint and production build; exact product static CR passed.

Added a real-service390-light case that obtains the actual committed response with route.fetch, then delays only delivery. It closes/reopens the pending form, changes the new draft slot, releases the old response and checks the new draft remains open, its slot is preserved, the original result is shown, only one POST occurred and GET persistence still uses the original SYSTEM payload. Both preserved-draft and original-result screenshots are requested. Explicit E2E types/lint, ten-case discovery and independent static test CR pass; no local browser execution is claimed.

## 2026-11-13 13:25 UTC — New positive binding gate found a real empty-select defect

Exact37324e5 real archive reports149 passed and two failed: the inherited NewWork scroll failure and the new positive binding case. The latter stops before any binding POST because the Project combobox text is empty rather than its supplied placeholder. Personally inspected the screenshot: the trigger is genuinely blank while the explanatory unselected message and disabled submit remain correct. Thus the three-target browser success journey has not yet run through its writes.

Source diagnosis: shared PinSelect maps an empty clearable value to a sentinel even when no empty option is present. Radix has neither an item label nor an actual empty value to show the placeholder. A bounded shared-control correction is being validated; retain the original placeholder assertion and explicit-empty-option labels. Do not replace this failure with a weaker blank-text assertion.

At13:27 UTC the bounded shared Select correction was integrated: only explicit empty options map to the sentinel, while an ordinary controlled empty string stays empty for Radix placeholder rendering. Three direct-source tests cover initial empty, select→clear and explicit-empty label preservation; UI types/build/lint and independent static CR pass. The exact original positive-flow placeholder assertion remains unchanged. Combined shared-control and Prompt regression completed: nine files /67 tests passed, followed by web/UI types and production build. Browser completion remains pending the new publication.

## 2026-11-13 13:31 UTC — Exact c7e real fullscreen closure

Exactc7e35e3 real archive reports150 passed and one failure, solely the inherited positive binding placeholder assertion. The original NewWork390 shared-scroll case passed in3.8s and the saved-variable correction case passed in4.3s. Personally inspected the real390×600 short-height screenshot: title/close and cancel/create remain visible while the fixed Prompt preview and bottom fields are reachable. Geometry records outer body scrollTop1263/client421/content1684, NewWork wrapper scrollTop0/height1644/content1644 and fieldset scrollTop0/height1539/content1539. Together with the two fixture callers, this closes the bounded fullscreen single-scroll-owner repair. It does not claim real-phone keyboard testing or turn the overall run green.

Exact7bc23e8 contains the subsequent placeholder correction and C21 lifecycle work. Its fresh complete local unit invocation started13:28:48 UTC and remains running at this checkpoint; new CI/browser outcomes remain independent.

### 2026-11-13 13:35 UTC — Exact7bc complete local regression

The fresh complete Vitest invocation on7bc source ended with exit0:136 files/1338 tests passed,4 files/10 tests skipped, duration358.95s. Only documentation commits were added while it ran; product/test source stayed at the published tree. This is one full invocation, not aggregated focused runs. It does not establish the new real-browser positive and delayed-response cases, which still require exact CI evidence.

## 2026-11-13 13:38 UTC — Cross-route binding boundary reproduced, not fixed

Implemented and ran an isolated regression using actual Routes unmount/remount, rather than a hook that stays mounted while location changes. Both pending and network-unknown operations lose their record/lock after /prompts→/other→/prompts; the new expected-lock assertions fail (15 original tests pass,2 added tests fail). No second POST was sent. Restored the default test source and retained the red patch outside discovery alongside the reviewed route-owner contract. The full1338 pass above remains the published7bc baseline, not a claim that this documented boundary is solved. A duplicate unused owner implementation was rejected; the next product slice should extract one authoritative owner and wire it once after current real-browser gates are verified.

## 2026-11-13 13:52 UTC — C22 authenticated route-persistent owner candidate

Integrated one authoritative binding operation owner under authentication and above Routes. Request submission, immutable payload/result snapshots, pending/unknown locks and original Prompt cache invalidation move out of the page; the page retains only draft and navigation-generation checks. No duplicate global singleton or fallback writer remains. Missing Provider or unknown auth refuses writes. The keyed auth scope and revocable epoch invalidate old callbacks; snapshot includes authorization/epoch and publishes activation, so warm StrictMode does not require an incidental form rerender to become usable.

The actual Routes pending/unknown reproductions are now normal green tests. Additional tests remove every Prompt consumer, await a deferred saved/rejected response, read the captured owner snapshot before remount, and check original-cache ownership; simultaneous consumers share one synchronous lock. Candidate Prompt/owner/App/AppShell validation passed99 tests plus types/lint/build and independent static CR; the merged checkout also passed the same99 tests, web types, lint and production build.

The real browser test preserves the existing reopen journey and adds actual sidebar navigation away/back to verify the pending lock, then delivers a genuine route.fetch response while on Home and returns to the original result with one POST/one persisted record. Awaiting route.fulfill only proves browser delivery while away, not the exact React completion instant; the no-consumer unit test covers that distinction. Eleven cases collect and explicit E2E types/lint/static CR pass, but new browser results remain pending. Hard refresh, logout, new tabs and service exactly-once are not covered. Unknown now locks all binding writes for the authenticated app lifetime; it is not silently released by navigation or inferred GET similarity.

### 2026-11-13 13:53 UTC — Exact7bc real binding closure

Exact7bc23e8 run43433897374 completed all three jobs successfully. Real-service reports152 passed and the geometry audit140: the three-target successful binding journey passed in5.9s, same-page delayed-success/reopened-draft journey passed in5.0s, and all eight negative target-source combinations passed. The original placeholder assertion was retained and now actually passes. New real saved/new-draft screenshots are still being inspected for presentation quality; the new C22 cross-route journey was not present in7bc and requires its own CI.

## 2026-11-13 13:55 UTC — Actual saved-result density finding

Personally inspected exact7bc real390 saved-project and saved-task screenshots. A single confirmed-result card occupies approximately181px with a black border and full Prompt/target/binding UUIDs in the default reading flow. After three successful writes, cards accumulate before the directory and push the main editor substantially downward. IDs wrap without horizontal overflow, but functionality passing does not approve this presentation. The preserved-new-draft image separately confirms the newer TASK_PRIMER/fixed-version draft remains open.

The next bounded UI slice will keep original names and pending/unknown warnings prominent, put technical identifiers behind native details, and keep every operation in its original keyed position. Older-history regrouping is deferred to avoid moving focused nodes when an operation settles. It must not delete unknown records, release locks or change owner/request behavior. Confirmed-result dismissal remains explicit, with reachable controls and focus continuity. New exact screenshots/geometry are still required; the181px source is the actual7bc capture, not the new candidate.

## 2026-11-13 14:02 UTC — C23 compact operation feedback candidate

The candidate retains each keyed section and native details node in place as phase changes. Original Prompt/target names and status form a flat summary; technical IDs and selector details are available on explicit expansion. Pending/unknown warnings remain outside the disclosure and cannot be dismissed. Confirmed-result dismissal moves focus to the next/previous summary or the page heading when empty. No owner, request, lock or record retention semantics changed; older-history regrouping remains deferred.

Integrated eight-file67-test run, web types, production build and static CR passed. The final scoped button selector wins over global default sizing without!important; its three focused tests and CSS budget also pass. Real E2E keeps all three writes and persisted records, adds Enter/Space disclosure,44×44 dismissal/focus assertions, and resets the actual #main-content scroll container before capturing result geometry. It measures density rather than assuming a target height. A supplemental full-page axe gate covers the390-light collapsed saved-result state, which is absent from the read-only154-state audit; pending/unknown,expanded anddark dynamic result states are not claimed covered. Eleven cases collect; explicit E2E types/lint/static CR pass. Actual new screenshot dimensions and visual quality remain pending exact CI.

### 2026-11-13 14:11 UTC — Exact21ece complete local regression

One fresh complete local Vitest run on21ece product source ended with exit0:138 files/1350 tests passed,4 files/10 tests skipped, duration362.76s. This is not an aggregate of focused runs. The only main-checkout edits during this run were E2E-only work; the C24 product candidate remained in a separate tree.

## 2026-11-13 14:12 UTC — Workspace review hierarchy candidate and CR findings

Personally compared the selected concept with exact7bc desktop review-Diff screenshot. The visible code begins at approximatelyy610 below repeated branch/hash/upstream, view/selection bars, empty-selection hint and selected-file labels. Source review confirms these layers, not simply a narrow font/column problem. The bounded candidate folds only normal hash/upstream metadata, preserves branch/dirty/no-HEAD/nonzero sync counts and all errors, combines redundant changes controls, and removes repeated selected-file labels. It does not change Inspector width, typography, Monaco mounting or staged/whitespace/split controls. Actual default git diff compares worktree with index; staged compares index withHEAD, so the concept's relative-main label must not be invented.

Static CR found recovery-edit focus loss after an error with zero selections, and an expansion-state mismatch when the form is forced visible. The candidate is not approved or published while these are unresolved. Retry disabling is an explicit related behavior guard, not claimed as CSS-only: valid selection/message and no pending request must remain retryable with unchanged payload. New four-viewport browser capture retains the old1440 height assertions and adds native metadata keyboard checks and code-top geometry; collection/types are not new screenshot evidence.

## 2026-11-13 14:15 UTC — C24 corrected candidate integrated

The commit form now uses one effective expansion state and retains recovery draft editing after a failed submission even if selection is cleared; editing no longer removes its own textarea. Pending prevents false collapse, and aria-expanded reflects the actual form. Errors remain visible independently of selection. Retry eligibility is explicitly guarded by nonempty selection/message and no pending request; the valid retry still uses the original callback and payload. Both initial CR blockers have been fixed and independently reviewed.

Merged validation passed37 tests across Git tree/render, Diff parsing and WorkspacePage, plus web types, lint, production build and CSS budget. The four-viewport browser case now enters actual Inspector changes view, checks native Git-details Enter/Space while preserving branch/dirty text, selects real fixture code and records metadata/toolbars/code-top geometry before the screenshot. The original1440 header<=64,controls<=56,editor>=260 assertions remain unchanged. Medium/mobile paths restore the original Files/tab-keyboard journey afterward. Four cases collect and explicit E2E types/lint/static CR pass; no local browser run or new code-top improvement is claimed.

## 2026-11-13 14:22 UTC — Git status failure truth fix

A source audit found statusAt returningclean:true/entries:[] on a failed git status. Actual temporary Git repositories reproduced three failures (corrupt index,status capture,removed.git), while valid unborn empty repository and non-Git registration cases passed. No user's repository was damaged. The minimal fix uses the existing controlled409 GIT_STATUS_FAILED path, does not expose stderr/internal paths, and prevents capture from storing a false clean snapshot. Legal no-HEAD initialization still succeeds. Session snapshot capture remains best effort: its failure does not turn an otherwise successful Agent Run into a failure.

Front-end error mapping explicitly says cleanliness is unknown; an error/loading state takes precedence over cached clean badges. This does not broadly redefine readHead/readLineStats failures or repair prior persisted snapshots. Merged validation passed177 tests across five files, including the complete134-test SessionService suite, real/tmp Git and loopback API checks, plus server/web types, web production build,lint and independent CR.

A new four-viewport fixture journey first establishes a clean cache, injects a narrowly scoped409, requires the old clean text/class to disappear, then restores via GET and requires zero Git writes. Only the exact injected endpoint's409 console message is exempted; page errors are never ignored. Four cases collect and explicit E2E types/lint/static CR pass. It is cache-error UI evidence, not a substitute for the real Git corruption tests; browser screenshots remain pending exact CI.

### 2026-11-13 14:26 UTC — Route-owner and compact-feedback exact gate status

Exactbf3ec2b run43437795831 completed all three jobs successfully:153 real tests and140 geometry checks. Its new internal-route binding journey passed in7.0s, while the prior reopen and three-target flows remained passing. This closes the bounded internal-route browser gate, not hard-refresh persistence.

Exact21ece76 run43439142096 is now independently confirmed successful in all three jobs. Its compact-result screenshots and measurements are being materialized for direct screenshot inspection; CI success alone is not yet a claim that the density issue looks resolved. The newest3794 full local test run started14:25:15 UTC and remains running.

### 2026-11-13 14:32 UTC — Actual C23 closure, C24 medium-width finding and full regression

Personally viewed exact21ece saved-task390 screenshot: three flat collapsed operation summaries occupy190.55px in total (first76.08px, other two57.23px), versus the previous single181px result card. The directory begins aroundy452 and the editor title aroundy554. Original names/status remain visible, technical IDs stay available through native disclosure, and44px close controls are retained. Exact CI verifies keyboard expansion/collapse, dismissal focus, persisted three bindings and zero serious/critical violations in the supplemental390-light saved-result axe scan. This closes the bounded density issue, not all dynamic/error/dark states.

Personally viewed exacte8dc1440 and768 Diff captures. Desktop code begins aroundy512 compared with the earlier7bc y610, about98px reclaimed without changing column width/font. The768 image exposes a separate inherited defect: the Inspector is approximately240px wide, the whitespace label splits vertically and code has only about120px of text space. This is recorded as C26 for a scoped medium-width layout investigation, not hidden by declaring the hierarchy slice fully sufficient. No new layout has been implemented yet.

Fresh complete local Vitest on3794 product source finished with139 files/1366 tests passed,4 files/10 tests skipped,356.69s. Started14:25:15 UTC; completion was first observed14:31:40, so it is not reported as completed in the preceding22:14–22:29 local-time window. Only documentation changed during this run. Exact3794 run43442460319 remains the browser/CI authority for C25.

### 2026-11-13 14:40 UTC — C24 exact gate closure and C26 implementation in progress

Exacte8dc run43441170048 completed all three jobs:153 real tests and140 geometry checks. Its visual finding is bounded: desktop vertical hierarchy improved, while medium-width readability remains the separate C26 issue. Exact3794 currently has the accessibility job green; fixture and real-service jobs remain in progress.

C26 product implementation began in a separate tree at14:36:56 UTC. Workspace opts into a420px medium auxiliary dialog with a conversation-first closed default; shared inline consumers and desktop layout preferences remain unchanged. The candidate is being reviewed for background inert, tabs inside the focus scope, closing/resize focus and keeping the same medium Inspector mounted. Cross-layout breakpoint changes still use the existing different layout components; no commit-draft persistence across those remounts is claimed.

The main browser candidate changes the old inline geometry contract explicitly, requires360–420px containment and a full-width inert conversation behind the modal,44px internal close controls,Escape/scrim focus recovery and24 keyboard Tab steps kept inside. The1024 case additionally captures1179 then checks1180 inert release and preserved parent-owned staged state. Four cases collect and explicit E2E types/lint pass; there is no browser result for C26 yet.

### 2026-11-13 14:43 UTC — C26 integrated candidate validated

The opt-in product candidate is integrated. One freshly built local shared UI package was used for47 tests across seven files (Workspace, shared layouts, Git render/tree, Diff and layout preferences); all passed in12.61s. UI/web types,lint,production build3.50s,CSS budget and independent static CR passed. The default shared inline presentation is unchanged. Within medium mode the conversation/Inspector nodes stay mounted while closing or switching auxiliary tabs; cross-layout remount limits remain explicit.

CR found that clicking the full-size scrim's center is covered by the420px drawer at768; the test now clicks the genuinely exposed left strip, without force. A supplemental full-page serious/critical axe scan is added for open medium Inspector at768/1024. Explicit E2E types/lint pass; no actual C26 browser geometry or axe result is claimed before the new exact-SHA CI.

### 2026-11-13 14:45 UTC — Exact3794 fixture failures, publication held

Exact3794 verify failed in four newly added C25 fixture cases while64 others passed. At1440/1024/768 the actual badge was `git-clean-state unknown`, but the test's word-boundary regex matched `clean` within the base class `git-clean-state`. This is corrected to an explicit classList token check; the absence of the clean label and presence of unknown/error remain required.

The390 failure is a genuine controlled-layout initialization defect, not dismissed as a selector failure: the initial single-mode effect calls the default-middle setter even when the parent supplies controlled-right, invoking the Workspace callback that closes the deep-linked Inspector. Source investigation is being confirmed with an isolated failing regression before a minimal correction. The browser journey retains direct `?view=changes` navigation and additionally requires the query to remain, rather than clicking Git to bypass the defect. C26 publication is held until this fix is reviewed and integrated.

### 2026-11-13 14:49 UTC — Deep-link and actual-node focus corrections integrated

The controlled-single initialization reproduction failed before the fix and now passes: only uncontrolled layout may emit its default panel, while controlled initial/right and medium-to-phone transitions preserve the host selection. The actual mobile Workspace integration also exposed a separate focus lifecycle defect. Session-ready alone was tested and remained red because the shared layout initially has no measured mode and no close button. Stable callback refs now register actual close nodes; the effect waits for the real visible Workspace and rebuilds against the current node, without a timeout.

Cold and warm direct-link tests require the real heading and close-button focus. Additional session-error unmount checks require the old Escape trap to stop preventing default, then require focus recovery when the view returns. The sibling candidate passed34 tests,UI build,types/lint/build and static review; the main tree is running a fresh broader regression before publication. The original390 browser direct URL remains unchanged, with query preservation and close-focus assertions added.

Final integrated validation completed14:49:56 UTC:8 files/52 tests passed in13.00s against the newly rebuilt shared UI source. UI/web types,lint,production build3.67s,CSS budget and exact19eeeb7 static CR passed. Explicit E2E types/lint and eight-case collection passed. The combined C26/C27 candidate is ready for publication; actual new overlay/deep-link/axe evidence remains pending CI.

### 2026-11-13 14:52 UTC — Combined publication and exact run

Published ae5f6c3de040354e923bf8e0848c51ca0f9a50d0 and fetched it at14:51:30 UTC; its tree da057a3f9da0238dbd5a3d2d137e659669f389e8 exactly matches the reviewed local tree. Exact run43446740333 was verified from its complete-SHA link. C26/C27 and the corrected C25 fixture gate await this run's actual browser evidence. A fresh complete local Vitest run started14:51:55; product source remains unchanged during it.

Previous3794 real-service finished153 passed and140 geometry checks, and accessibility succeeded, but its four fixture failures remain part of its red overall result. These regular real journeys do not replace the previously failing error/recovery fixture or new medium dialog/deep-link evidence. Current plan rows have been reconciled with already-recorded exact C16–C22 closures; no historical failure entry was erased.

### 2026-11-13 14:58 UTC — Exactae5 complete local regression

A fresh full Vitest run on ae5 product source exited0:141 files/1373 tests passed,4 files/10 tests skipped,359.21s. It started14:51:55 UTC and completion was first verified14:58:35. Only documentation reconciliation changed while it ran. This is one complete run, not the sum of focused test counts, and does not replace the pending new browser/154-state CI evidence.

### 2026-11-13 15:09 UTC — Actual medium evidence and new selected-Diff accessibility failures

Exactae5 fixture finished66 passed/2 failed. All four C25 direct-link/error/recovery cases now pass, including mobile close focus and preserving the query. Personally viewed its768 Diff and390 Git error images: the420px drawer keeps the full filename and code readable with an internal close button; Git failure clearly says cleanliness is unknown and offers retry. QA also inspected the recovered390 image. These close the bounded C25/C27 browser defects, not the entire ae5 run.

The two failures are the added1024/768 selected-Diff axe gate, each containing two rules/five nodes: unnamed original/modified native edit contexts; selected deletions contrast4.29; CSS property red on insert/character highlights3.45 and3.05. The154 read-only page-state job being green does not cover this selected-code state. The1179 capture and subsequent keyboard loop follow this assertion and therefore have not run to completion.

C28 retains all rules and4.5 threshold. Monaco themes inherit their existing light/dark palettes and diff backgrounds, overriding only the attribute/property token; local deletion statistics darken only in light mode. Testing both inserted and deleted composite backgrounds rejected an initial insufficient color before finalizing the deep-red token. Documented originalAriaLabel/modifiedAriaLabel identify both editors and the full file path, with a meaningful pathless fallback. The actual editor initialization waits for theme registration, and readOnly/model/diff semantics remain unchanged.

Integrated47 tests across six files passed in11.84s, with types/lint,production build3.43s,CSS budget and independent static CR. New four-width assertions inspect both actual editor textbox names; the full axe scan remains. These are implementation/source validations, not a claim that actual new Monaco pixels or labels already pass CI.

### 2026-11-13 15:20 UTC — Complete dc regression and dark selected-code coverage candidate

The full local run on dc779 product source exited0:143 files/1379 tests passed,4 files/10 tests skipped,358.55s. Completion was first verified15:19:51 UTC. Only E2E coverage was edited during it; no product source changed. Exact run43450329364 currently has accessibility success, while fixture and real-service continue.

Coverage review confirmed the154-state audit visits the default Workspace, while the supplemental selected-code axe gate covers medium light only. A test-only candidate uses the actual Settings theme control, opens a selected CSS Diff at all four widths, checks both editor names and source content, and captures full-page axe,console/page errors,zero Git writes and screenshots for unified and requested-split settings. Explicit E2E types/lint,four-case collection and independent static CR passed; none of these are browser execution results.

CR found that Monaco defaults to inline when space is below its900px threshold, even when split is requested. The candidate was corrected to label the second state split-requested and record actual original/modified pane bounds/display. It does not claim real two-column coverage or alter the production threshold just to make a test pass. Actual captured geometry will inform a separate usability decision.

### 2026-11-13 15:42 UTC — C30 actual Monaco name reset repair

Exact dc fixture results are64 passed/4 failed: both actual editor names stay empty at all four widths after30s. Its real-service153 passes/140 geometry checks and154-state audit success do not close this failure. C28 documented options were insufficient at runtime. Installed Monaco0.56 diffEditorEditors autorun passes an empty changed-options summary on initialization/layout and unconditionally resets child ariaLabel to an empty string.

C30 binds only explicit host labels through public child-editor getOption/updateOptions/onDidChangeConfiguration APIs. A cancellable, coalesced microtask reads latest committed labels, skips equal/missing labels and cleans listeners on editor disposal or wrapper unmount. No private DOM mutation, EditContext disabling, axe suppression or model/patch semantic change. Independent review checked real Monaco React4.7 asynchronous mount ordering as well as StrictMode tests.

Seven files/53 focused tests passed; final web types/lint/build/diff-check completed15:41:47 UTC after correcting a test-only incomplete-instance cast. Static CR passed. Actual four-width textbox names, selected-code contrast and subsequent keyboard/resize checks remain new-CI gates, not claimed successes. Requested split still requires actual geometry evidence; no threshold was changed.

### 2026-11-13 15:45 UTC — C30 publication and resize-name guard

Published209ac08d74e9b3b145a509e7a3b4f43d9862a7b2 was fetched and its tree cab67f439f4377079f026a79c84f2a490c81fa22 verified15:44:12 UTC. Exact CI43455570705 is pending; a full local test run began15:44:27. A test-only follow-up reuses the unchanged actual two-textbox/full-path name assertion after1179,1180 and returning1024, specifically guarding layout-triggered resets. Explicit E2E types/lint,eight-case collection and independent static CR passed15:45; these remain browser-pending assertions, not completed resize proof.

### 2026-11-13 15:50 UTC — C31 independently observed dark value contrast

Exact420 fixture archived8 failed/64 passed. Seven failures are the old empty names; mobile390 dark did reach axe and found two separate serious contrast nodes: CSS block value CE9178 on6f1313 at4.46, and grid value CE9178 on4b5a2a at2.84. Its real-service153 passes/140 geometry and default154 audit success do not invalidate these findings. Neither209 nor6fb is claimed to fix this inherited dark color defect.

Monaco0.56 CSS tokenizer was independently traced from rulevalue/term/name to attribute.value with css postfix. The bounded candidate overrides only dark attribute.value.css toF4C7AF; light, other-language strings, property blue, numeric colors and all diff backgrounds remain unchanged. Exact-background numerical ratios are7.67 and4.88, which are source tests, not browser validation. The test follow-up retains full per-mode axe attachments and aggregates serious/critical failures at the end, allowing requested-split evidence after a unified contrast failure without weakening the zero-violation gate. Other hard failures still stop the journey; unvisited modes are never counted as passes.

Full209 product regression exited0 at15:50:30 UTC:145 files/1389 tests passed,4 files/10 skipped,362.80s. Only tests/E2E and documentation changed during the run. The C31 product candidate was cherry-picked afterward, so this count is not presented as a full regression of the new color override.

C31 integrated validation completed15:51:06 UTC:5 files/19 targeted tests passed, web and explicit E2E types/lint, production build3.27s and diff-check succeeded. Independent static review covered the exact CSS token and unchanged background rules, plus the per-mode evidence aggregation. Actual new-SHA dark pixels and all requested presentations remain CI-pending.

### 2026-11-13 15:54 UTC — Actual C30 name/light-drawer gate closure

Exact209 fixture archived68 passed/4 failed. All four Workspace primary cases passed, including actual original/modified names, selected light-code axe and the previously blocked medium resize/keyboard/close sequence. This is actual browser closure of those C30/C26 gates, not a fully green run: four dark cases still report the inherited grid contrast2.84 that C31 targets. The extra per-breakpoint name assertions added in6fb require that exact run and cannot be inferred from209.

Evidence correction: the initial420 failure log contained block4.46 and grid2.84, but the downloaded final-retry axe JSON contains only grid. These are different attempts, not identical two-node JSONs. Personally viewed the420 dark390 image and read its final JSON; unified pane geometry was original25px/modified319px. There is still no claim that split-requested actually displayed two full panes.

At15:56:01 UTC personally viewed exact209 workspace-review-medium-1179-desktop-1024.png: the420px right drawer, internal close button, scrim and full readable code have no visible edge clipping. Personally read both workspace-medium-drawer-axe-desktop-1024.json and tablet-768.json; both are empty arrays. This supplies actual1179 image evidence for C26 and selected-light contrast closure, without treating209 as the newer6fb per-resize-label test or C31 dark validation. Exactac79 run43457114626 is still pending.

### 2026-11-13 16:01 UTC — Latest complete regression and bounded TSX coverage candidate

Fullac79 product regression exited0 at15:59:51 UTC:145 files/1390 tests passed,4 files/10 skipped,362.26s. Product source remained unchanged during the run. Exact6fb fixture then archived68 passed/4 dark failures at16:00:26, with the added1179→1180→1024 actual editor-name assertions passing. C30 per-breakpoint closure is therefore now based on its own run. Exactac79 default accessibility is successful, but selected-code fixture and real-service remain pending.

The existing common git/diff fixture returns CSS regardless of selected path, so clicking its TSX row is not credible TSX syntax coverage. A new isolated390-dark case supplies a valid, exact-path five-line TSX patch with let→const,1→2 and idle→ready changes, selects the actual staged scope, waits for TypeScript labels/content/names, captures screenshot/full axe and enforces zero Git writes/runtime errors. Other widths are explicitly skipped for this focused lexical audit; no broader palette was changed from source predictions alone. Explicit E2E types/lint and four-project collection passed16:00:59, which does not mean any browser audit has executed.

### 2026-11-13 16:08 UTC — C33 semantic disclosure and C34 explicit split candidates

Exactac79 fixture archived71 passed/1 failed. Four-width dark CSS samples no longer report contrast violations;390/768/1024 both requested-mode audits are empty. Desktop1440 both audits instead expose a real nested-interactive issue: the conversation ThinkingBlock places a button inside native summary. The full-page axe scope remains unchanged. C33 makes summary the single interactive control with dynamic label/expanded state and noninteractive span descendants; streaming automatic open/finish collapse remains, and the main journey now exercises real focused Enter/Space rather than only mouse clicks.

Personally viewed ac79 dark390 unified and1440 split-requested images at16:07 UTC. CSS values are visibly lighter, but the split button still displays one code column. All four actual requested-split layouts retained an original25px gutter. C34 disables Monaco's automatic inline fallback only in this DiffViewer; default remains unified and explicit user choice requests two panes. The four-width fixture now requires both panes≥100px, non-overlap and visible original source, then switches back to the original small-gutter unified view. This is a real behavior correction backed by prior geometry, not a renamed screenshot or smaller threshold. Narrow split comfort still requires new images; pane width alone does not prove readability.

Integrated validation finished16:08:41 UTC:7 files/49 tests passed, web types/lint/build, explicit E2E types and eight-case collection passed; independent static CR covered both the summary semantics and explicit split/return contract. Actual new keyboard, all-width pane geometry and full-page axe remain exact-CI gates.

### 2026-11-13 16:12 UTC — C33/C34 publication

Publishedbb107c1195649ca79cf79238123cad9b041b5e2c was fetched and its tree77aeab284eba1674d778ddbc9968d6b20c1272de verified16:11:38 UTC, matching the reviewed local candidate. The branch remains dot/agenthub-rebuild, not main. A fresh complete local regression started16:11:59. The actual new summary keyboard/axe and narrow two-pane comfort remain CI-pending; no source-test count is used as screenshot evidence.

### 2026-11-13 16:17 UTC — Actual TSX keyword finding, not a broad palette rewrite

Exactc8 fixture archived71 passed/2 failed plus3 explicitly skipped TSX widths. Besides the already-known desktop nested disclosure, the new390 TSX audit found one serious const token:569cd6 on373d29 at3.82, with the same node in initial and retry evidence. At16:16:54 personally viewed the actual TSX screenshot; at16:17:18 personally read its final JSON confirming exactly that node. Long return text scrolls within the editor without page overflow.

The next bounded candidate changes only dark keyword.ts after confirming Monaco's TypeScript token postfix. This audit did not report string or number nodes, so they and JavaScript are not being changed based only on numerical predictions. The original legal patch, staged request, full-page axe and4.5 threshold remain. The bb107 complete regression is still running with product source unchanged; no new browser success is implied.

At16:18:13 UTC fullbb107 product regression exited0:146 files/1392 tests passed,4 files/10 skipped,373.42s. Product was unchanged during this run. Only afterward was the two-file C35 candidate integrated: dark keyword.ts=B1D3FF, with the exact373d29 and composite line/character backgrounds tested while preserving light, backgrounds and other tokens. Candidate6 color tests/types/lint/build/static CR passed; main integrated validation is in progress. This fullbb107 count is not claimed for the new C35 product.

C35 main integrated validation completed16:18:40 UTC:5 files/20 tests passed, web types/lint/production build and diff-check passed. Publication is pending; the exact new TSX axe result is still required and not inferred from these numerical/source tests.

### 2026-11-13 16:24 UTC — C33/C34 real fixture gates passed

Exactbb107 fixture archived72 passed/1 failed. All four primary Workspace journeys and dark CSS unified/split-requested journeys passed: native summary Enter/Space and semantic axe, real original/modified pane minimum widths/non-overlap/original source, and return to unified were actually executed. The remaining failure is the prior TSX const contrast targeted by8eb, not a summary or split failure. Default accessibility succeeded; real-service is still running. The new narrow split images are being inspected separately, so passing geometry is not yet described as visual comfort.

C35 was published and fetched16:21:08 UTC as8eb66a7871a754fcd70c45566fc27824bc66a7e8, tree96c9bec155c346d2742c039ba777c67edcdafa16 matching the reviewed local candidate. Its actual new TSX audit and full CI remain pending;20 targeted local tests are not relabeled as a full1393-test run.

### 2026-11-13 16:35 UTC — Actual C35 fixture closure

Exact8eb verify is green:73 fixture tests passed,3 explicitly planned non390 TSX skips; its CI unit run passed146 files/1393 tests with10 skipped. Default154-state accessibility also succeeded, while real-service is still running, so the complete run is not called green. Personally viewed the new390 TSX image and read its final axe JSON at16:35:26:empty. CSS four widths×two modes and medium selected-code audits are also empty; the lawful lexical sample was retained. This closes the tested TS keyword defect, not every language/token combination.

C36 test-only work now checks opt-in focus with actual textarea/Monaco node sentinels, selected file and draft preservation, unchanged layout preferences, expanded real pane geometry, Escape-before-drawer-close, keyboard re-entry and zero Git writes. Static review caught that selecting a file already opens its commit form; the redundant expand click was removed and the input is awaited directly. Explicit E2E types/lint passed16:35:06. Product integration and all new browser evidence are still pending.

### 2026-11-13 16:40 UTC — C36 state-preserving opt-in implementation

The shared rightFocused prop defaults false and is opted into only by Workspace. Wide layout expands the existing right grid slot while retaining hidden/inert left/middle wrappers; medium reuses the same dialog/Inspector; phone offers no ineffective expansion. No ratios/collapse preferences are written. Native header controls expose pressed state; first Escape exits focus without simultaneously closing the medium drawer, consumed Escape is respected, and explicit exit returns focus to the same control. Session/phone/left-panel/closed-inspector changes invalidate the temporary mode.

The independent candidate passed39 relevant tests, including the real Workspace component with a deferred fetch-mocked Git request remaining single-owner/single-POST, unchanged draft/Monaco/chat nodes, no layout-storage writes and boundary invalidation. UI build/types/lint/build/budget/static CR passed. Main integration rebuilt the shared UI and passed an initial8-file54-test run; the complete related suite is running. The new fixture uses actual node sentinels, expanded pane geometry and full axe without submitting Git. Existing cross-layout remount behavior is explicitly not claimed fixed.

C36 final integrated validation completed16:40:39 UTC:10 files/59 tests passed in15.08s, rebuilt shared UI and web types/lint/production build/CSS budget/diff-check passed, and four-project fixture collection passed. Product and E2E static CR are both approved. New actual focus width/readability, state continuity and axe remain pending publication/CI.

### 2026-11-13 16:46 UTC — Stable baseline fully green; focus candidate pending

At16:45:48 UTC exact8eb run43461841943 finished all three jobs successfully:fixture73 passed/3 planned skips,real-service153 passed in22.6m/140 geometry checks,and154-state accessibility success. The11 supplemental CSS/TSX/medium axe files and corresponding actual images had already been inspected. This is a fully verified baseline, not evidence that the subsequent focus feature passes.

C36 was published and fetched16:44:44 UTC asba8f625b572e0e30db3e2317dcd1a6a6a4b8128b, tree293c90e56348c7a24c0b842fce52a783db2182af matching the reviewed local candidate. One prior tree-object timeout did not move the branch; the incremental retry completed before the branch update. Exactrun43465773377 is now pending, and a fresh full local run started16:46:08. Product source remains frozen during that run.

### 2026-11-13 16:53 UTC — Complete focus-candidate local regression

Fullba8 product regression exited0 at16:52:17 UTC:147 files/1398 tests passed,4 files/10 skipped,368.79s. No product files changed while it ran; only documentation was reconciled. This verifies the full local suite, not the pending new browser focus journey or its wide-code readability. Clarification: the pending-Git continuity test uses the actual Workspace component with a deferred fetch mock, not a real repository commit; the browser focus journey intentionally checks zero Git writes.

### 2026-11-13 17:01 UTC — C37 focused selected-action contrast

Exactba8 fixture archived74 passed/3 failed. The new1440/1024/768 focus journeys reached their final axe assertion after node/draft preservation, expanded real pane geometry, restore/Escape/preferences and zero-write checks. All three failures are the selected-row Diff preview button:6e6e6e onededed at4.35. The selected state and full axe remain; this is not reported as a fully passing focus journey.

C37 changes only the scoped Git preview action foreground from tertiary to secondary, reading the actual Codex light/dark tokens in its contrast regression. No background/global token/Git behavior is changed. Independent static CR passed. Integrated validation completed17:00:23 UTC:7 files/33 tests passed, web types/lint/build3.81s/CSS budget/diff-check passed. New exact focused axe results remain pending publication and CI; prior fullba8 counts are not reused as a full new-product run.

### 2026-11-13 17:08 UTC — Focus image inspection and C37 publication

C37 was published and fetched17:06:57 UTC as742bd7b1f7a0888a7c594d3a270237ee582fbcf0, tree55bc3377cd61c481bfc4369e748dcf1a5729cc3d matching the reviewed candidate. Its new browser results remain pending.

Personally inspected exactba8 focused1440/focused768 and restored768 images, then read the three geometry attachments. Focused original/modified panes measure692px each at1440,467px at1024,and339px at768, versus the narrow default panel. The two CSS sides are now readable in the inspected focus images; restored768 returns to418px Inspector with focus on its entry button and the draft still visible. The code begins around773px in the768 focused screenshot because this preservation test deliberately opens the commit form. That evidence does not establish a defect in the default preview-only reading state. A separate preview-only screenshot/geometry/axe journey is being prepared without replacing this draft-preservation case or changing product layout. Exactba8 remains red for its selected Diff action contrast, regardless of visual width improvement.

At17:08:28 UTC exactba8 real-service completed153 passed in20.4m plus140 geometry checks; the default154 accessibility job also succeeded. Overallba8 is still red because verify retains the three focused-action contrast failures. ExactC37 run43469517694 was matched to the full742bd7b SHA and is running; no result is inferred from the prior run.

### 2026-11-13 17:10 UTC — Preview-only reading evidence candidate

A separate fixture journey now previews CSS without selecting any commit paths or opening a commit form, captures natural focused unified and explicitly selected split states, records pane/code/viewport geometry, checks two accessible editor names and complete serious/critical axe in each state, then restores the original width/focus/preferences with zero Git writes. No scrolling/content removal or product change is introduced, and the original draft-preservation case is untouched. Three nonphone viewports execute this case; phone is an explicit planned skip because it has no focus control and remains covered by the original case. Independent static CR passed. Main explicit E2E types/lint passed; collection initially used a nonmatching abbreviated grep and returned no tests, then the exact test prefix collected all four configurations at17:10:18. Collection is not browser execution; natural reading images remain pending CI.

### 2026-11-13 17:15 UTC — Reference fidelity recheck without cosmetic churn

At17:15:38 UTC personally viewed the original selected concept alongside exactba8 default three-column1440, selected CSS Diff1440 and mobile conversation390, extracted from the already-downloaded fixture archive. The gray session rail, white conversation canvas, light user bubble, bottom composer and actual right-side review structure match the selected hierarchy. Actual Git metadata/staged/whitespace/commit controls add density relative to the concept; they are functional information, not grounds to remove status or pretend the Diff is relative to main. Phone retains one content mode instead of squeezing three columns. The fixture's preparing composer is a seeded state, not evidence of a real permanently disabled session. No new source-confirmed visual blocker was found in this pass. Preview-only focus screenshots from611 remain pending; ba8 images do not prove742's contrast fix.

### 2026-11-13 17:22 UTC — Exact contrast closure and full local regression

At17:17:29 UTC exact742 run43469517694 verify succeeded:77 fixture passes/3 planned skips, including all three nonphone draft-focused journeys with their complete axe gates; the phone no-control branch passed. CI unit results were147 files/1399 tests passed with10 skipped, and default154 accessibility succeeded. Real-service remained running, so this was not yet called an all-green run. This closes ba8's three observed selected-action contrast failures without excluding that state.

The independent complete local611 product regression started17:16:07 and exited0 at17:22:11:147 files/1399 tests passed,4 files/10 skipped,363.50s. Product source stayed unchanged; only this QA document was edited. The new preview-only reading journey remains pending actual611 browser results and does not inherit its visual approval from742 or from these unit counts.

### 2026-11-13 17:32 UTC — Natural reading evidence and large-list investigation

Exact611 verify archived80 passes/4 planned skips, including all three preview-only reading journeys. Personally viewed768 unified/split and1440 split near17:29, then read all six supplemental reading axe files at17:31:50:each empty. The natural768 code top is593.5px, versus about773px with the deliberately expanded draft; split panes339px. At1440 code starts503.5px and panes692px. This supports usable short-file reading without changing or hiding submission controls. Exact742 all three jobs succeeded at17:29:17, with real153 passes in19.2m and140 geometry checks;611 real remains pending.

Source review found the change list maps every file and has no height limit. Forty files may therefore push the Diff below the initial viewport, but that larger case has not yet been photographed. A separate isolated40-entry status fixture now records list/Inspector scroll dimensions, code geometry and natural screenshots before any scrolling, with full axe and zero Git writes; the original CSS target sorts first. It deliberately does not assert an invented desired code-top threshold or call a passing diagnostic acceptable UX. Three nonphone widths execute; phone is a planned skip. No product CSS is changed. Static CR requested waiting for the existing focused Inspector width before sampling to avoid transition geometry; that wait was added. Explicit E2E types/lint and four-project discovery passed; actual large-list evidence remains pending CI.

At17:32:40 UTC exact611 run43470452490 completed all three jobs successfully:verify80 passes/4 planned skips,real153 passes in19.1m plus140 geometry checks,and default154 accessibility success. The six additional natural-reading axe files and inspected images are the dynamic-state evidence, not inferred from that default matrix. Both742's contrast closure and611's preview-only reading baseline are now fully closed; the new40-file diagnostic is still unexecuted.

### 2026-11-13 17:49 UTC — Actual large-list defect and bounded C40 candidate

At17:45:25 the exact959 archive showed all three lists at1932px with no internal scrolling; code top2279.5 at1440 and2369.5 at1024/768. Personally viewed1440 and768 natural images and read all three geometry files:the entire first screen is file rows, no selected Diff code. The diagnostic's83 fixture passes and empty axe files do not make this acceptable reading UX.

C40 applies a max-height min(240px,24dvh) and auto vertical scrolling only under the existing focused ancestor; all file nodes and controls remain, errors/receipts/drafts remain outside the list, default layout and Git handlers are untouched. Independent14 tests/types/lint/build3.31s/budget/static CR passed; main integration is validating. The same40-file fixture now requires an actual180px editor/Inspector/window vertical intersection at the existing900/1000 heights, with outer scrollTop0 before screenshots, and real79-Tab traversal to the last preview followed by keyboard selection, directory/list persistence, select-all/clear, original preview preservation and width/list-height/preferences restoration. Static CR caught that a code-top-only threshold could not prove visible height; it was replaced with the real intersection calculation. No short-screen or real40-file-repository guarantee is inferred. New actual images/keyboard/axe remain pending.

Main integrated validation completed17:48:58 UTC:5 files/53 focused tests passed, web types/production build3.40s/CSS budget passed. Changed tests/E2E lint,format and diff-check passed; product and E2E independent CR approved. This is not a full new-product run or actual browser proof of the new scroll behavior.

### 2026-11-13 18:01 UTC — C40 full local regression and separate phone diagnostic

C40 was published/fetched17:52:02 UTC asd19ed9ece734ec9cc7360158472f8381f184fa5a, tree537eef127dc3d5215b71f23da0db222367b2f880 matching the reviewed candidate. Its complete local suite started17:52:28 and exited0 at17:58:31:147 files/1401 tests passed,4 files/10 skipped,361.87s,with product source unchanged. This completion belongs to the earlier reporting window. Exactrun43477008148 is still pending actual scroll/keyboard/images; prior959 diagnostic all-green status does not erase its photographed UX defect.

Phone has no focused ancestor/control, so C40 deliberately does not fix its large directory. A separate phone-only40-file fixture now preserves natural geometry/screenshot/full axe before scrolling, asserts outer scrollTop0 and no selections/draft/Git writes, then records a separately named after-wheel image and positive code/body/window intersection. This is Chromium mouse-wheel simulation and only partial reachability, not physical touch testing or a claim that the first screen is usable. Three nonphone configurations are explicitly planned skips, and their existing C40 gates remain. Independent static CR passed; main explicit E2E types/lint/diff-check and four-project discovery passed18:00:50. No product change or new full-unit result is claimed for this test-only slice.

### 2026-11-13 18:04 UTC — Phone boundary audit without speculative changes

The independent phone review examined an earlier390 Diff image and confirmed the related toolbar sizing source is unchanged throughd19:29px minimum controls and small gaps have less touch margin than44px, but this is not automatically a WCAG2.2 24px failure or evidence that a control is blocked. The44px close control remains outside the independently scrolling Inspector body. No new P1/P2 beyond the pending40-file phone scale investigation was established, so no blanket sizing change is introduced merely to generate work.

C41 was published/fetched18:03:03 UTC as9773ecc3f608fa2e64c22f91da43e04ff80c6526, treea6de2e1bdf00bbeed819f7b2cb3ba18a0f01d8ab matching the reviewed test-only candidate. Product remainsd19. Its natural phone evidence is pending, separate from the actual C40 three-width scroll fix.

### 2026-11-13 18:05:58 UTC — C40 actual browser improvement

Personally viewed exactd19 768/1440 natural40-file images and read all three geometry/axe files. At768/1024 the list is216px with1932px internal content, outer scrollTop0, code top653.5 instead of2369.5, and actual visible editor intersection238px. At1440 the list is240px, code top587.5 instead of2279.5, visible intersection389.5px. The code is now genuinely on the first screen; no screenshot scrolling was used. Three axe arrays are empty. Verify archived83 passes/5 planned skips, and all three long-list cases passed their complete79-Tab/Space/directory/select-all/clear/preferences restoration sequence. Default accessibility succeeded; real-service remains running, so the complete run is not yet called green. The977 phone-only diagnostic has no actual result yet and is not covered by the focused-mode improvement.

### 2026-11-13 18:15–18:18 UTC — Phone actual evidence and independent rail semantics

A transient cloud disconnect cleared before edits:at18:15:05 the original worktree/HEAD was actually readable again, so no lost-candidate or unavailable-execution claim is carried forward. Personally viewed977 phone natural and after-wheel images. Natural code top2327.5 with list1932px and outer scrollTop0; after1745px outer scrolling code top582.5 is readable. This is still a first-screen scale defect, not a successful mobile design simply because the diagnostic and axe passed. Exactd19 all three CI jobs have meanwhile succeeded:real153 passes in20.4m and140 geometry checks archived18:13:40–41.

C42 implements actual session lastActiveAt in the rail's second metadata row with branch ellipsis, leaving title width intact. Short absolute time avoids a stale relative clock; full local date and ISO are retained, missing/invalid values are unknown, and valid future dates are not rewritten. Static accessibility review suggested removing generic-span aria-label from unknown time; it now uses a screen-reader-only prefix plus visible unknown. That is a semantic precaution, not an observed axe failure. Main40 related tests/types/lint/build3.19s passed before this precaution, and40 tests/types/lint passed again after it. Sorting/navigation/windowing remain unchanged; actual narrow-rail evidence is pending.

C43 adds only a<=767 list bound/auto-scroll rule, not a global Inspector clip. Independent16 tests/types/lint/build3.13s/budget/CR passed. The existing phone40-file sample is upgraded to actual initial180px editor/Inspector/window intersection at390x844, then real wheel input targets the inner list and checks the last preview in its visible bounds, followed by selection/directory/select-all/clear/original-preview and zero-write checks. Natural and after-scroll screenshots remain separate. This is not a claim about physical touch or arbitrary short screens; new actual results remain pending.

Main combined C42/C43 validation completed18:18:45 UTC:6 files/63 focused tests passed, web types/build3.58s/CSS budget passed. Final E2E types/lint/diff-check passed18:20:08; the two four-project journeys were successfully discovered. Static review tightened the phone last-row bounds to the intersection of list and real viewport, and the close control now also requires full viewport intersection. An initial string-edit missed the intended last-row predicate and was caught by direct source reread before publication; the exact phone predicate was then corrected and rechecked. No claim of a browser pass is made for these candidates.

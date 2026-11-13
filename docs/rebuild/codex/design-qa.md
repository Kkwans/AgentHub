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

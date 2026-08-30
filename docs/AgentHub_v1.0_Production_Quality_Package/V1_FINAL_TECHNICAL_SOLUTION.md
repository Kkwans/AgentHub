# AgentHub v1.0 最终技术与产品质量方案


> **审计基线**：GitHub `Kkwans/AgentHub` / `main`，commit `d09c575e2aaad749a8f0c822d89b3531d8634337`，审计日期 2026-08-30。本文中“当前实现”均指该基线；未能在本地启动真实部署的视觉结论会明确标为“需运行态复核”。


## 0. Executive Decision

AgentHub v1.0 的主题定义为：

> **Production Workbench — 从“功能完成”进入“产品完成”。**

v0.9 已经完成一次重要的代码组织重构，但当前质量仍更接近“功能型开发工具”而不是成熟商业软件。v1.0 不新增大体量后端能力，**80% 资源投入产品呈现、交互主链、设计系统、真实数据稳定性、QA 和发布收口**；只有 UI 无法正确表达业务语义时才做必要后端/API 增量。

---

# 1. v1.0 的产品定义

AgentHub 不应看起来像：

- NAS 管理后台；
- 把很多 API 数据摆成 Card 的控制台；
- IDE 的网页仿制品；
- Prompt 管理 + Agent 管理 + Git 管理的功能集合页。

它应当看起来像：

> **面向 AI Coding Agent 的工作控制台：用户围绕 Project → Session → Work → Review 完成持续开发。**

一级认知对象只保留：

1. **Project** — 工程上下文。
2. **Session** — 与 Agent 的连续协作空间。
3. **Work** — 可追踪的工作项。
4. **Agent** — 执行主体。
5. **Prompt Asset** — 可复用工程上下文资产。

Run、Approval、Tool Call、Execution Target、Worktree、Prompt Version 等都属于二级/三级对象，不应长期占据主导航。

---

# 2. v1.0 P0 目标

## 2.1 Visual

- 统一 4px 基线网格；所有主页面横向基线统一。
- 所有常规页面在 1440px 下采用 28px page gutter；1280/1024 使用 20–24px；移动端 16px。
- 首屏不得出现 > 180px 的纯装饰/无业务内容区域。
- 数据丰富页面首屏 900px 高度内至少呈现一块可执行业务内容，而不是只有标题/说明/大 Hero。
- 正文字号默认 14px；辅助信息 12px；禁止 10–11px 承担必须阅读的业务信息。
- 同一视觉层级只允许一套 radius/elevation，不再“每个 feature 自己定圆角”。

## 2.2 Interaction

- 高频操作在 1–2 次点击内完成。
- 所有可逆操作支持撤销或明确二次确认；所有不可逆操作必须说明影响范围。
- Workspace 只让用户同时理解 3 个区域：Session / Conversation / Review Inspector。
- Composer 的核心是“输入指令”，配置不能比输入框更抢视觉。
- Git Review 要做到：**目录 → 文件 → Diff → Reviewed/Commit** 连续完成，不跳来跳去。

## 2.3 Engineering

- 页面级 CSS ≤ 25KB；单组件 CSS module 建议 ≤ 12KB。
- 单个 React UI 文件建议 ≤ 350 行；超过 500 行必须拆职责或在 ADR 中解释。
- 禁止新增 `eslint-disable no-unused-vars` 作为迁移手段。
- 禁止 Workspace 修改 `--ah-accent-primary` 等全局语义 Token。
- 所有共享视觉规则进入 `@agenthub/ui` 或 feature component module，而不是大范围 `:global()`。

## 2.4 Release

- 根包、Web、Server、UI、README、CHANGELOG、App UI、Docker image、release 文档都统一为 `1.0.0`。
- 所有当前 UI/测试文案中清理 v0.6/v0.7/v0.8/v0.9 遗留（历史 CHANGELOG/Release 文档除外）。
- 生成 v1.0 visual baseline 并纳入 CI / release gate。

---

# 3. 当前源码主要矛盾

## 3.1 “组件拆了，但视觉规则没拆”

Workspace 组件拆分是正确方向，但 `workspace.module.css` 约 78.8KB，说明 layout、Session、Conversation、Composer、Inspector、Git、Terminal 的样式依然互相耦合。v1.0 必须按组件 ownership 拆 CSS。

## 3.2 Home 仍然是 Landing Page 思维

Home 是已登录工作台，却继续使用 385px Hero、装饰 Aurora、绝对定位 metric strip。商业开发工具首页应该优先显示：**继续工作、待处理、最近项目、运行状态**。

## 3.3 Prompt / Settings 仍是迁移后的“功能集合”

Prompt Library 仍是 1000+ 行页面；Settings 仍没有真正按路由 section 切割。v1.0 必须完成 IA 和职责拆分，而不是只 polish CSS。

## 3.4 Git Review 的空间模型错误

当前 Inspector 先选 `变更`，里面再选 `变更/Diff/历史/分支`，用户进入 Diff 后树会消失。成熟 Review 体验应是 **master-detail**：文件树/变更列表保留，右侧/下方持续展示当前 Diff。

## 3.5 Release Truth 不一致

1. Shell = v0.9。
2. package.json = 0.6.0。
3. README = v0.6.0。
4. E2E 文件仍叫 v07-workbench。
5. CSS 注释仍写 v0.8。
6. Settings 文案仍提 v0.6。

v1.0 必须一次清理。

---

# 4. v1.0 全局 Layout Contract

## 4.1 Desktop App Shell

| 区域 | 默认 | 允许范围 | 规则 |
|---|---:|---:|---|
| Global Sidebar | 220px | 208–232 | 不随页面变化 |
| Collapsed Sidebar | 60px | 固定 | Icon-only，Tooltip 必须 |
| Topbar | 56px | 固定 | 搜索 + 全局动作 |
| Page Gutter @≥1440 | 28px | 固定 token | 左右一致 |
| Page Gutter 1024–1439 | 22px | token | |
| Mobile | 16px | token | |

## 4.2 Content Width

禁止所有页面都 `max-width:none`。根据任务类型定义：

- Dashboard/List：全宽，但保持 gutter。
- Settings/Form：`max-width: 820px` 主内容。
- Detail/Reading：`max-width: 1120px`。
- Prompt Editor：两栏全宽。
- Workspace：100vw / 100dvh，不经过 AppShell gutter。

## 4.3 Vertical Rhythm

4px grid：4 / 8 / 12 / 16 / 20 / 24 / 28 / 32 / 40 / 48。

页面默认：

- PageHeader → first content：20px。
- Section → Section：24px。
- Section title → body：12px。
- Row vertical padding：10–14px。
- Surface padding：16px / 20px，不允许同一页同时出现 17、18、19、22 等随意值。

---

# 5. Design System v1

v1.0 不是换 Mantine，而是在 Mantine 上建立 AgentHub semantic contract。

## 5.1 Foundation

- UI Sans：Geist Variable + PingFang SC / Microsoft YaHei UI / Noto Sans CJK SC。
- Mono：JetBrains Mono。
- 正文：14/1.55。
- Label：12.5/1.4。
- Meta：12/1.4。
- Page title：28–30px。
- Workspace title：14–16px。

## 5.2 Control Heights

- xs = 28px：仅紧凑 tool/inline。
- sm = 32px：toolbar。
- md = 36px：常规 form / button。
- lg = 40px：primary CTA / search。
- touch target：移动端最小 44px。

## 5.3 Surface

只保留 4 类：

1. Canvas
2. Surface
3. Subtle Surface
4. Elevated Surface

Card 不再默认有阴影；大多数工作台区域用 border/tonal separation，只有浮层才使用明显 shadow。

---

# 6. 页面级重构优先级

## Tier 0 — 必须先完成

1. Design System / Layout Contract
2. AppShell
3. Workspace 全链路
4. Settings IA
5. Visual QA 基线

## Tier 1

6. Home
7. Projects + Project Context
8. Prompt Library
9. Agent Center / Infrastructure

## Tier 2

10. Error/Empty/Loading/Skeleton
11. Mobile/Tablet
12. Dark mode
13. Performance / accessibility / final copy

不能先把 Home 做漂亮、最后再碰 Design System；顺序反了会再次产生局部样式。

---

# 7. Home v1

### 删除/压缩

- 删除 385px Marketing Hero。
- Aurora 装饰面积不得超过 header/work context 的 20%，并允许完全不显示。
- Metrics 从 116px Card 改为 72–84px summary tiles 或 inline stats。
- 项目默认不用 226px Card；最近项目用 64–72px entity row。
- 不默认展示完整 rootPath。

### 首屏结构

```text
Work Context / Continue
────────────────────────────────────────────────────────
AgentHub · 最近工作                         + 新建工作
上次：优化 Workspace Diff · 12 分钟前     继续 →

Active 3   Running 1   Review 2   Agents 4
────────────────────────────────────────────────────────
最近项目                              需要处理
AgentHub      4 work · main            Approval 2
PromptOS      1 work · main            Review 1
OpenCode      idle                     Failure 0
```

目标：用户进入 Home **3 秒内知道下一步做什么**。

---

# 8. Projects v1

默认 List 是主视图；Grid 作为 secondary preference。

主列：

- icon/avatar 36–40
- name
- one-line description
- repo type/language（可选）

次列：

- branch
- active work
- recent activity
- overflow action

rootPath 只在 hover details / Project Overview / Copy Path action 里显示。

Toolbar 默认只显示：Search / Status / Type / Sort；语言和更多过滤进入 Filter popover。

---

# 9. Workspace v1 — 核心发布页面

Workspace 是 v1.0 的封面页面，必须最先达到 9/10。

## 9.1 Geometry

| Panel | default | min | max |
|---|---:|---:|---:|
| Session Rail | 256 | 216 | 336 |
| Conversation | flex | 520 | ∞ |
| Inspector | 440 | 360 | 760 |
| Topbar | 50 | fixed | |
| Composer readable width | 820 | 620 | 920 |

如果 viewport < 1180：默认折叠 Session Rail；< 900：Inspector drawer；< 680：单主视图。

## 9.2 Session Rail

- Search 32px。
- New Session icon button / compact CTA。
- Running/Approval/Failed sessions pin to top “进行中”。
- Today/Yesterday/Earlier 仅用于 closed/recent。
- CLOSED 超过 10 个后默认折叠“历史会话”。
- Row 52–58px，不使用胶囊状态墙。

## 9.3 Conversation

主流仅包含：

- User message
- Agent response
- concise thought group
- concise execution group
- Approval card
- System recovery notice

Tool call 的 raw payload、command stdout、file operation detail 全部在 Activity Inspector。

Long session：必须支持虚拟化/分页加载、Jump to latest、new activity indicator、稳定滚动锚点。

## 9.4 Composer

视觉优先级：Textarea > Send > Context > Session config。

底栏建议：

```text
┌───────────────────────────────────────────────────────┐
│ 给 Agent 下一步指令…                                  │
│                                                       │
│ + Context   Codex · GPT-5.6 · High    按需审批   ↑   │
└───────────────────────────────────────────────────────┘
```

模型 + Mode + Reasoning 聚合成一个 `Session Config` control；Terminal 放 Workspace topbar/dock，不塞进 Composer context strip。

## 9.5 Inspector

一级只保留：

- Changes
- Files
- Activity
- Run

Changes 内不要再出现四个同级 tab。History/Branches 放 `⋯` Git menu 或独立 drill-in。

## 9.6 Git Review

桌面 ≥ 1280：

```text
Changes (tree 180–240px)
──────────────────────
apps/
  web/
    M Composer.tsx
    M workspace.css
──────────────────────
Composer.tsx  +42 -9
[Unified | Split]  [↕] [⋯]
──────────────────────
Diff fills remaining height
──────────────────────
Review progress / Commit dock
```

窄 Inspector：Tree 上部 34–42%，Diff 下部 flex；支持 splitter。

禁止 fixed 420px Diff。

---

# 10. Prompt Library v1

两栏 IA 保留，但完全组件化：

- PromptAssetList
- PromptEditorHeader
- PromptContentPane
- PromptVariablesPane
- PromptPlaygroundPane
- PromptBindingsPane
- PromptVersionDrawer
- PromptVersionDiff

版本历史不再用 900px 巨型 modal 同时塞 version/label/diff；改为右 Drawer 或 secondary pane。

---

# 11. Settings v1

真正使用 route section：

```text
/settings/appearance
/settings/account
/settings/security
/settings/integrations
/settings/system
/settings/advanced
```

左边 184px local nav；右侧 760–820px content。

Remote Nodes / Runtime Discovery 不属于 Settings 主内容，回到 Agent/Infrastructure。

Setting row：label + description 左，control 右；危险动作独立 Danger Zone。

---

# 12. Agent Center v1

Agent list 采用 entity row，不用大 Card 矩阵：

- Agent identity
- provider/kind
- runtime
- readiness
- model/mode summary
- last seen
- overflow

“发现 Agent”使用 guided discovery flow，不和常规 Agent list 混在一个信息密度层级。

---

# 13. 前端架构重构

## 13.1 Workspace CSS Ownership

从：

```text
workspace.module.css (78KB)
```

迁移为：

```text
workspace/styles/WorkspaceShell.module.css
components/session/SessionRail.module.css
components/conversation/Conversation.module.css
components/composer/Composer.module.css
components/inspector/Inspector.module.css
components/git/GitChanges.module.css
components/git/DiffViewer.module.css
components/activity/ActivityPanel.module.css
components/run/RunPanel.module.css
components/terminal/TerminalDock.module.css
```

所有 class local 化。只保留很少的 Monaco/xterm vendor bridge `:global()`。

## 13.2 State separation

`WorkspacePage` 不应继续同时拥有所有 query、URL state、layout state、terminal callbacks、git state。拆 hooks：

- `useWorkspaceSession()`
- `useWorkspaceRealtime()`
- `useWorkspaceGit()`
- `useWorkspaceLayout()`
- `useWorkspacePromptContext()`
- `useWorkspaceTerminal()`

UI components 只拿 view model / action contract。

---

# 14. QA / Visual Gate

## Viewport Matrix

- 1920×1080
- 1600×1000
- 1440×900
- 1280×800
- 1024×768
- 768×1024
- 390×844

Light + Dark。核心 Workspace 还需 expanded/collapsed panel matrix。

## Real Data Fixture

- 8 normal Projects + 20 TEST Projects
- 50 Sessions，其中 30 CLOSED、5 FAILED、2 WAITING_APPROVAL、2 RUNNING
- 超长中文/英文项目名
- 200 changed files，12 层目录
- 1 个 4MiB+ Diff
- untracked / renamed / deleted / binary
- Prompt 100 assets / 20 versions
- runtime disconnected / API error / empty / loading

## Geometry Gate

- 同一 grid row 边缘误差 ≤ 1px。
- 跨 section 主左基线误差 ≤ 2px。
- 不允许按钮文本 baseline 明显漂移。
- 不允许空态把核心 CTA 推出首屏。
- 不允许 data-rich desktop 页面出现 >180px 无信息空白块。

---

# 15. Performance Budgets

- Home LCP < 2.0s（本地正常设备）。
- Route switch content visible < 250ms（cache hit）。
- Workspace 50 Session + 200 changes 滚动保持 55–60fps 目标。
- Monaco 仅在 Diff/File editor 打开时 lazy load。
- Conversation 大于 500 timeline item 启用窗口化/分页。
- Git tree 大于 500 nodes 使用 tree virtualization 或 incremental render。

---

# 16. Release Truth Gate

发布前脚本必须检查：

```text
root package.json               1.0.0
apps/web/package.json           1.0.0
apps/server/package.json        1.0.0
packages/ui/package.json        1.0.0
App UI                          v1.0
README                          v1.0.0
CHANGELOG                       [1.0.0]
Docker image                    :1.0.0
release doc                     RELEASE-v1.0.0.md
```

并 grep：

```text
v0.6 / v0.7 / v0.8 / v0.9
```

允许出现在历史 release/changelog/audit，禁止出现在“当前版本”文案、测试 fixture 名、当前 UI class 名、package metadata。

---

# 17. 实施顺序

1. Baseline / screenshot / release truth inventory
2. Design token v1
3. Shared layout primitives v1
4. AppShell
5. Workspace shell + Session Rail
6. Conversation
7. Composer
8. Inspector + Git/Diff
9. Home
10. Projects
11. Prompt Library
12. Settings
13. Agents/Infrastructure
14. Responsive/Dark/A11y
15. Real Data/Performance
16. Visual freeze + Release Truth
17. v1.0 Release Candidate

每个阶段必须“实现 → 浏览器截图 → geometry/visual review → test → commit+push”，不能最后统一截图再返工。

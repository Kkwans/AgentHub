# AgentHub v0.7 Prototype → Production Route Map

> 盘点快照：`codex/v0.7-uiux`，工作区 `/volume2/Project/AgentHub`。本文件是本 Goal 的工作记录；没有修改生产代码、handoff package 或运行时状态。本次没有执行浏览器视觉门禁。

## 1. 证据、约定与判读方式

- Prototype 文件全集来自 `docs/AgentHub_v0.7_Design_Handoff_Package/08_prototype/`：12 个 HTML（含 3 个事务性 Dialog 独立页）、`styles.css`、`app.js`、`icons.svg`、README、Usage Contract、Refinement Log、Validation Report。
- Prototype contract 明确用途是 DOM/CSS/响应式/交互辅助，最新结构约束为 Prompt Library 两栏、Workspace 沉浸式三栏、Settings 局部导航 + 单内容列（`PROTOTYPE_USAGE_CONTRACT.md:15-41`）。Prototype 数据是静态示例，不能当作 API 字段或业务真值。
- 生产路由入口是 `apps/web/src/App.tsx:80-269`；所有 `api.*` 相对路径会由 `apps/web/src/lib/api.ts:233-303` 自动加 `/api/v1`。服务端挂载与前缀见 `apps/server/src/app.ts:107-219`。
- UI 页面集中在 `apps/web/src/features/v07/pages.tsx`；共享 App Shell 为 `apps/web/src/app/shell/AppShell.tsx`，Workspace 交互由 `features/workspace/components/WorkspaceSections.tsx` 与 `TerminalDock.tsx` 承担。
- 本报告的“Prototype-only/缺口”只在代码、类型、路由或 prototype 明文能查证时记录；没有凭空补造字段。

## 2. 快速索引

| Prototype surface | Production route（当前） | Production component | 主要状态/API域 |
|---|---|---|---|
| `index.html` Home | `/home` | `HomePageV07` | Dashboard、Project、Session、Execution Target |
| `projects.html` Projects | `/projects` | `ProjectsPageV07` | Project 列表、搜索、空/错/加载 |
| `project-overview.html` Project Overview | `/projects/:projectId/overview` | `ProjectContextLayoutV07` + `ProjectOverviewPageV07` | Project、Task、Session、Agent |
| `project-work.html` Project Work | `/projects/:projectId/work` | `ProjectContextLayoutV07` + `ProjectWorkPageV07` | Goal、Task、Worktree、Agent、Prompt |
| `project-sessions.html` Project Sessions | `/projects/:projectId/sessions` | `ProjectContextLayoutV07` + `ProjectSessionsPageV07` | Session、Agent |
| `agents.html` Agent Center | `/agents/agents`（`/agents` 重定向） | `AgentCenterPageV07` | Agent、Discovery Candidate |
| `agents.html#runtimes` Runtime | `/agents/runtimes` | `InfrastructurePageV07({kind:'runtimes'})` | Runtime Candidate、Execution Target lifecycle |
| `agents.html#nodes` Remote Nodes | `/agents/nodes` | `InfrastructurePageV07({kind:'nodes'})` | Remote Node；注册/详情为独立路由 |
| （prototype 无独立页）Diagnostics | `/agents/diagnostics` | `InfrastructurePageV07({kind:'diagnostics'})` | Host diagnostics |
| `create-project.html` Create Project | `/projects/new` | `CreateProjectPageV07`（背景为 Projects + `AhDialog`） | Target roots、preflight、创建 Project |
| `create-work.html` New Work | `/projects/:projectId/work/new` | `NewWorkPageV07`（背景为 Project Work + `AhDialog`） | Goal/Task 创建、可选 Agent/Prompt、启动 Session |
| `discover-agents.html` Discover Agents | `/agents/agents/discover` | `DiscoverAgentsPageV07`（背景为 Agent Center + `AhDialog`） | Agent rescan、candidate adopt |
| `prompts.html` Prompt Library | `/prompts`、`/prompts/:promptId`、`/projects/:projectId/prompts` | `PromptLibraryPageV07` | Prompt master/detail、六个 tab、版本/标签/绑定/Render |
| `settings.html` Settings | `/settings/:section`（`/settings` → appearance） | `SettingsPageV07` | Theme、Auth、Token、Capabilities |
| `workspace.html` Coding Workspace | `/workspace/:sessionId`（`/sessions/:id` 兼容重定向） | `WorkspacePageV07` + `WorkspaceSections` + `TerminalDock` | Session/Run/Message/Event/Approval/Files/Git/Prompt context |

## 3. 共享 Shell 与全局状态

### Prototype 结构

每个普通 HTML 都重复同一 Shell：236px Sidebar、主导航 Home/Projects/Agent Center/Prompt 库/Workspace、次导航 Runtime/Remote Nodes/监控中心/设置、用户卡片、顶部全局搜索、Light/Dark、通知、移动/桌面 Sidebar toggle（例如 `index.html:14-27`）。`workspace.html` 改用独立 `workspace-chrome`，不套普通 Shell。

`app.js:1-28` 仅处理 prototype 本地交互：theme/sidebar 状态写入 `localStorage`、overlay 开关、Prompt tab、Workspace Inspector tab、左/右栏折叠、左右拖拽宽度（左 210–380px、右 320–720px）、Esc 关闭移动 Sidebar。无 API 请求、无真实数据、无身份状态。

### Production 映射

- `AppShell` 作为 `App.tsx` 的父路由元素（`App.tsx:84-85`），导航实际为 `/home`、`/projects`、`/agents/agents`、`/prompts`、`/settings/appearance`（`app/shell/AppShell.tsx:32-45`）。Runtime/Nodes/Diagnostics 不占一级导航，依附 Agent 基础设施路由。
- Shell 状态：`realtime.onState` 连接状态（`AppShell.tsx:88-99`）、移动 Drawer、Command Palette（Ctrl/⌘K，`AppShell.tsx:101-134`）、theme 由 `@agenthub/ui` provider 管理；Command Palette 是导航/动作索引，不是 prototype 所示的全域实体搜索。
- 生产保留兼容重定向：`/overview`→`/home`、`/agents`→`/agents/agents`、`/promptos`→`/prompts`、`/remote-nodes`→`/agents/nodes`、`/settings`→`/settings/appearance`、`/tasks`/`/sessions` 按 `projectId` 转入 Project context（`App.tsx:63-78, 226-265`）。

### Prototype-only / 风险

- Prototype 的“监控中心”只是 `index.html#attention` 锚点；生产没有独立 monitor route，待处理卡片属于 Home Dashboard。
- Prototype 的通知数字、Profile/Admin 面板、全局实体搜索均为静态，没有对应生产 API/状态。
- Prototype Workspace 的三栏使用单独 chrome；生产 Workspace 仍包在 AppShell 内，但页面自身通过 `workspaceV07.module.css` 负边距沉浸显示（`WorkspacePageV07` / CSS:1-22）。需要在视觉回归中分别审查两种 Shell。

## 4. 逐页映射

### 4.1 Home (`index.html` → `/home`)

**Prototype DOM / 交互**

- Aurora Welcome Hero、`新建工作` CTA；四个静态 Metric（活跃项目、运行中的工作、可用 Agent、Prompt 模板）见 `index.html:29-37`。
- 最近项目四卡片（语言、branch、star、数量、更新时间）、“需要处理”与“最近工作”列表见 `index.html:39-68`；卡片/列表跳到静态 `project-overview.html`、`workspace.html`、`agents.html`、`project-work.html`。
- 同页隐藏 `new-work` overlay（任务描述、项目、推荐 Agent、快速意图、Advanced）见 `index.html:71-73`。

**Production**

- Route/component：`/home` → `HomePageV07`（`App.tsx:87-93`；`pages.tsx:132-170`）。
- Queries：`GET /dashboard`、`GET /projects`、`GET /sessions`、`GET /execution-targets`（`pages.tsx:133-141`）。
- 状态：任一 query loading/error 统一 `QueryMessage`；`attention = pendingApprovals + attentionTasks`，`running = dashboard.runningSessions`；Metric 实际为待处理、运行中、可用 Project、在线执行环境（`pages.tsx:144-165`）。空项目会给 `/projects/new`。
- CTA 进入真实 `/projects/:projectId/work/new`，不再在 Home 内创建静态 overlay（`pages.tsx:143`）。

**Prototype-only / API 缺口**

- `DashboardSnapshot` 只有 runningSessions/attentionTasks/pendingApprovals/recentResults/agentHealth（`api.ts:608-614`），没有 prototype 的 Prompt 模板计数、star、语言、更新时间或“本周趋势”；`ProjectRecord` 也只有 id/name/description/target/root/repo/status（`api.ts:476-485`）。这些静态字段不能直接复刻。
- Prototype Hero/aurora、Metric 卡的视觉关系可作为结构参考；数值、项目技术标签、分支等必须由真实 DTO 或隐藏，不可用 fixture 填充。

**Gate**：Prototype Validation 只把 Home 纳入 1536×1024/1024×900/390×844 结构检查（`VALIDATION_REPORT.md:13-24`）；handoff visual spec 目标 `/home`（`06_qa/playwright.visual.spec.ts:3-23`）；真实 E2E 覆盖登录后 Home 与跳转 Settings（`tests/e2e-real/v07-workbench.spec.ts:67-81`）。本次未重新执行真实 NAS Chromium 截图。

### 4.2 Projects (`projects.html` → `/projects`)

**Prototype DOM / 交互**

- 标题、`新建项目`、搜索、状态/语言/更新时间筛选、Grid/List 切换（`projects.html:29-30`）；项目使用独立 rounded entity rows、pagination、每行更多菜单（`projects.html:31-44`）。
- `create-project` overlay 同时内嵌于页面（`projects.html:45`）。

**Production**

- `/projects` → `ProjectsPageV07`（`App.tsx:96-101`；`pages.tsx:172-183`）。
- `GET /projects`；查询返回后仅在客户端按 `name + rootPath` 过滤（`pages.tsx:173-181`）。
- 状态覆盖 loading/error/retry、无匹配/无项目 empty；每行进入 Overview 或 Work。

**Prototype-only / API 缺口**

- `ProjectRecord` 无语言、branch、star、更新时间、团队标签；生产没有服务端状态/语言/排序、分页或 Grid/List state，prototype toolbar 不能照搬为“已实现功能”。
- Prototype 行内更多菜单没有生产 mutation 对应；项目更新/归档虽有服务端 `PATCH /projects/:id`、`POST /projects/:id/archive`（`project-routes.ts:125-158`），当前 v07 页面没有接线。

**Gate**：Prototype Validation 未列 Projects；handoff visual spec 有 `/projects` 四 viewport、两 theme；real-deployment visual 动态路由包含 `/projects`；real E2E 通过 `/projects/new` 间接进入 Project context，但没有独立 Projects screenshot 断言（`v07-workbench.spec.ts:86-105`）。

### 4.3 Create Project (`create-project.html` → `/projects/new`)

**Prototype DOM / 交互**

- Step 1 路径浏览、发现仓库 chips；Step 2 项目识别卡与 preflight badges；名称输入、Advanced（运行环境/Worktree/手动路径覆盖），见 `create-project.html:45`。

**Production**

- `/projects/new` → `CreateProjectPageV07`，背景渲染 `ProjectsPageV07`，自身为全屏/响应式 `AhDialog`（`App.tsx:103-109`; `pages.tsx:185-237`）。
- Queries：`GET /execution-targets`；选中 target 后 `GET /execution-targets/:id/filesystem/roots`；选择 target/root 后 `POST /projects/preflight`。创建为 `POST /projects` body `{name, description?, targetId, rootPath}`（`pages.tsx:194-210`）。服务端 schema 与挂载见 `project-routes.ts:8-18,42-67`、`filesystem-routes.ts:14-27`。
- 状态：自动选择首个 target/root；preflight `READY/BROKEN` checks；create loading/error；只有 READY 才能提交；路径来自授权 roots，说明明确禁止越权手填。

**Prototype-only / API 缺口**

- Prototype 的“浏览…”、repo chips、识别到的 TypeScript/pnpm/AGENTS.md、`Git repository/main/可读写/Runtime mapping` 不是当前 Create Project API 返回的同一 DTO；生产只显示 target/root、名称/说明与 preflight checks。仓库识别结果若要展示需先扩展合同，不得从静态 HTML 推断。
- Prototype 页面可从 Projects overlay 打开；生产正式 URL 是 `/projects/new`，关闭回 `/projects`。

**Gate**：真实 E2E 已验证真实 target/root/preflight/create 并进入 `/projects/:id/overview`（`v07-workbench.spec.ts:86-105`）；视觉仍需按四 viewport、Light/Dark 在真实部署重拍。

### 4.4 Project context + Project Overview (`project-overview.html` → `/projects/:projectId/overview`)

**Prototype DOM / 交互**

- Project breadcrumb、身份 Logo/状态/描述、进入 Workspace、新建工作；Context tabs：概览、工作、会话、Prompt、设置（`project-overview.html:28-41`）。
- Overview 为“正在进行” Work + progress、项目健康（Git/Agent/Runtime）、最近会话、有效 Prompt 四块（`project-overview.html:43-48`）。

**Production**

- 父 route `/projects/:projectId` → `ProjectContextLayoutV07`；它先 `GET /projects/:projectId`，再渲染 `AhProjectContext` 与 Outlet tabs（`App.tsx:111-168`; `pages.tsx:240-249`）。当前 tabs 路径为 `overview`, `work`, `sessions`, `prompts`, `settings`。
- `/overview` child → `ProjectOverviewPageV07`（`App.tsx:120-126`; `pages.tsx:251-257`）。Queries：`GET /tasks?projectId=…`、`GET /sessions?projectId=…`、`GET /agents`；Metric 为未完成 Work、Sessions、READY Agent、Git/目录；列表链接 Work/Workspace。
- 页面以真实 `TaskRecord`、`SessionRecord`、`AgentRecord` 驱动；空任务/空 Session 使用 AhEmptyState，列表只取前四项。

**Prototype-only / API 缺口**

- Prototype 的项目健康三行（Git clean、4 Ready/1 auth、Runtime healthy）没有 Overview 专用 query；虽有 Git/Agent/Runtime API，当前组件没有读取 Git status、candidate/runtime summary 或 Prompt bindings，因此不能宣称同等信息。
- Prototype 的“有效 Prompt”卡来自静态 production/latest 版本；生产 Prompt 关系应通过 `/projects/:id/prompts` 或 Prompt binding query 进入，不在 Overview 直接伪造。
- Context tab 文案从 prototype 的“Prompt/设置”映射到生产的 “Prompts/设置”；这是同一语义但路径不同。

**Gate**：real-deployment visual 动态加入首个 Project 的 `/overview`；real E2E 断言创建后 heading 与项目上下文导航（`v07-workbench.spec.ts:102-105`），尚未对静态 Prototype 的健康/Prompt 卡做等价断言。

### 4.5 Project Work (`project-work.html` → `/projects/:projectId/work`)

**Prototype DOM / 交互**

- Work toolbar：List/Board、搜索、状态/Agent 筛选、新建工作；左侧工作表显示优先级/Agent/状态/更新时间，右侧 Inspector 显示验收标准、运行进度、最新变更与停止/打开 Workspace（`project-work.html:43-55`）。

**Production**

- `/work` child → `ProjectWorkPageV07`（`App.tsx:128-134`; `pages.tsx:259-281`）。
- Queries：`GET /tasks?projectId`、`GET /goals?projectId`、`GET /worktree-executions?projectId`、`GET /agents`、`GET /prompts?projectId`。
- Mutations：`POST /tasks/:id/transition`；如选 Agent，`POST /tasks/:id/start`（BACKLOG 会先 transition READY），成功后进入 `/workspace/:sessionId`。服务端还提供 worktree queue/rework/merge/cancel（`worktree-routes.ts:37-147`），但本页面没有接线。
- 状态：`?task=` 选择项、`?agentId`/`?promptId` 只用于 Inspector 显示；加载/错误；无任务 empty；选中 Task 后显示状态、描述、Agent、Prompt、branch、Session、Worktree。

**Prototype-only / API 缺口**

- Prototype 的搜索、状态/Agent筛选、Board 真正切换、列式优先级/更新时间、验收标准 checklist、progress、变更行数、Stop/Review/Merge CTA 都不是当前页面实现。当前“切换 Board”只是链接到 `?view=board`，组件未读取 `view`（`pages.tsx:263-280`）。
- `TaskRecord` 确有 `acceptanceCriteria`, `priority`, `assignedAgentId`, `sessionId` 等字段（`api.ts:539-557`），但生产 Inspector 只展示 description/priority（列表）和 branch/session/worktree 状态，未呈现 acceptance criteria 或 Worktree review evidence。

**Gate**：real E2E 用真实 Task/Session 验证 Work heading、选中 Task、Sessions 与 Workspace（`v07-workbench.spec.ts:107-145`）；prototype visual/real-deploy 路由应覆盖有数据的 `/work` 与 `/work/new`，本次未执行。

### 4.6 New Work (`create-work.html` → `/projects/:projectId/work/new`)

**Prototype DOM / 交互**

- Home 风格背景 + `new-work` Dialog：自然语言任务描述、项目、推荐 Agent、四个快速意图、Advanced（Model/Mode/Reasoning/Worktree/Prompt），见 `create-work.html:28-71`（该页是 Home + overlay 的静态演示）。

**Production**

- `/work/new` child → `NewWorkPageV07`，背景 `ProjectWorkPageV07` + 响应式 `AhDialog`（`App.tsx:136-142`; `pages.tsx:283-352`）。
- Queries：`GET /goals?projectId`、`GET /agents`、`GET /prompts?projectId`。
- Goal 分支：`POST /goals`；Task 分支：`POST /tasks`，可选先 `POST /tasks/:id/transition` READY，再 `POST /tasks/:id/start` `{agentId}`，成功进入 Workspace；无 Agent 则回 Work 列表并保留 task query。
- 本地 state：title、description、intent、kind=`goal|task`、goalId、agentId、promptId、advancedOpen；Agent 默认取首个 READY，Prompt/Goal 只在 Advanced 展开。

**Prototype-only / API 缺口**

- Prototype 的“选择项目”在全局/跨项目 New Work 中可变；生产 route 已固定 `projectId`，项目身份显示为只读上下文。
- Prototype 宣称可在 Advanced 设置 Model/Mode/Reasoning/Worktree；生产 Task start UI 没有这些控件，也未把 `taskStart` schema 可选的 `model`/`mode`/`promptVariables` 传出（`task-routes.ts:68-73`）。Worktree 需走独立 worktree API，当前 Dialog 未接线。
- Prototype 的快速意图只改变视觉选中；生产 `intent` 只在本地 state 中存在，不写入 Goal/Task 字段。

**Gate**：真实 E2E 覆盖通过 Work/Session/Workspace 的真实后端链路，未单独断言 New Work 每个 Advanced state；real-deployment visual 会加入 `/projects/:id/work/new`。

### 4.7 Project Sessions (`project-sessions.html` → `/projects/:projectId/sessions`)

**Prototype DOM / 交互**

- 搜索、Agent/状态筛选、新建会话；按“今天/更早”分组的 Session rows，显示 Agent、模型、摘要、状态、更新时间（`project-sessions.html:28-44`）。

**Production**

- `/sessions` child → `ProjectSessionsPageV07`（`App.tsx:144-150`; `pages.tsx:355-367`）。
- Queries：`GET /sessions?projectId`、`GET /agents`；新建 Dialog `POST /sessions` `{projectId, agentId, title, cwd: project.rootPath}`（server schema 见 `session-routes.ts:9-20,42-63`）。
- 状态：loading/error/retry、空 Session、newOpen/title/agentId；行进入 `/workspace/:id`。

**Prototype-only / API 缺口**

- 当前页面没有搜索、Agent/状态筛选、日期分组、分页；这些是 prototype-only 结构。
- `SessionRecord` 具备 branch/model/mode/lastActiveAt（`api.ts:487-499`），但新建 Dialog 只收标题和 Agent，未提供 prototype 中显示的模型/摘要编辑。

**Gate**：real E2E 断言真实 Sessions 列表与 Session 链接（`v07-workbench.spec.ts:135-145`）；real-deployment visual 动态加入首个 Project Sessions。

### 4.8 Agent Center (`agents.html` → `/agents/agents`)

**Prototype DOM / 交互**

- Agent Header、搜索/类型/状态筛选、Grid/List、四个 tabs（全部/已接入/可发现/自定义）、四张品牌卡（provider、描述、能力、状态、CTA）见 `agents.html:28-31`。
- 同一页面继续放“运行概览”五个 summary metrics 与 Runtime/Remote Node 两块（`agents.html:32-33`）；Discover overlay 在 `agents.html:34`。

**Production**

- `/agents/agents` → `AgentCenterPageV07`（`App.tsx:171-177`; `pages.tsx:369-391`）。
- Queries：`GET /agents`、`GET /discovery/agents`；候选接入 `POST /discovery/agents/:candidateId/adopt`。
- 本地搜索按 name/agentKind/version；筛选只有 all/ready/attention；已接入 cards 与候选列表分开。能力标签从 `capabilitiesJson` 映射为最多四个语义标签，adapter/executable/container 只在 Diagnostics 约束下展开。
- Agent DTO 为 id/target/name/kind/adapter/status/enabled/version/defaults/capabilities/preflight（`api.ts:461-474`）；服务端 routes 还提供 `/agents/catalog`、`/:id/preflight`、`PATCH /agents/:id`（`agent-routes.ts:29-93`），未在该页直接使用。

**Prototype-only / API 缺口**

- Prototype 的 OpenAI/Anthropic/OpenCode/Custom provider 文案、品牌图标、静态 capability 描述和四 tab 计数没有对应统一字段；生产按 AgentRecord 与 capability JSON 语义化展示。
- Prototype 的 Runtime summary、在线调用数/成功率/平均响应不是当前 Agent/Discovery DTO；已拆到 `/agents/runtimes` 和 Diagnostics。

**Gate**：handoff visual spec 直接覆盖 `/agents`（重定向到 `/agents/agents`）四 viewport/两 theme；real-deployment visual 使用 `/agents/agents`；real E2E 当前未走 Agent Center 页面（只通过 API seed Agent）。

### 4.9 Discover Agents (`discover-agents.html` → `/agents/agents/discover`)

**Prototype DOM / 交互**

- 双栏 Dialog：左侧扫描雷达/68% progress/4 source/12 candidate/3 direct/1 auth；右侧本地、远程节点、NAS Docker source rows 与 candidate add/request authorization；底部查看日志/一键添加/取消（`discover-agents.html:34`）。

**Production**

- `/agents/agents/discover` → `DiscoverAgentsPageV07`，背景 Agent Center + `AhDialog`（`App.tsx:178-184`; `pages.tsx:393-435`）。
- Queries/mutations：`GET /discovery/agents`、`POST /discovery/agents/rescan`、`POST /discovery/agents/:candidateId/adopt`（server `discovery-routes.ts:16-43`）。
- Source counts 由 candidate `targetCandidateId` 前缀 host/local/remote/docker 计算；candidate state READY/AUTH_REQUIRED/STOPPED/MISSING_DEPENDENCY/… 决定添加、授权、Runtime/Diagnostics CTA；loading/error/empty/retry 均有。

**Prototype-only / API 缺口**

- API 没有扫描百分比、扫描日志 endpoint、bulk adopt；`一键添加可用 Agent (3)` 与静态 4/12/3/1 只能作为视觉意图。
- `AgentCandidateRecord` 虽包含 `adapterKind`、reasonCode，但普通流程按产品边界隐藏原始 adapter/container/executable；不要把 prototype 的 IP/container 文案直出。

**Gate**：real-deployment visual routes `/agents/agents/discover`；当前没有 real E2E 页面断言 discovery Dialog。Prototype Validation 未覆盖该 Dialog。

### 4.10 Runtime (`agents.html#runtimes` → `/agents/runtimes`)

**Prototype DOM / 交互**

- Agent 页面 Runtime summary 与“运行环境”列表展示 NAS-Container/Localhost、健康状态、Agent 数量、未识别容器折叠；次导航使用 `agents.html#runtimes`（`agents.html:16,32-33`）。

**Production**

- `/agents/runtimes` → `InfrastructurePageV07({kind:'runtimes'})`（`App.tsx:186-192`; `pages.tsx:437-448`）。
- Queries/mutations：`GET /discovery/runtimes`、`POST /discovery/runtimes/rescan`、`POST /discovery/runtimes/:candidateId/adopt`、已接入 Docker 的 `POST /execution-targets/:id/start|stop`（`discovery-routes.ts:45-71`; `execution-target-routes.ts:36-85`）。
- Candidate state READY/STOPPED/UNAVAILABLE/UNSUPPORTED/BROKEN；按 adopt/start/stop 显示 action；loading/error/empty。

**Prototype-only / API 缺口**

- 没有 Runtime summary metrics API；Prototype 的“4 Agent/2 Agent、healthy、未识别容器 67”均为静态。
- Prototype inline infra card 的 `Docker · Linux arm64` 等详情可由 RuntimeCandidate/ExecutionTarget 部分组成，但必须使用 DTO 当前值，不可固定 NAS/Localhost。

**Gate**：real-deployment visual route `/agents/runtimes`；handoff visual spec 只间接拍 `/agents`，不是独立 Runtime route；当前无页面 real E2E。

### 4.11 Remote Nodes (`agents.html#nodes` → `/agents/nodes` + register/detail)

**Prototype DOM / 交互**

- Agent 页面 Remote Node 两行静态列表（Tokyo-Mac、NAS-Build）、online/目录、`添加节点` button，使用 `agents.html#nodes` anchor（`agents.html:16,33`）。没有注册码/详情/撤销流程。

**Production**

- `/agents/nodes` → `InfrastructurePageV07({kind:'nodes'})`（`App.tsx:194-200`; `pages.tsx:437-448`），`GET /remote-nodes`。
- `/agents/nodes/register` → `RemoteNodeRegistrationPageV07`（`App.tsx:202-208`; `pages.tsx:450-472`）：本地 state name、expiresInMinutes、roots；`POST /remote-nodes/registration-tokens`，token 只显示一次，支持复制。服务端 schema/route：`remote-node-routes.ts:8-37`。
- `/agents/nodes/:nodeId` → `RemoteNodeDetailPageV07`（`App.tsx:210-216`; `pages.tsx:474-484`）：`GET /remote-nodes/:id/diagnostics`、`POST /remote-nodes/:id/revoke`，确认 Dialog；状态、protocol/daemon、allowed roots、inventory、fingerprint progressive disclosure。DTO 见 `api.ts:410-450`。

**Prototype-only / API 缺口**

- Prototype 的静态节点名称、OS/path/online 仅为视觉样例；真实列表需使用 RemoteNodeRecord。
- 注册、fingerprint、inventory、revoke、一次性 token 都是生产新增的一等流程，Prototype 未表达，不得以“prototype 缺页”判定后端缺失。

**Gate**：real-deployment visual routes `/agents/nodes`, `/agents/nodes/register` 与首个节点 detail 不是动态发现（脚本只固定 register，不固定 node id）；`tests/e2e-real/remote-node.live.test.ts` 是 API/live 层，不等于页面视觉门禁。本次未执行。

### 4.12 Diagnostics（prototype 无独立页 → `/agents/diagnostics`）

**Prototype 状态**

Prototype 只有 Runtime 区域的“其他未识别容器 · 67 / 仅诊断时展开”折叠行（`agents.html:33`），没有 host diagnostics、结论/原始详情或错误态页面。

**Production**

- `/agents/diagnostics` → `InfrastructurePageV07({kind:'diagnostics'})`（`App.tsx:218-224`; `pages.tsx:437-448`）。
- `GET /agents/diagnostics/host`（`agent-routes.ts:44-50`）；先显示面向用户的 `message` 结论，再 `<details>` 展开 JSON；支持 loading/error/retry/刷新。
- Settings System 分区也链接到 Diagnostics（`pages.tsx:545-554`）。

**风险**：这是 production-only surface；不能从 prototype 的折叠行推断诊断字段。普通 UI 隐藏 raw enum/UUID/container/executable，原始细节只应留在此 progressive disclosure。

### 4.13 Prompt Library (`prompts.html` → global/project routes)

**Prototype DOM / 交互**

- 最终结构是两栏：左目录搜索、kind filter、Prompt rows；右主区标题/production/v8、操作、六个 tabs（`prompts.html:16-35`）。
- 六个 tabs 与内容：`内容`、`变量`、`Playground`、`版本`、`标签`、`绑定`（`prompts.html:33-42`）。内容为 prose/变量标记；变量是结构化表；Playground 为表单 + 预览；版本可比较；标签可移动；绑定展示 Project/Agent/Action。

**Production**

- Global `/prompts` 与 `/prompts/:promptId`（`App.tsx:231-245`）；Project context `/projects/:projectId/prompts`（`App.tsx:152-158`）均渲染 `PromptLibraryPageV07`（`pages.tsx:486-543`）。
- Queries：
  - `GET /prompts` 或 `GET /prompts?projectId=…`；并行 `GET /projects`、`GET /agents`、`GET /tasks`。
  - 选中 Prompt 后 `GET /prompts/:id/versions`、`GET /prompts/:id/labels`、`GET /prompt-bindings?promptId=…`。
- Mutations：`POST /prompts`；`POST /prompts/:id/versions`；`PUT /prompts/:id/labels/:label`；`POST /prompt-bindings`；`PATCH /prompt-bindings/:id`；`POST /prompts/:id/render`（server routes `prompt-routes.ts:111-377`）。
- 生产 tab key/label 为 `content/Content`、`variables/Variables`、`versions/Versions`、`labels/Labels`、`bindings/Bindings`、`playground/Playground`；本地 state `selectedId`、`tab`、`search`、四种 Dialog 开关与 JSON draft（`pages.tsx:493-540`）。

**Prototype-only / API 缺口**

- Prototype 的“导入模板”、版本比较按钮、结构化变量 schema（project.name/task.title/diff.summary）没有当前页面 mutation/schema；生产变量编辑为 JSON 文本，Render 才验证。
- Prototype 绑定文案出现 Workspace/Review Action；服务端 binding target 仅 `PROJECT|AGENT|TASK`、slot `SYSTEM|TASK_PRIMER|REVIEW|COMMIT|RULES`（`prompt-routes.ts:12-16,62-88`），生产按真实 target 显示。
- 服务端已有 `/prompts/:id/versions/:version`、`/prompts/:id/diff`、Prompt update/archive、Skills 族路由（`prompt-routes.ts:133-177,209-238,380-432`），当前 v07 Prompt 页面没有接入；不要把 Prototype “比较版本”当成已实现。

**Gate**：Prototype Validation 显式检查 `prompt_two_panes`、tab switching，并保存 light/dark 1536 screenshots（`VALIDATION_REPORT.md:5-24`）；handoff visual spec 没有独立 Prompt target，但 Visual UX Gate 要求 Prompt 两栏（`VISUAL_UX_GATE.md:35-44`）；real-deployment visual 包含 global `/prompts` 与 project `/prompts`；当前无真实页面 E2E。

### 4.14 Settings (`settings.html` → `/settings/:section`)

**Prototype DOM / 交互**

- 最终 Settings 是窄局部导航 + 单内容列；HTML 将外观、账户、安全、集成、系统五段纵向全部展示，含主题卡、侧边栏/密度/减少动态开关、管理员/会话、Terminal/API Token、Provider/GitHub、数据目录/备份/危险操作（`settings.html:16-21`）。

**Production**

- `/settings`→`/settings/appearance`；`/settings/:section`→`SettingsPageV07`（`App.tsx:254-262`; `pages.tsx:545-554`）。Nav values `appearance/account/security/integrations/system`；每次只渲染一个 section。
- Queries：`GET /auth/status`、`GET /settings/capabilities`；认证/可信模式后 `GET /auth/tokens`。服务端能力 route 在 `app.ts:153-170`，token route 在 `auth-routes.ts:60-106`。
- State：theme preference 来自 `useAgentHubTheme`；pathname 最后一段决定 section；Appearance 使用 `AhThemeSelect`；Account 只读身份/信任模式；Security 列 token；Integrations 链接 Runtime；System 显示 Terminal capability 并链接 Diagnostics。

**Prototype-only / API 缺口**

- Prototype 的侧边栏记忆、密度、减少动画、编辑资料、会话管理、Terminal 开关、Provider/GitHub、数据目录、备份、重置均无当前 SettingsPageV07 mutation/API；不能按 prototype 静态按钮宣称可用。
- 生产 `/projects/:projectId/settings` 也指向同一个 `SettingsPageV07`（`App.tsx:160-166`），但组件按 pathname 最后一段解析，`segment === 'settings'` 会落入 System 分支，且导航跳到全局 `/settings/*`。这条 Project Context “设置”是现有 route 但语义/实现尚未闭合的风险。
- `settings.html` 的“所有 sections 同屏”与 `PROTOTYPE_USAGE_CONTRACT.md` 的“局部导航 + 单列内容”存在结构表述差异；以后以最新 contract/production route 的单 section 行为为准。

**Gate**：Prototype Validation 保存 Settings Light/Dark 1536 screenshots；handoff visual spec targets Settings via visual gate prose但 `playwright.visual.spec.ts` 仅列 Home/Projects/Agents；real-deployment visual 固定五个 `/settings/*` routes；real E2E 只断言 token 登录后 appearance 与导航（`v07-workbench.spec.ts:67-81`）。

### 4.15 Coding Workspace (`workspace.html` → `/workspace/:sessionId`)

**Prototype DOM / 交互**

- 独立 chrome + 3-pane：Session Rail（搜索/分组/状态）、Conversation（消息、compact plan、tool summary）、Inspector（Changes/Files/Tools tabs、diff、review actions）、底部 Composer（Agent、权限、模型、推理强度、发送），见 `workspace.html:1-21`。
- `app.js:18-27` 提供 Inspector tab、左右栏折叠、左右拖拽宽度与 localStorage 持久化；左 210–380px，右 320–720px。

**Production**

- `/workspace/:sessionId` → `WorkspacePageV07`（`App.tsx:247-252`; `pages.tsx:556-660`）；`/sessions/:id` 兼容重定向到 Workspace（`App.tsx:227-229`）。Workspace CSS 使用 `Group/Panel/Separator`，三栏默认 18%/49%/33%，可折叠/移动 Inspector tab（`pages.tsx:626-658`、`workspaceV07.module.css:1-86`）。
- Queries（`pages.tsx:567-589`）：`GET /sessions`、`GET /sessions/:id`、`GET /sessions/:id/configuration`、`GET /sessions/:id/messages`、`GET /sessions/:id/runs`、`GET /approvals?sessionId=…`、`GET /sessions/:id/events?afterSeq=0&limit=500`、`GET /agents`、`GET /projects`、`GET /settings/capabilities`、`POST /prompt-context/resolve`。
- Realtime：订阅 `session:${sessionId}`，刷新 Session/config/messages/runs/approvals/events（`pages.tsx:597-608`）。
- `WorkspaceSections`：
  - Conversation 处理 Message、tool/plan Event、Approval resolve `POST /approvals/:id/resolve`（`WorkspaceSections.tsx:109-144`）。
  - Inspector tabs 是 `files/diff/git/run`；Files 用 `GET /projects/:id/files` + `/files/content`，Diff 用 `/git/diff`；Git 用 status/diff/commits/branches/commit；Run 显示 Agent/model/mode/run history（`WorkspaceSections.tsx:533-731,987-1033`）。
  - Composer 发送 Run `POST /sessions/:id/runs`、取消 `POST /sessions/:id/runs/:runId/cancel`、动态更新 model/mode/reasoning `POST /sessions/:id/configuration`，PromptOS context/variables 状态与 slash commands（`WorkspaceSections.tsx:1033-1505`）。
  - TerminalDock 在 capability 可用时调用 `POST /terminals`、`/terminals/:id/input`、`/resize`、`/close`，并订阅 terminal topic（`TerminalDock.tsx:80-169`）。
- 状态：Session loading/error/not-found；`view=files|diff|git|run` 与 `file=` query 可恢复；active Run 状态 STARTING/RUNNING/WAITING_APPROVAL/CANCELING；DISCONNECTED/CLOSED 等 copy 与恢复入口；Prompt context missing/error/empty/ready；Terminal unavailable/open/exited/error。

**Prototype-only / API 缺口**

- Prototype Inspector 的 Changes 与 Tools 是静态 tab；生产替换为 Diff/Git/Run，tool events 在 Conversation 卡片中，Git commit 在 Git Inspector。没有 prototype 静态“批准并合并/请求修改”按钮；Approval 与 Task review 是另一层真实 API/流程。
- Prototype Composer 的“完全访问”权限按钮没有对应 Workspace UI；生产权限由 Agent Approval event/options 驱动，model/mode/reasoning 由 Session configuration capability 驱动。
- Prototype 是无 `sessionId` 的固定内容；生产必须依赖真实 Session/Run/Message/Event，不能以空 Session 推断断线恢复能力。

**Gate**：Prototype Validation 检查三栏、Composer、Inspector tabs、resize 与 1536/1024/390 overflow；Visual UX Gate 要求 Workspace 最好覆盖 8 个 theme×viewport 组合并禁止 Composer 不可见、Inspector 空白、不可 resize（`VISUAL_UX_GATE.md:6-10,35-44`）；real E2E 当前在 1440 项目上验证 Workspace、Approval、Diff、Git commit（`v07-workbench.spec.ts:141-193`）；本次未执行 real-deployment 视觉截图。

## 5. 视觉 / 交互门禁总表

| Gate | 事实范围 | 当前证据与限制 |
|---|---|---|
| Prototype structural | `VALIDATION_REPORT.md` | 只检查 Home、Prompt、Settings、Workspace；1536×1024、1024×900、390×844；含 tab/sidebar/resize/overflow；无真实 API。报告 checklist 的 `settings_two_panes` 与最终 contract 单内容列命名不一致，需按 contract 复核。 |
| Handoff screenshot spec | `06_qa/playwright.visual.spec.ts` | 代码只列 `/home`、`/projects`、`/agents`，Light/Dark × 1440/1024/768/390；它是 snapshot spec，不等于当前 NAS 实际部署结果。 |
| Visual UX contract | `06_qa/VISUAL_UX_GATE.md` | 规定 Light 四 viewport、Dark 1440/390、Workspace 理想 8 组合、尺寸容差、WCAG/UX 及结构 blocker（Prompt 两栏、Workspace Composer/resize/Inspector、Settings 非三栏）。 |
| Real deployment visual | `scripts/qa/real-deployment-visual.cjs:32-37,152-195,256-300` | 使用 browser token、动态首个 Project/Session，静态基础 routes 15 + project routes 6 + workspace；两 theme × 1440/1024/768/390；采集 screenshot、console/page/request、overflow、unnamed buttons、hidden focus。没有视觉相似度评分。当前没有重新运行。 |
| Real product E2E | `tests/e2e-real/v07-workbench.spec.ts` | 真实 backend 覆盖 auth/Home/Settings、Create Project/preflight、Project Work/Sessions/Workspace、Approval/Diff/Git commit；单 desktop viewport，未覆盖 Agent Center、Runtime、Nodes、Diagnostics、Prompt、Project Prompt/Settings。 |
| Mock/legacy E2E | `tests/e2e/web-shell.spec.ts` | 走 fixture API 与旧 `/overview`、`/tasks`、`/settings` 兼容路径；可作为回归线索，不能替代 v07 真实部署视觉验收。 |

本次盘点结论：Prototype 结构已能逐面映射到现有 v07 路由，生产 API/状态多数已经存在；主要差异集中在 prototype 静态 metadata、筛选/分页/Board、Runtime summary、Dialog Advanced 字段、Settings 未接线操作、Workspace Inspector tab 命名，以及 Project Settings route 语义未闭合。上述差异应作为实现/视觉验收的明确决策点，不应通过 fixture 或硬编码填平。

## 6. 未决风险（交给主代理）

1. **Project Settings route**：`/projects/:projectId/settings` 当前复用全局 `SettingsPageV07`，`segment=settings` 会落到 System 分支；需要决定是移除 Project Context tab、实现 Project-specific settings，还是显式重定向到全局 Settings。
2. **Project Work Board/筛选**：Prototype 有 List/Board、搜索、状态/Agent filters；当前组件只实现 list + `?view=board` 链接，需决定 v0.7 是否补齐，或在视觉交付中明确降级为 list-only。
3. **Workspace Inspector 语义**：Prototype Changes/Files/Tools 与生产 Files/Diff/Git/Run 不同；需由产品/视觉验收确认是否保持真实能力优先，还是新增 Changes/Tools 聚合层（不能把 static tab 当作 API 已有能力）。
4. **Settings controls**：Prototype 的 density/reduced-motion/provider/GitHub/backup/danger 等没有现有 API；若要复刻必须先定义公共契约，当前应保持 production-only truthful controls。
5. **Visual evidence freshness**：历史 handoff/rollout 声称过视觉审计，但本次没有复跑 NAS-local Chromium；在实现完成前必须按真实部署脚本重拍四 viewport、Light/Dark，并补齐未覆盖 routes/状态。

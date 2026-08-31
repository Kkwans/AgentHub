# AgentHub v1.0.0 Production Quality Release 执行计划

## 1. 结论与已锁定决策

- 当前真实基线：`main` 与 `origin/main` 均为 `d09c575e2aaad749a8f0c822d89b3531d8634337`；现有未跟踪 v0.7/v0.8/v0.9 文档均视为用户文件，不纳入、不覆盖。
- 完整 `docs/AgentHub_v1.0_Production_Quality_Package/` 先作为独立规格基线提交并 push。
- 当前版本真值不一致：workspace packages/health 为 `0.6.0`，AppShell 显示 `v0.9`，运行镜像为 `agenthub:0.8.0-nas.d09c575`。最终必须统一为 `1.0.0`，且不得提前把未通过 RC 的代码宣称为正式版。
- Workspace ≥1180px 首次进入时 Inspector 默认展开 440px；之后恢复用户保存的折叠状态与宽度。`<900px` 使用 drawer。
- RC Gate 通过后自动部署生产；生产验收只读，不创建 Project、Session、Prompt、Run 或 Git 变更。
- 完整写流程在同一候选镜像的临时 PGlite、临时 Git 仓库中验证。
- 最终视觉评分由执行代理按固定量表完成；核心页面必须 ≥9/10，不等待人工签字。
- 不创建 `/v1`、`*V1Page`、`workspace-v1` 等临时并行页面；所有页面在现有正式路由和领域模块内原位迁移。

## 2. 不得改变的现有能力与接口

- 保持 `/api/v1`、`/ws`、认证 Cookie/API token、权限校验与凭据引用策略。
- 保持 Project `STANDARD | TEST`、路径 containment、symlink escape 防护及 Remote Node 边界。
- 保持 Session 创建、配置、resume/close、continuation、Run、cancel、模型/模式/reasoning、slash command 和 Prompt binding 失败阻断语义。
- 保持审批请求的展示、accept/reject、delivery state、重连恢复和错误诊断。
- 保持 Terminal PTY 的 open/input/resize/close、WebSocket 实时流和断线状态。
- 保持 Git status、M/A/D/R/U/conflict、staged/unstaged、whitespace 模式、selected-files commit、history、branches、路径安全及 4MiB 截断保护。
- 保持 Prompt 版本、label、binding、render、变量校验和历史生命周期。
- 保持 Work/Task/Worktree 的 review、rework、merge、cancel 及现有 Agent/Runtime/Remote Node 能力。
- 保留一版兼容跳转：`/sessions/:id`、`/sessions`、`/promptos`、`/settings/runtime`、`/remote-nodes`；只做 redirect，不保留第二套 UI。
- 不修改 Agent Compose 结构、Docker socket、Codex 凭据挂载或数据卷语义；不执行数据重置。
- 数据库只允许向后兼容的查询/API扩展，不做破坏性 schema migration；旧 UI 镜像必须仍可读取升级后的数据。

## 3. 公共契约变更

- 复用并收紧 `@agenthub/ui` 已有 `PageFrame`、`ScreenHeader`、`ContextHeader`、`EntityList`、`EntityRow`、`InspectorPanel`、`SettingsLayout`；仅新增缺失的 `Toolbar`、`LocalNav`、`SettingRow`。
- 设计系统公开尺寸：
  - spacing：4/8/12/16/20/24/28/32px；
  - control：28/32/36/40px；
  - entity row：Compact 48–56px、Comfortable 60–68px；
  - radius：control 8px、surface 12px、overlay 14px；
  - body 14/20px、label 12.5/16px、meta 12/16px、section title 16/24px、page title 20/28px；
  - focus ring 2px；正文和交互文字对比度 ≥4.5:1。
- 密度默认 `comfortable`，可切换 `compact`；使用 localStorage 保存，不新增数据库字段。
- `GET /api/v1/sessions/:id/messages` 增加可选 `beforeSequence` 与 `limit=1..200`：
  - 不带参数时保持当前完整数组响应；
  - 带参数时按 sequence 升序返回窗口，`beforeSequence` 为排他上界；
  - 客户端按最早 sequence 和返回数量判断是否继续加载；
  - WebSocket 新消息仍按 sequence 去重、排序和增量合并。
- Git REST 路径和现有响应字段保持不变；语言识别、连续 Diff、binary/large-diff 呈现优先在客户端基于现有 patch/path/truncated 数据完成。
- Workspace URL 使用 `changes/files/activity/run`；旧 `view=tools` 映射到 `activity`，不会失效。
- 版本展示不得硬编码：package、CLI、Node、health、Web build、OCI labels、Compose 示例均由同一 release version 检查脚本核对。

## 4. 通用切片门禁

每个阶段都必须按以下顺序完成，失败即停止，不进入下一阶段：

1. 核对 `main`、HEAD、`origin/main`、工作树和当前阶段精确文件。
2. 对阶段文件执行 Prettier check、ESLint、TypeScript、聚焦 Vitest；执行生产 build 和 `git diff --check`。
3. 使用实际 build、真实 server、临时 PGlite/Git fixture 运行 Playwright，不以 API interception 或静态 fixture 代替。
4. 对受影响路由在 light/dark 下捕获：
   `1920x1080`、`1600x1000`、`1440x900`、`1280x800`、`1024x768`、`768x1024`、`390x844`。
5. 每张截图同时记录 console error、page error、failed request、横向溢出、主题、commit SHA、server health 和 fixture ID。
6. Geometry 自动断言：
   - header/content 左边界差 ≤2px；
   - table/list column 差 ≤1px；
   - 同级 toolbar/control 中心线差 ≤1px；
   - 无超过 viewport 1px 的横向溢出；
   - touch target ≥40px，桌面图标按钮可见命中区 ≥32px；
   - loading/empty/error 与正常态主框架不得发生超过 4px 的非预期位移。
7. 执行代理逐图进行层级、几何、密度、排版、状态、响应式、暗色、细节评分并记录修正轮次；阶段截图不通过不得提交。
8. 精确暂存当前逻辑切片，创建中文 Conventional Commit；再次核对 commit 内容和远端后立即 fast-forward push `origin main`。
9. 不按阶段部署；只有最终 RC Gate 全绿后部署一次生产。

截图与报告统一存放在 `docs/qa/visual/v1.0.0/<phase>-<shortSHA>/`，包含 PNG、`audit.json`、`geometry.json`、`review.md` 和 `SHA256SUMS`。

## 5. 分阶段实施

### Phase 0 — 规格、Baseline Screenshots 与 Version Truth

**具体文件**

- `docs/AgentHub_v1.0_Production_Quality_Package/**`
- `scripts/qa/real-deployment-visual.cjs`
- 新增 `scripts/qa/geometry-audit.cjs`
- 新增 `scripts/release/version-truth.mjs`
- `eslint.config.js`、`.prettierignore`、`package.json`
- 新增 `docs/qa/release/v1.0.0/version-truth-baseline.json`
- 新增 `docs/qa/visual/v1.0.0/00-baseline-*/`

**Implementation**

- 先计算完整方案包逐文件 SHA256 和总清单；原样纳入 Git，不在同一提交修订 ChatGPT 方案。
- 在任何产品代码变化前建立两套截图：
  - 当前 HEAD 的隔离真实服务器基线；
  - 当前生产镜像 `agenthub:0.8.0-nas.d09c575` 的只读基线。
- 生产认证仅复用受保护的既有凭据文件引用；不得输出 token、创建 token 或把凭据写入报告。
- inventory 必须记录 Git SHA、source package versions、AppShell 显示版本、health version、镜像 tag/ID/OCI revision、Compose project/config path、架构、Node/pnpm/Playwright/Chromium 版本。
- 修复 ESLint 将 `real-playwright-report/**` 当源码扫描的问题。
- `.prettierignore` 排除生成报告和历史归档；对当前维护源码已确认的 21 个格式异常文件做独立纯机械格式化，不混入行为修改。
- 记录当前测试事实：typecheck/build 通过；全量测试存在顺序/时序型 Workspace flake；lint/format 输入边界不正确。先稳定该 flake，不能把聚焦重跑通过当作全量通过。

**Test / Visual / Geometry**

- baseline 覆盖 Home、Projects、Project Context、Workspace、Prompts、Settings、Agents、Infrastructure、登录页及当前异常/空态。
- Workspace 至少包括 ready、running、approval、failed、closed、Git changes、terminal。
- 保存当前真实几何，不将其作为 v1 目标值；报告中同时写出与 v1 规格的差值。

**Commit / Push**

1. `docs(release): 纳入 v1.0 Production Quality 规格基线`
2. `chore(qa): 建立 v1.0 截图与版本真值基线`
3. `style(repo): 收口发布范围格式基线`

每个提交独立验证并立即 push。

---

### Phase 1 — Design System Foundation

**具体文件**

- `packages/ui/src/theme.ts`
- `packages/ui/src/styles.css`
- `packages/ui/src/primitives.tsx`
- `packages/ui/src/layout.tsx`
- `packages/ui/src/product.tsx`
- 对应 `*.test.tsx`
- 新增 `packages/ui/src/tokens.css`
- 新增 `packages/ui/src/workbench.tsx`

**Implementation**

- 落实 4px 网格、颜色、排版、尺寸、圆角、阴影、focus、motion、light/dark 和 comfortable/compact 契约。
- surface 仅允许 canvas/panel/row/content 四层；常规工作内容禁止 card 套 card、装饰性渐变和 hover 抬升。
- Loading 使用保持最终 geometry 的 skeleton；Empty 必须说明原因和下一步；Error 固定包含影响、retry、折叠 diagnostics。
- 构建统一 Button/IconButton/Input/Select/Tabs/Toolbar/EntityRow/LocalNav/SettingRow/Drawer/Overlay 行为。
- 现有 `Ah*` 组件先迁移到新 token，不创建第二套 `V1*` primitive；compat 暂不删除，直到所有消费者完成迁移。

**Test / Visual / Geometry**

- 单测覆盖尺寸、variant、disabled/loading、键盘、focus、ARIA、density/theme persistence。
- 截图使用现有真实页面展示每类 primitive 和四态，不增加生产组件画廊路由。
- 断言 control、row、radius、focus ring、对比度和 dark theme token；禁止组件内出现未登记的硬编码尺寸。

**Commit / Push**

- `feat(ui): 建立 v1.0 设计令牌与工作台原语`

---

### Phase 2 — Global AppShell 与导航

**具体文件**

- `apps/web/src/app/shell/AppShell.tsx`
- `apps/web/src/app/shell/AppShell.module.css`
- `apps/web/src/app/shell/AppShell.test.tsx`
- `apps/web/src/App.tsx`
- 新增 `apps/web/src/app/shell/CommandPalette.tsx`

**Implementation**

- Sidebar：展开 220px、折叠 60px；Topbar 56px。
- 页面 gutter：≥1440 为 28px，1024–1439 为 22px，≤767 为 16px。
- Primary nav 固定 Home/Projects/Agents/Prompts/Settings；Infrastructure 成为 Agents 二级入口；profile 固定底部。
- Command Palette 宽 620–680px、行高 44–52px，按 Recent/Projects/Sessions/Agents/Prompts/Commands 分组，支持 fuzzy、上下键、Enter、Esc、最近项排序和 `New Work in …`。
- 列表页不显示 breadcrumb；detail/workspace 才显示。
- 快捷键落实 `Ctrl/Cmd+K`、非 Workspace 的 `Ctrl/Cmd+B`，并在 tooltip/Palette 中可发现。

**Test / Visual / Geometry**

- 测试导航、redirect、sidebar persistence、Palette 搜索/键盘/焦点回归。
- 截图覆盖 Home、Projects、Agents、Prompts、Settings 的 sidebar 展开/折叠、Palette 打开、移动端 drawer。
- 断言 sidebar/topbar/gutter 精确值、导航行高一致、顶部动作中心线差 ≤1px。

**Commit / Push**

- `refactor(shell): 收口全局导航与页面几何`

---

### Phase 3 — Workspace 数据所有权、布局与历史分页

**具体文件**

- `apps/web/src/features/workspace/pages/WorkspacePage.tsx`
- `apps/web/src/features/workspace/workspace-types.ts`
- `apps/web/src/features/workspace/layoutPreferences.ts`
- `apps/web/src/features/workspace/workspace.module.css`
- `apps/server/src/sessions/session-routes.ts`
- `apps/server/src/sessions/session-service.ts`
- `packages/db/src/repositories.ts`
- 对应单元测试

**Implementation**

- `WorkspacePage` 保持唯一数据/Mutation/Realtime owner；显示组件不得直接调用 `api`。
- 将查询、mutation、realtime、layout、terminal、Git 状态拆为领域 hooks；页面仅负责 composition。
- 拆分 `workspace.module.css`，Workspace shell 样式最终 <16KB，单个模块 ≤12KB。
- 几何固定为：Top 50px；Rail 默认 256、范围 216–336；Conversation min 520；Inspector 默认 440、范围 360–760。
- 首次宽屏 Inspector 展开；恢复旧 localStorage 时将旧宽度 clamp 到新范围，不清空用户偏好。
- `<1180` 默认折叠 Rail；`<900` Inspector drawer；`<680` 单主视图 tabs。
- 增加 message window API；首屏取最近 100 条，向上加载更早消息，实时消息去重合并。

**Test / Visual / Geometry**

- 服务测试覆盖旧无参数响应、分页边界、sequence 顺序、空页、limit 校验。
- UI 测试覆盖偏好迁移、首开 Inspector、宽度 clamp、断点转换、URL view 兼容。
- 截图覆盖 ready/running/approval/failed/closed/loading/offline。
- 断言三栏 header 基线、Conversation min-width、Inspector 440、drawer 宽度和断点行为。

**Commit / Push**

- `refactor(workspace): 拆分工作台状态、分页与布局所有权`

---

### Phase 4 — Session Rail 与 Conversation

**具体文件**

- `apps/web/src/features/workspace/components/SessionRail.tsx`
- `apps/web/src/features/workspace/components/Conversation.tsx`
- `apps/web/src/features/workspace/components/MarkdownMessage.tsx`
- `apps/web/src/features/workspace/components/RunStateBanner.tsx`
- 新增 `ExecutionGroup.tsx`、`ThoughtGroup.tsx`、`ApprovalCard.tsx`
- 对应测试与样式模块

**Implementation**

- Rail 按 Active/Today/Yesterday/Earlier/历史会话分组；CLOSED 超过 10 条折叠历史。
- Rail 行高 48–56px，状态用 dot/文字，不形成 badge 墙；支持搜索、上下键、Enter、保持 scroll/selection。
- Conversation 将 Message、Thought、Tool/Execution、Approval 分为稳定信息层级。
- streaming tool/thought 默认一行，完成后可展开；raw payload/stdout 进入二级 Diagnostics。
- Offline 保留历史并禁用 Composer，显示 reconnect/continue，不用整页 error 替换。
- 500+ messages 只渲染可视窗口；加载旧页时保持阅读锚点。

**Test / Visual / Geometry**

- 测试分组边界、500 消息、长中英文/emoji/code、streaming、审批、失败恢复、scroll anchor 和键盘导航。
- 截图覆盖短会话、50 会话、500 消息、长代码、approval、failed、offline。
- 断言 Rail 行高、消息 readable column、执行组折叠高度和状态切换无跳动。

**Commit / Push**

- `feat(workspace): 重构会话栏与对话执行流`

---

### Phase 5 — Composer 与 Terminal Dock

**具体文件**

- `apps/web/src/features/workspace/components/Composer.tsx`
- `apps/web/src/features/workspace/components/TerminalDock.tsx`
- 新增 `ComposerSurface.tsx`
- 新增 `ComposerToolbar.tsx`
- 新增 `ContextPopover.tsx`
- 新增 `SessionConfigPopover.tsx`
- 新增 `SlashCommandMenu.tsx`
- 对应测试与样式模块

**Implementation**

- Composer 默认宽 820px，范围 620–920px；与 Conversation readable column 对齐。
- 主输入、Context、Permission、model/mode/reasoning、slash command、send/stop 使用 progressive disclosure；Prompt binding 缺变量或 render 失败必须阻止发送。
- `Ctrl/Cmd+Enter` 发送；Esc 关闭顶层浮层并恢复输入焦点。
- Terminal 从 Composer 内部展示迁移为底部 dock：默认 280px、最小 160px、最大 55vh；`Ctrl/Cmd+J` 切换。
- 只改变展示所有权，不改变 PTY 生命周期和 WebSocket 协议。

**Test / Visual / Geometry**

- 测试 IME、长输入、slash menu、变量阻断、配置更新、send/cancel、Terminal open/input/resize/close/reconnect。
- 截图覆盖默认、输入扩展、Context、Session Config、slash menu、发送失败、Terminal 展开。
- 断言 Composer 宽度、toolbar 中心线、浮层 620–680px、Terminal 高度边界与 resize hit zone 8–10px。

**Commit / Push**

- `feat(workspace): 重构 Composer 与 Terminal Dock`

---

### Phase 6 — Inspector、Changes Tree 与连续 Diff

**具体文件**

- `apps/web/src/features/workspace/components/WorkspaceInspector.tsx`
- `GitChangesTree.tsx`
- `DiffViewer.tsx`
- `FileInspector.tsx`
- `ActivityPanel.tsx`
- `RunPanel.tsx`
- `apps/server/src/git/git-routes.ts`
- `apps/server/src/git/git-service.ts`
- 对应测试与样式模块

**Implementation**

- Inspector 一级 tab 仅 Changes/Files/Activity/Run；History/Branches 进入 Changes 的 overflow/drawer，不保留嵌套 Git tab 墙。
- Changes 使用持续可见的 tree + diff master-detail；选中、展开、scroll、view mode 在切换后保持。
- Diff 填满剩余高度，按扩展名识别 language，支持 unified/split、wrap、whitespace、折叠未变区。
- `truncated`、binary 或超阈值时先显示明确 warning、stats 和受控加载操作，不静默冻结。
- CommitDock 固定在 Changes 底部，保持 staged/selected-files 两种现有语义。
- 不新增 `/git/diff/file`，除非现有接口无法通过已验证测试满足需求；本计划默认复用现有 `path` 查询参数和 patch 响应。

**Test / Visual / Geometry**

- 测试 200 change entries、12 层目录、M/A/D/R/U/conflict、binary、rename、删除文件、4MiB 截断、whitespace、selected commit。
- 截图覆盖 clean、200 changes、深目录、连续 diff、split、large diff、binary、history drawer、commit error/success。
- 断言 tree/diff 同高、header 对齐、CommitDock 不遮挡内容、Inspector 在 360/440/760px 下均可用。

**Commit / Push**

- `feat(workspace): 重构 Git 变更树与连续 Diff 审阅`

---

### Phase 7 — Home

**具体文件**

- `apps/web/src/features/home/pages/HomePage.tsx`
- `apps/web/src/features/home/home.module.css`
- Home 相关测试与 fixture

**Implementation**

- 删除 385px hero、Aurora 装饰和大项目卡；首个可操作内容 y≤260px。
- 结构固定为 Continue Work strip、72–80px metrics、Recent Projects 60%、Needs Attention 40%。
- 常规项目/会话行高 60–68px；测试项目默认折叠。
- 0 Project 使用单一 onboarding panel，按 Runtime→Project→Agent→Session 只突出下一步。

**Test / Visual / Geometry**

- 覆盖 0 项目、正常数据、20 TEST 项目、失败/审批/运行中、长标题路径。
- 断言首个动作 y≤260、metric 等高、60/40 分栏和无连续 >120px 无业务空白。

**Commit / Push**

- `feat(home): 重构工作优先首页`

---

### Phase 8 — Projects 与 Project Context

**具体文件**

- `apps/web/src/features/projects/pages/ProjectsPage.tsx`
- `ProjectContextLayout.tsx`
- `ProjectOverviewPage.tsx`
- `ProjectWorkPage.tsx`
- `ProjectSessionsPage.tsx`
- `CreateProjectPage.tsx`
- `NewWorkPage.tsx`
- `projects.module.css`

**Implementation**

- Projects 改为 list-first；行高 64–72px、icon 40px；名称/状态为一级，路径按需展开。
- Project Context 固定 Overview/Work/Sessions；Prompt Binding 进入 Prompts filter，Project Settings 合并为 Overview 属性与动作。
- 保持创建项目、创建 Work、worktree/review/rework/merge/cancel 的现有行为。
- 1024px 以下 local nav 折叠为单层 selector，禁止 global+local+第三层永久导航。

**Test / Visual / Geometry**

- 覆盖 STANDARD/TEST、Local/Docker/Remote、长路径、100 项目、创建失败和所有 Work 状态。
- 断言列表列宽差 ≤1px、local nav 184px、内容区对齐、移动端无路径溢出。

**Commit / Push**

- `feat(projects): 收口项目列表与上下文体验`

---

### Phase 9 — Prompt Library

**具体文件**

- `apps/web/src/features/promptos/pages/PromptLibraryPage.tsx`
- `PromptLibraryPage.test.tsx`
- `promptSettings.module.css`
- 新增 `components/PromptAssetList.tsx`
- 新增 `components/PromptEditor.tsx`
- 新增 `components/PromptVersionDrawer.tsx`
- 新增 `hooks/usePromptLibrary.ts`

**Implementation**

- 拆分当前 1066 行页面；Library list 固定 272–304px。
- 编辑区固定 Content/Variables/Playground/Bindings；版本历史使用 360–420px drawer。
- 保存、版本创建、label、binding、render、变量失败和恢复动作保持现有语义。
- 100 prompts、20 versions、15 bindings 下保持选择、搜索和滚动位置。

**Test / Visual / Geometry**

- 覆盖空库、100 prompts、长内容、变量缺失、render error、版本 drawer、binding。
- 断言 list/editor/drawer 宽度、编辑 toolbar 对齐、长内容无页面级横向滚动。

**Commit / Push**

- `refactor(prompts): 拆分 Prompt 资产编辑与版本生命周期`

---

### Phase 10 — Settings

**具体文件**

- `apps/web/src/features/settings/pages/SettingsPage.tsx`
- `SettingsPageView.tsx`
- 新增 `SettingsLayout.tsx`
- 新增 `sections/AppearanceSettings.tsx`
- `AccountSettings.tsx`、`SecuritySettings.tsx`、`IntegrationsSettings.tsx`
- `SystemSettings.tsx`、`AdvancedSettings.tsx`
- Settings 路由测试与样式模块

**Implementation**

- 正式 section 固定 Appearance/Account/Security/Integrations/System/Advanced。
- local nav 184px；内容宽 760–820px；setting row 将标题、说明、状态和动作保持单一对齐。
- Runtime、Remote Node、Docker 基础设施配置迁移到 Agents/Infrastructure；Settings 只保留与系统配置有关的入口或链接。
- `/settings/runtime` 保留 redirect 到新的 Infrastructure 位置。
- 密度和主题进入 Appearance；API token、密码、退出登录及一次性 token 显示安全语义保持不变。

**Test / Visual / Geometry**

- 覆盖每个 section、token 创建展示逻辑、权限不足、错误、移动端 local nav。
- 断言 184px local nav、760–820px 内容、setting row 控件右边界一致、secret 不进入截图或日志。

**Commit / Push**

- `feat(settings): 重建分区设置体验`

---

### Phase 11 — Agents、Infrastructure 与 Discovery

**具体文件**

- `apps/web/src/features/agents/pages/AgentCenterPage.tsx`
- `AgentsPage.tsx`
- `DiscoverAgentsPage.tsx`
- `InfrastructurePage.tsx`
- `RemoteNodeDetailPage.tsx`
- `RemoteNodeRegistrationPage.tsx`
- `components/RuntimeDiscoveryPanel.tsx`
- `components/RemoteNodesPanel.tsx`
- 对应测试与样式模块

**Implementation**

- Agent Center 使用 entity rows；Agent 为主对象，Runtime/Remote Node 归入 Infrastructure 二级入口。
- Discovery 固定 Scan→Candidates→Adopt & Preflight 三步，不继续使用多层 modal。
- 保持本机/Docker/Remote discovery、preflight、registration token 一次性展示和凭据引用边界。
- 原 `/agents/agents`、`/agents/runtimes` 等旧链接只做 redirect 到 canonical route。

**Test / Visual / Geometry**

- 覆盖无 Agent、扫描中、候选、adopt、preflight failed、Docker unavailable、Remote offline。
- 断言 agent row 60–68px、step header 对齐、diagnostics 折叠、registration secret 不进入截图。

**Commit / Push**

- `feat(agents): 收口 Agent 与基础设施信息架构`

---

### Phase 12 — Migration 删除、性能、可访问性与最终视觉系统

**具体删除项**

零引用后删除：

- `apps/web/src/components/AppShell.tsx`
- `apps/web/src/components/AppShell.module.css`
- `apps/web/src/components/AppShell.test.tsx`
- `apps/web/src/components/Common.tsx`
- `apps/web/src/components/Common.module.css`
- `apps/web/src/components/Common.test.tsx`
- `packages/ui/src/compat.tsx` 及 `styles.css` 中 `ah-compat-*`
- `apps/web/src/features/sessions/pages/SessionsPage.tsx`
- `apps/web/src/features/sessions/pages/SessionsPageView.tsx`
- `apps/web/src/features/tasks/pages/TasksPage.tsx`
- `apps/web/src/features/tasks/pages/TasksPageView.tsx`
- `apps/web/src/features/promptos/pages/PromptOsPage.tsx`
- `apps/web/src/features/v06-feature-boundary.test.ts`
- 完成拆分后删除旧 `workspace.module.css`、旧版单体 `Composer.tsx`/`Conversation.tsx`/`GitChangesTree.tsx` 的被替代内容；不能同时保留旧版和新版实现。

**新增/更新文件**

- `scripts/qa/real-deployment-visual.cjs`
- `scripts/qa/geometry-audit.cjs`
- 新增 `scripts/qa/css-budget.mjs`
- 新增 `scripts/qa/performance-gate.cjs`
- `tests/e2e-real/fixtures.ts`
- 新增 `tests/e2e-real/v1-fixtures.ts`
- 新增 `tests/e2e-real/v1-workspace.spec.ts`
- 新增 `tests/e2e-real/v1-pages.spec.ts`
- 删除/替换 `tests/e2e-real/v07-workbench.spec.ts`

**Implementation**

- `rg` 证明旧模块、compat selectors、旧路由组件零引用后再删除。
- fixture 固定包含：8 STANDARD+20 TEST projects、50 sessions、200 Git entries、100 prompts、20 versions、15 bindings、1000 tool events、500 messages及长文本/emoji/code/error/offline。
- Monaco 保持按需加载；长列表窗口化。
- CSS gate：Workspace shell <16KB、单组件 ≤12KB；模块 >25KB warning、>40KB fail，不设置永久白名单。
- 性能 gate：LAN Home LCP <2s、缓存路由可见 <250ms、输入响应 <100ms、200 Git tree build <50ms、500 Session filter <50ms、交互无持续 <40fps。

**Test / Visual / Geometry**

- 运行完整七视口、双主题、全部核心路由和全部关键状态矩阵。
- axe 不允许 critical/serious；键盘完成导航、Palette、Workspace、Composer、Inspector、Terminal、drawer。
- 代理评分量表：信息层级2、几何2、密度1、排版/对比1、状态1、响应式1、暗色1、细节1；每页 ≥9 且任何维度不得为0。
- 至少执行一次“截图→审查→修正→重拍”，不能用首轮截图直接宣告完成。

**Commit / Push**

1. `refactor(web): 删除旧页面与兼容设计系统`
2. `perf(web): 收口长列表与工作台性能`
3. `test(visual): 建立 v1.0 响应式与暗色视觉基线`

每个提交独立 push。

## 6. 风险与回滚

- **AI 方案内部冲突**：以当前用户决定、`V1_FINAL_TECHNICAL_SOLUTION.md`、对应页面 master spec 的顺序裁决；已明确 Inspector 首开 440px。任何新冲突必须在实现前更新规格修订提交。
- **用户未跟踪文件**：只精确加入 v1.0 package；不执行 reset/clean，不批量暂存 `docs/`。
- **Workspace 大规模回归**：按数据所有权、Conversation、Composer、Git 四个独立提交切片；每片可用 `git revert <sha>` 回滚。
- **实时消息与分页错序**：sequence 为唯一排序/去重依据；旧无参数 API 保持兼容。
- **CSS 拆分导致隐藏回归**：每阶段完整视口截图、geometry 和状态矩阵；不靠最终阶段一次性发现。
- **Chromium/OOM**：NAS Playwright 使用 `--disable-gpu`、serial workers、隔离 fixture；OOM/浏览器基础设施失败单独记录，不误判产品回归。
- **版本漂移**：镜像必须带完整 revision/version labels；health、UI、CLI 与 package 由脚本比对。
- **数据迁移**：本计划不删除或重写业务数据；若实现中发现必须做 schema migration，只允许 additive/backward-compatible migration，并新增升级/旧镜像读取测试。
- **Git 回滚**：已 push 变更只用新 `revert` commit；禁止 reset、rebase、amend、force-push。
- **生产回滚点**：
  - 当前镜像固定为 `agenthub:0.8.0-nas.d09c575` / image ID `sha256:1fb03d…`；
  - 部署前增加明确 rollback tag，保存实际 Compose、受保护 env、镜像 ID、mount inventory 和停止服务后的一致性 PGlite 数据备份；
  - 备份目录使用 `/volume2/DockerProject/agenthub/backups/v1.0.0-<UTC>/`，保留权限并生成 SHA256；
  - 不备份或复制 Codex 原生凭据；
  - 回滚使用原 Compose 配置与旧镜像执行 `docker compose up -d --no-deps agenthub`，不执行 `down`、不删镜像/卷；
  - 因 schema 保持兼容，正常 UI 回滚不恢复数据；仅数据库完整性失败时才在服务停止状态下使用备份恢复。

## 7. v1.0 Release Candidate Gate

只有以下全部满足才允许生产部署：

1. **Git**
   - `main == origin/main`；
   - 所有阶段提交已 push；
   - 从干净隔离 checkout 构建明确 SHA；
   - 用户旧未跟踪文件未被纳入或修改。

2. **Version Truth**
   - 根目录及全部 workspace package 为 `1.0.0`；
   - `AGENTHUB_VERSION`、Web 显示、health、CLI、Node、README、CHANGELOG、Compose 示例、OCI version 均为 `1.0.0`；
   - OCI revision 等于候选 commit 完整 SHA；
   - 候选镜像先标记 `agenthub:1.0.0-rc.<shortSHA>-nas`，全部门禁通过后将同一 image ID 标记为 `agenthub:1.0.0-nas.<shortSHA>`；生产只使用 SHA tag。

3. **代码门禁**
   - `corepack pnpm install --frozen-lockfile`
   - `corepack pnpm format:check`
   - `corepack pnpm lint`
   - `corepack pnpm typecheck`
   - `corepack pnpm test`
   - `corepack pnpm build`
   - `git diff --check`
   - CSS/selector/global/`!important` budget 全绿。

4. **功能门禁**
   - token/local-trusted 两种真实 server E2E；
   - Project、Session、Run、continuation、approval、Prompt、Git、Terminal、Agent discovery、Worktree 全部通过；
   - 500 messages、50 sessions、200 changes、100 prompts fixture 通过；
   - clean install、现有生产数据副本升级、旧镜像兼容读取、回滚演练通过。

5. **视觉与几何**
   - 七视口×双主题×核心路由完整；
   - console/page error/failed request/横向溢出为0，已批准的网络中断 fixture 除外；
   - geometry 阈值全部通过；
   - axe critical/serious 为0；
   - 每个核心页面代理视觉评分 ≥9/10，且有至少一轮纠偏证据。

6. **性能**
   - Home LCP、路由切换、输入延迟、tree/filter、FPS 达到既定阈值；
   - 无 Workspace/Monaco 首屏非必要 eager load；
   - ARM64 镜像 build 和启动内存无新增持续性回归。

7. **发布材料**
   - README、CHANGELOG、迁移说明、回滚说明、版本真值、镜像 digest、截图索引、测试报告和未验证项完整；
   - 不得存在“部分通过但标记完成”的门禁。

8. **生产部署与只读验收**
   - 部署前记录健康、运行镜像、Compose path、mount、数据备份和 rollback tag；
   - 仅替换 `agenthub` 服务，不重启无关服务；
   - 使用 `docker compose up -d --no-deps agenthub`，不执行 `down`；
   - 等待 container healthy，并核对 `/api/v1/health`、Web 静态资源、OCI version/revision；
   - 生产只读检查认证、Home、Projects、Workspace 历史、Prompts、Settings、Agents、Infrastructure、WebSocket、双主题和 1440/1024/768/390 视觉；
   - 生产 smoke 失败立即恢复旧镜像配置；不得宣称 v1.0.0 发布成功。

9. **最终交付记录**
   - 最终 commit SHA、每个切片 SHA/push 结果；
   - 候选与正式镜像 ID/digest；
   - 实际执行命令及结果；
   - 生产容器健康、版本、截图和只读业务证据；
   - 未验证项必须为零；
   - rollback 镜像、Compose/数据备份位置及校验值。


来源：用户于原任务 `01a0539c-7b87-7291-8078-d58078b75e12` 明确批准的实施计划，接手时原样存档。

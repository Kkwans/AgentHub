# AgentHub v1.1.0 发布说明

## 目标

v1.1.0 是 Workspace 优先的前端重构版本。它沿用 PinHarness 的三栏工作台、实体 surface、紧凑工具栏和因果对话语言，同时保留 AgentHub 的 REST `/api/v1`、WebSocket `/ws`、数据库、认证、Approval、Git、Terminal 与 PromptOS 契约。

## 当前候选覆盖（2026-09-10）

- 当前生产候选为 `agenthub:2026.9.10-v16`，image ID `sha256:aec6abc6995fde2f25e3a652054de1b4d3801dbc7716b04abf0d50ae65705171`，OCI version `1.1.0`，revision `4c700dd7c09cac41ce2b91a423839958ba51d027`，架构 `linux/arm64`；`/api/v1/health` 返回 `status: ok`、`version: 1.1.0`、`database: pglite`、`web: true`。
- 本次只替换 `agenthub` service，未执行 `docker compose down`，未修改数据卷或其它容器；即时回滚为 `agenthub:2026.9.10-v15`，长期 1.0.0 回滚点仍为 `agenthub:2026.9.5-v2`。
- v16 延续授权账号真实登录页、Agent Center 和 Runtime 交互证据：登录/退出、密码显隐、Agent 搜索与状态筛选通过；Runtime 默认 16 个可用环境、57 个停止项折叠，展开/收起可用且不暴露 digest，1440/390 横向溢出、console/page/request errors 均为 0。
- v16 延续 v7 的认证 Workspace 与核心路由证据：壳层显示真实登录用户名 `Kkwans`。上述证据不覆盖活动 Agent/ACP streaming、Approval、native PTY、200% zoom、备份恢复、性能预算或独立视觉复核。
- 全仓静态门禁与 Vitest 已通过：68 个文件通过、4 个跳过，304 个测试通过、10 个跳过；Workspace/Git 聚焦测试 19/19。Vite 仍报告 Monaco/editor 大 chunk 警告，属于既有性能预算项。发布 manifest 继续保持 `complete: false`，本候选不宣称完整验收通过。

## 主要改动

- `@agenthub/ui` 原位升级 tokens、Workbench、Command Bar、执行 disclosure、状态指示和 reduced-motion 规则；WorkBench 样式拆为共享入口下的独立 stylesheet，保持 `@agenthub/ui/styles.css` 导入兼容；
- Workspace 按 `>=1180px` 三栏、`768-1179px` 可切换 drawer、`<768px` 单面板 tabs 适配；
- 对话显示层新增 `ConversationTurn` / `ConversationEntryView`，按真实顺序插入 thought、tool、Approval 和 streaming Assistant delta，并在长会话启用 `@tanstack/react-virtual`；
- Composer 草稿按 Session 保存，输入区支持 40–320px 调整；Terminal 进入 Workspace 底部 dock，尺寸和打开状态按 Session 保存；
- AppShell、Home、Projects、共享容器统一冷中性画布、实体 surface、8/12/14px 圆角、短阴影和有限 transform/opacity 动效。

### 第二十三轮：Agent Center 筛选栏直接对齐（2026-09-10）

- 移除共享 `AhSelect` 上会覆盖 PinHarness 响应式宽度的旧 `.ah-select-trigger { width: 100% }` 规则；Agent Center 状态筛选在桌面固定 170px，在移动端仍占满可用宽度，刷新动作与状态控件保持同一行。
- 代码提交 `4fd8dfe` 已推送 `main`；共享 UI/Agent Center 聚焦 Vitest（2 files/8 passed）、Prettier、typecheck、`git diff --check` 与全仓生产 build 通过。
- v10 镜像通过 arm64、OCI metadata 与 native `node-pty` 检查后部署；部署前快照位于 `/volume2/Project/.agenthub/central/deployments/20260910T045500Z-pre-filter-width/`。失败构建 `v9` 使用了错误 revision 参数，未部署且保留以便追溯。
- NAS-local Chromium 真实认证截图位于 `/tmp/agenthub-v10-auth-agents-1440-light.png`、`/tmp/agenthub-v10-auth-agents-390-light.png`；本轮仅记录 Agent Center 真实交互，不宣称完整视觉验收。

### 第二十四轮：认证页直接复用 PinHarness 输入（2026-09-10）

- 认证页用户名和设置页密码字段统一使用共享 PinHarness `Input`，密码显隐按钮使用同一套 surface、focus ring 与 reduced-motion token；删除认证页专用 `.ah-access-input` / `.ah-password-*` 运行时依赖，认证 REST、Cookie、退出和密码修改契约不变。
- 代码提交 `f80a1c8` 已推送 `main`；App、UI primitive、PasswordField 聚焦 Vitest（3 files/23 passed）、目标 ESLint、Prettier、typecheck、`git diff --check` 与生产 build 通过。
- v11 镜像通过 arm64、OCI metadata 与 native `node-pty` 检查后部署；部署前快照位于 `/volume2/Project/.agenthub/central/deployments/20260910T050800Z-pre-auth-inputs/`。真实认证截图位于 `/tmp/agenthub-v11-auth-login-1440.png`、`/tmp/agenthub-v11-auth-login-390.png`；本轮仅记录登录/退出和控件契约，不宣称完整视觉验收。

### 第二十五轮：Runtime 列表渐进披露（2026-09-10）

- Runtime 主列表默认只呈现可用环境；已停止容器收敛为可展开计数，镜像 digest 与无名称容器的 `sha256:` 标识统一隐藏在主视觉层，避免基础设施页退化为原始 Docker 日志墙；启动、停止、接入和重新扫描契约保持不变。
- 代码提交 `bf48283`（停止项折叠）与 `8f4aaf4`（digest 脱敏）已推送 `main`；Infrastructure/Agent 页面聚焦测试、纯函数测试、typecheck、lint、Prettier、`git diff --check` 与生产 build 通过。
- v15 镜像通过 arm64、OCI metadata 与 native `node-pty` 检查后部署；部署前快照位于 `/volume2/Project/.agenthub/central/deployments/20260910T052900Z-pre-runtime-digest/`。真实 Runtime 截图位于 `/tmp/agenthub-v15-runtime-1440.png`、`/tmp/agenthub-v15-runtime-390.png`；折叠/展开真实交互前后均无 digest。

### 第二十六轮：Git 变更树排序性能（2026-09-10）

- `buildGitChangeTree` 改为复用模块级 `Intl.Collator`，避免每次排序创建 `localeCompare` 配置；200 项变更树本地 22 次采样 p95 从约 155ms 降至 2.59ms，Git 目录分组、路径 containment 与渲染结构不变。
- 代码提交 `4c700dd` 已推送 `main`；Git changes 2/2、typecheck、lint、Prettier、`git diff --check` 与生产 build 通过；v16 镜像已部署，部署前快照位于 `/volume2/Project/.agenthub/central/deployments/20260910T061000Z-pre-git-tree-perf/`。
- 专用 `v1-performance.spec.ts` 两次真实复跑仍分别出现 NAS I/O 下 app fixture 启动超时，以及 routeVisible p95 `581.7ms > 250ms`；性能门禁保持 `UNVERIFIED/FAILED`，不以本地函数采样替代真实浏览器全链路结论。

### 第十八轮：共享组件直接切到 PinHarness（2026-09-09）

- `AhSelect`、共享 `Combobox`、`AhSurface`、`AhStatusPill`、`AhDialog` 与页面 Loading/Error/Empty 状态不再渲染 Mantine/旧 CSS；实际 DOM 改用 PinHarness Radix Select、Card、Badge、FormDialog、Skeleton 和同一套 Tailwind token，保留旧页面的 `data/onChange/label/description` 调用契约；
- 删除旧的 `ah-combobox`、`ah-select-native`、状态徽标和 Feedback 状态 CSS，避免一套页面同时维护两套视觉系统；
- 代码切片已推送 `main`：`4d7eeee`（Select）、`704c471`（Surface/Badge）、`b5cff2d`（共享选择控件）、`990ef50`（表单弹层）、`47dcbd2`（空态/错误态/加载态）、`e80551b`（页面反馈统一）；
- 共享包与 Web typecheck/build、全仓 lint/format、聚焦 Vitest（15 files/63 passed；反馈迁移 12 files/58 passed）均通过；Vite 仍报告 Monaco/editor 大 chunk 警告，属于既有性能预算问题，不以视觉 smoke 代替性能验收；
- 当前生产部署为 `agenthub:2026.9.9-v22`；未登录真实入口四视口 smoke 证据见 [`docs/qa/visual/v1.1.0/29-deployed-feedback-ui-20260909.json`](qa/visual/v1.1.0/29-deployed-feedback-ui-20260909.json)，认证后的 Workspace/Agent/Terminal 与独立视觉复核仍未验证。

### 第十九轮：Select 搜索与 Drawer 直接复用（2026-09-09）

- PinHarness Radix Select 增加旧 Select 所需的搜索、清除项和无结果状态；所有 `AhSelect`/`Combobox` 继续使用同一组件，避免回退到第二套 Mantine/原生选择器；
- `AhDrawer` 改为 PinHarness token 驱动的实体侧滑层，包含焦点恢复、Tab trap、Esc/遮罩关闭、四方向尺寸和 reduced-motion 动效；Prompt Lifecycle 与移动导航共用同一层级；
- 代码提交 `f710024`（Select 搜索兼容）与 `f51329c`（Drawer）已推送 `main`；PinHarness/UI/Web typecheck/build、全仓 lint/format、Select/Workspace/Drawer 聚焦测试均通过；
- 当前生产镜像为 `agenthub:2026.9.9-v23`，image ID `sha256:625d027337d503ecf1002374b1941d969a38b2264e9102378c4a7b87e9500757`，OCI revision `f51329c375239dbd4effc41ff461a42beb09e5f4`；部署前快照与 v22 回滚材料位于 `/volume2/Project/.agenthub/central/deployments/20260909T132222Z-pre-select-search-drawer/`；
- 未登录真实入口四视口 smoke 证据见 [`docs/qa/visual/v1.1.0/30-deployed-select-search-drawer-20260909.json`](qa/visual/v1.1.0/30-deployed-select-search-drawer-20260909.json)；认证 Workspace、真实 Agent/PTY、性能与独立视觉复核仍未验证。

### 第二十轮：Switch 直接复用（2026-09-09）

- Settings 的“减少动效”改用 PinHarness token 驱动的原生 `role=switch`，保留 `checked/onChange/aria-label` 契约，焦点环、禁用态和 reduced-motion 与其他共享控件一致；
- 代码提交 `fee7720` 已推送 `main`；UI/Web typecheck/build、全仓 lint/format、14 files/73 passed 聚焦测试均通过；
- 当前生产镜像为 `agenthub:2026.9.9-v24`，image ID `sha256:ccf2fc1c4b3d1d48356ac1635e49749c10f572e89a32815e3fe279879cb686b9`，OCI revision `fee7720e7139ec412ddb66eeb0098667eb0c3e08`；部署前快照位于 `/volume2/Project/.agenthub/central/deployments/20260909T133658Z-pre-switch/`；
- 未登录真实入口四视口 smoke 证据见 [`docs/qa/visual/v1.1.0/31-deployed-switch-20260909.json`](qa/visual/v1.1.0/31-deployed-switch-20260909.json)；认证 Workspace、真实 Agent/PTY、性能与独立视觉复核仍未验证。

### 第二十一轮：移除 Mantine 运行时并对齐对话动效（2026-09-09）

- `@agenthub/ui` 不再挂载 Mantine Provider、theme 或全局 CSS；保留原有导出名和调用参数，但 `ProjectContext`、Metric、Toast、Select、Card、Badge、Dialog、Feedback、Switch、Input/Textarea 全部由已复制的 PinHarness primitives 与语义 token 渲染，页面不再受到第二套组件 CSS 影响；
- Workspace Conversation 直接采用 PinHarness 的顶部渐隐、用户气泡渐变、居中“回到最新”与 reduced-motion 过渡；消息归并、Approval 插入、REST/WebSocket/Terminal 契约不变；
- 代码提交 `a4c3e40`（移除 Mantine/统一页面基元）、`7370ef6`（Radix Select E2E 断言）与 `ccfa036`（对话视觉）均已推送 `main`；UI/Web typecheck/build、6 files/30 passed UI 聚焦测试、Workspace 9 files/41 passed、Work 四视口 4/4、Workspace desktop 1/1、全仓 lint/format/diff 均通过；
- 当前生产镜像为 `agenthub:2026.9.9-v26`，image ID `sha256:93c297abe3af9b065082f08cb750327b5ee8ea6cbb2daf8237b331d2c96fa6cb`，OCI revision `ccfa0364ec7c24389f4e6a850229f3f466eca957`，架构 `linux/arm64`；部署前快照位于 `/volume2/Project/.agenthub/central/deployments/20260909T064325Z-pre-conversation-visual`；
- 未登录真实入口四视口 smoke 证据见 [`docs/qa/visual/v1.1.0/32-deployed-conversation-visual-20260909.json`](qa/visual/v1.1.0/32-deployed-conversation-visual-20260909.json)：HTTP 200、无横向溢出、console/page/request errors 均为 0；认证 Workspace、真实 Agent/PTY、性能与独立视觉复核仍未验证。

### 第二十二轮：清理废弃 Shell CSS 并固化 v28 候选（2026-09-09）

- 删除 AppShell 中已经不再被运行时代码引用的旧侧栏 CSS 模块，保留 Command Palette 的实际样式；页面壳层继续由 PinHarness token、Tailwind utilities 和共享 `@agenthub/ui` primitives 驱动，避免废弃选择器重新覆盖三栏工作台；
- 同步将 Prompt Library、Settings 和全局 RouteLoading 的页面标题切换为共享 `AhPageHeader`，消除旧 `workspace-header` 卡片在普通页面中的残留层级；
- 代码提交 `138e957`（共享页面标题）与 `7b594f2`（Shell CSS 清理）已推送 `main`；UI/Web typecheck/build、Shell/App/Provider 聚焦 Vitest（3 files/18 passed）、四视口页面语义 Playwright（20/20 passed）、全仓 lint/format 与 `git diff --check` 均通过；
- 当前生产镜像为 `agenthub:2026.9.9-v28`，image ID `sha256:bc024753a89d60ef06dd247ed2dbcd451b1593a5d96a9b827b20503382fa9562`，OCI revision `7b594f27379a97d7f6559981820485d6c76d909b`，架构 `linux/arm64`；部署前快照位于 `/volume2/Project/.agenthub/central/deployments/20260909T071838Z-pre-shell-css-cleanup`；
- v28 部署后 NAS-local Playwright 未登录真实入口四视口 smoke 证据见 [`docs/qa/visual/v1.1.0/33-deployed-shell-css-cleanup-20260909.json`](qa/visual/v1.1.0/33-deployed-shell-css-cleanup-20260909.json)：HTTP 200、无横向溢出、console/page/request errors 均为 0；认证 Workspace、真实 Agent/PTY、性能、备份恢复与独立视觉复核仍未验证。

## 版本、镜像与回滚

- 软件版本：`1.1.0`；当前 PinHarness 直接迁移生产候选：`agenthub:2026.9.10-v16`，镜像为 Linux `arm64`，OCI `revision` 为 `4c700dd7c09cac41ce2b91a423839958ba51d027`；
- 当前生产运行时源码提交：`4c700dd7c09cac41ce2b91a423839958ba51d027`（已推送 `main`）；镜像 ID 为 `sha256:aec6abc6995fde2f25e3a652054de1b4d3801dbc7716b04abf0d50ae65705171`；`e77d5c1`、`2eb3bc7`、`9ddcca2`、`1251580`、`4fd8dfe`、`f80a1c8`、`bf48283`、`8f4aaf4` 与 `4c700dd` 均包含在当前候选源码中；
- 当前生产 1.0.0 回滚点：`agenthub:2026.9.5-v2`，image ID 为 `sha256:cf44afd240c555bb0e629af61dad2bcb3b343c7f87de69babc9323292ad2cc03`（arm64，创建于 `2026-09-05T17:03:24+08:00`）；其 Compose 配置、数据卷和其他 Agent 容器不得覆盖或删除；
- v16 部署前只读预检确认 v15 容器 `running/healthy`、health `200`、版本 `1.1.0`；长期回滚点 `agenthub:2026.9.5-v2` 与其 image ID 已单独核对并保留；
- 2026-09-10 14:07（Asia/Shanghai）已按用户明确授权替换生产 `agenthub` service。部署后 health `200` 返回版本 `1.1.0`，容器为 `running/healthy`，无 OOM/异常退出；Compose config 通过；
- 本轮只执行 `docker compose ... up -d --no-build agenthub`，未执行 `docker compose down`，未触碰 Project、PGlite/Postgres、worktrees、token 或其他容器；挂载对比保持不变，其他容器的 name/image identity 未变；
- v15/v14/v13/v12/v11/v10/v9/v8/v7/v6/v5 镜像、Compose 配置与长期回滚点均保留在 NAS；未推送外部 registry，NAS 本地 v16 镜像已直接由 Compose 使用。

### PinHarness 直接迁移重部署追加（2026-09-09）

- 当前生产镜像已替换为 `agenthub:2026.9.9-v1`，image ID `sha256:6f58c66edb9d34edc3e0af9bf562774ef232dd735bade88af8cf11353c63e16a`，OCI revision `f25216374dd23b2f30f74ec0687b8847e383fd72`，架构 `linux/arm64`；
- 2026-09-09 01:18:07（Asia/Shanghai）只 recreate `agenthub` service；容器 `running/healthy`、exit `0`、OOM `false`，health HTTP `200` 返回 `version: 1.1.0`、`database: pglite`、`web: true`；
- 重新部署前快照与候选 Compose 配置保存在 `/volume2/Project/.agenthub/central/deployments/20260908T171703Z-pre-pinharness/`；原 `agenthub:2026.9.8-v1` 与 `agenthub:2026.9.5-v2` 均保留；
- NAS-local Playwright 未登录静态 smoke 在 1440/1024/768/390 四视口均 HTTP `200`、无横向溢出、console/page/request error 为 `0`；这仍不等同认证 Workspace/Agent/PTY 的完整视觉验收。

### 对话层第二轮直接对齐追加（2026-09-09）

- 按 PinHarness `ChatConversationView` / `ChatEntryRenderer` 的真实层级修正 Workspace：用户消息改为单层气泡，Agent 头部移除自造竖线，Thinking 使用 Brain/渐隐状态卡；
- 修正 `ThreeColumnSplit`：`>=1180px` 进入三栏，Conversation 最小宽度 560px；768–1179px 继续使用共用辅助栏；移除会拦截辅助栏 tab 的废弃 scrim；
- 代码提交 `a16f11ea073be99d8c1903ff17c15372eb24a9e4` 已推送 `main`；`pnpm lint`、`pnpm typecheck`、Workspace/全局聚焦 Vitest（35/35）、Web build 与 1024px Workspace Playwright 均通过；
- 当前生产镜像为 `agenthub:2026.9.9-v2`，image ID `sha256:62a7bac83c14a12ea7d2a17c0cb26538f66eddd682fc1edeafb1ba77bc0d529f`，OCI revision `a16f11ea073be99d8c1903ff17c15372eb24a9e4`，架构 `linux/arm64`；
- 2026-09-09 01:57:47（Asia/Shanghai）仅 recreate `agenthub` service；health HTTP `200` 返回 `version: 1.1.0`，容器 `running/healthy`，其他 14 个容器 name/image identity 未变；
- 部署前快照保存在 `/volume2/Project/.agenthub/central/deployments/20260908T175143Z-pre-conversation-polish/`；`agenthub:2026.9.9-v1` 与 1.0.0 回滚镜像均保留；
- 最新 NAS-local Playwright 未登录 smoke 四视口均 HTTP `200`、无横向溢出、console/page/request error 为 `0`，证据见 [`docs/qa/visual/v1.1.0/12-deployed-login-20260909-polish.json`](qa/visual/v1.1.0/12-deployed-login-20260909-polish.json)；仍不等同认证 Workspace/Agent/PTY 完整验收。

### 移动端 tab 收敛追加（2026-09-09）

- 移动端改为单一完整 Workspace tab bar，保留“会话 / 对话 / 文件 / 变更 / 活动 / Run”入口；移除重复的三 tab 兼容层，避免文件面板不可达；
- 代码提交 `2c973fefe297c7d552ec598a332e1aeb6a485bd2` 已推送 `main`；移动端 390px、平板 768px 和中屏 1024px Workspace Playwright 均通过；
- 当前生产镜像为 `agenthub:2026.9.9-v3`，image ID `sha256:5aff86d41329b48dcb2d88e9df4999cf8ac2df2974a052d2a7fa12ad344c2106`，OCI revision `2c973fefe297c7d552ec598a332e1aeb6a485bd2`；
- 2026-09-09 02:14:28（Asia/Shanghai）仅 recreate `agenthub` service；health HTTP `200`、容器 `running/healthy`，其他 14 个容器未变；即时回滚快照位于 `/volume2/Project/.agenthub/central/deployments/20260908T180958Z-pre-mobile-tabs/`；
- 最新未登录四视口 smoke 见 [`docs/qa/visual/v1.1.0/13-deployed-login-20260909-mobile-tabs.json`](qa/visual/v1.1.0/13-deployed-login-20260909-mobile-tabs.json)，仍不等同认证 Workspace/Agent/PTY 完整验收。

### Command Bar 第三轮直接迁移追加（2026-09-09）

- 按 PinHarness `ChatCommandBar` 的真实层级重排 Composer：输入区只保留编辑与 slash command，底部工具栏承载上下文、Approval、运行状态、Session 配置、快捷键提示和发送/停止同位变形；移除旧输入区按钮和重复对话标题；
- 代码提交 `26afa55560fe51e1a2a1c1f3924c5cbf03044457` 已推送 `main`；全仓 `pnpm lint`、`pnpm typecheck`、Workspace/Composer Vitest（3 files，26/26）、Web build、`pnpm format:check`、四视口 Workspace mock Playwright（4/4）均通过；
- 当前生产镜像为 `agenthub:2026.9.9-v4`，image ID `sha256:8618522cbdda35a7c6d48c0428b85a310b632e8ccc491f56c5bf6d1d56090958`，OCI revision `26afa55560fe51e1a2a1c1f3924c5cbf03044457`，架构 `linux/arm64`；
- 2026-09-09 02:40:20（Asia/Shanghai）仅 recreate `agenthub` service；health HTTP `200`、容器 `running/healthy`、exit `0`、OOM `false`；`2026.9.9-v3`、`2026.9.9-v2` 与 1.0.0 回滚镜像均保留；
- 部署前快照与有效 Compose 配置保存在 `/volume2/Project/.agenthub/central/deployments/20260908T183609Z-pre-commandbar/`；未执行 `docker compose down`，未触碰数据卷和其他 Compose service；
- NAS-local Playwright 未登录静态 smoke 见 [`docs/qa/visual/v1.1.0/14-deployed-commandbar-20260909.json`](qa/visual/v1.1.0/14-deployed-commandbar-20260909.json)，四视口 HTTP `200`、无横向溢出、console/page/request error 为 `0`；认证 Workspace、真实 Agent/PTY、性能和独立视觉复核仍未验证。

### 首页信息流第四轮直接迁移追加（2026-09-09）

- 按 PinHarness `HomePage` 的真实信息层级收敛首页：去掉大块渐变 Hero，改为轻量工作台头部、实体数据概览卡和最近项目/需要处理/最近工作信息流；原有 REST 数据、链接和空态语义保持不变；
- 代码提交 `50eeb3647f357fcb124d083e1a68f0541f39aa4e` 已推送 `main`；Web typecheck、Home lint/format、Home 桌面/手机 Playwright mock（2/2）与 Web build 均通过；
- 当前生产镜像为 `agenthub:2026.9.9-v5`，image ID `sha256:cd7587784e8f6a103e46be583cce4e300e9d8de25b55b4813fb1d345c5d28e66`，OCI revision `50eeb3647f357fcb124d083e1a68f0541f39aa4e`，架构 `linux/arm64`；
- 2026-09-09 02:54:25（Asia/Shanghai）仅 recreate `agenthub` service；health HTTP `200`、容器 `running/healthy`、exit `0`、OOM `false`；`2026.9.9-v4`、`2026.9.9-v3`、`2026.9.9-v2` 与 1.0.0 回滚镜像均保留；
- 部署前快照与有效 Compose 配置保存在 `/volume2/Project/.agenthub/central/deployments/20260908T184849Z-pre-home/`；未执行 `docker compose down`，未触碰数据卷和其他 Compose service；
- NAS-local Playwright 未登录静态 smoke 见 [`docs/qa/visual/v1.1.0/15-deployed-home-20260909.json`](qa/visual/v1.1.0/15-deployed-home-20260909.json)，四视口 HTTP `200`、无横向溢出、console/page/request error 为 `0`；认证 Workspace、真实 Agent/PTY、性能和独立视觉复核仍未验证。

### 共享 primitives 第七轮直接部署追加（2026-09-09）

- 将直接迁移的 PinHarness Button、Card、Badge、Input、Textarea、Skeleton 与 `cn` 收归 `@agenthub/ui`，页面不再从 `apps/web/src/pinharness/ui` 私有入口引用；保留现有 AgentHub 领域契约；
- `qa:css-budget` 增加唯一 PinHarness source snapshot 的 provenance/独立上限，feature CSS 仍按原有严格预算检查；
- 代码提交 `db68ed11429f1c88c3a0e34558044b3dbe0b83fe` 已推送 `main`；共享包 7 files/26 tests、全量 Vitest 71 files/296 passed、全仓 lint/typecheck/build、Web mock Workspace/页面门禁均通过；
- Home 深色主题 Playwright 在 desktop-1440/mobile-390 2/2 通过，覆盖 `.dark`、`color-scheme`、画布非白和横向溢出；
- `db68ed1` 候选 HEAD 完整四视口 web-shell 矩阵 48/48 通过（desktop-1440、desktop-1024、tablet-768、mobile-390，含 axe serious/critical 检查）；
- 当前生产镜像为 `agenthub:2026.9.9-v8`，image ID `sha256:263b904a2448a2cb44b2293f42baca6f08f06473c186dd19dcf1d6653c06a30a`，OCI revision `db68ed11429f1c88c3a0e34558044b3dbe0b83fe`，架构 `linux/arm64`；
- 2026-09-09 04:31:59（Asia/Shanghai）仅 recreate `agenthub` service；health HTTP `200` 返回 `version: 1.1.0`，容器 `running/healthy`，其他容器 identity 未变；
- 部署前快照位于 `/volume2/Project/.agenthub/central/deployments/20260908T203142Z-pre-shared-primitives/`；v7、v6/v5/v4/v3/v2 与 1.0.0 回滚镜像均保留；
- NAS-local Playwright 未登录静态 smoke 证据见 [`docs/qa/visual/v1.1.0/18-deployed-shared-primitives-20260909.json`](qa/visual/v1.1.0/18-deployed-shared-primitives-20260909.json)，四视口 HTTP `200`、无横向溢出、console/page/request error 为 `0`；认证后的深色 Workspace、Agent/PTY 与完整视觉验收仍未验证。

### 共享布局组件第八轮直接迁移追加（2026-09-09）

- 将 PinHarness 结构同源的 `ThreeColumnSplit` 从 `apps/web` 私有路径直接迁移至 `@agenthub/ui` 共享入口；Workspace 改为使用共享导出，保留三栏拖拽、折叠、断点 tabs 与 localStorage 比例约束；
- 代码提交 `d759bff62f55001aa23a7447a4992f102158963a` 已推送 `main`；共享布局断点/偏好测试与 primitives/provider 聚焦套件为 3 files、6 passed，`@agenthub/ui` 全套 Vitest 为 8 files、28 passed；`@agenthub/ui`/Web typecheck、全仓 lint/typecheck/build、CSS budget、format 与 diff check 均通过；
- 当前生产镜像为 `agenthub:2026.9.9-v9`，image ID `sha256:176dfc9c003ac875faf7ebb4d4e8ec08e1e28a2305d8f48c68b4f490f184b50e`，OCI revision `d759bff62f55001aa23a7447a4992f102158963a`，架构 `linux/arm64`；
- 2026-09-09 05:26:26（Asia/Shanghai）仅 recreate `agenthub` service；health HTTP `200` 返回 `version: 1.1.0`、`database: pglite`、`web: true`，容器 `running/healthy`、exit `0`、OOM `false`；其它容器 name/image identity 未变；
- 部署前快照、v8/v9 image inspect、容器清单和有效 Compose 配置保存在 `/volume2/Project/.agenthub/central/deployments/20260908T212617Z-pre-shared-layout/`；`agenthub:2026.9.9-v8` 与 1.0.0 回滚镜像均保留；
- NAS-local Playwright 未登录真实入口 smoke 证据见 [`docs/qa/visual/v1.1.0/19-deployed-shared-layout-20260909.json`](qa/visual/v1.1.0/19-deployed-shared-layout-20260909.json)：1440/1024/768/390 四视口均 HTTP `200`、标题 `AgentHub`、无横向溢出，console/page/request error 均为 `0`；认证 Workspace、Agent/PTY 与完整视觉验收仍未验证；
- 布局迁移后的本地 fixture 全矩阵在 NAS Chromium 资源抖动下多次中断/出现加载竞态；此前 `db68ed1` 的 48/48 是迁移前证据，不能冒充迁移后全量结果；迁移后布局相关 Workspace/Home/Prompt 四视口子集 12/12 通过，页面语义子集在 ready/WS 隔离后通过。

### PinHarness 样式共享包第九轮直接迁移追加（2026-09-09）

- 将 PinHarness 的真实 `globals.css` 源快照（约 95KB，保留 provenance 注释和 token/组件规则）从 `apps/web/src/pinharness/pinharness.css` 原位迁移至 `packages/ui/src/pinharness.css`，由 `@agenthub/ui/pinharness.css` 统一导出；页面不再维护一份 app 私有样式副本；
- 仅对 Tailwind `@source` 扫描路径做包目录适配，未重写 PinHarness 的视觉规则；AgentHub 继续复用现有 Geist、Phosphor、Motion、Mantine 封装和领域组件，业务数据/REST/WebSocket 契约不变；
- 代码提交 `036cd71e810d3bb09aae0101a785ef341e574bc4` 已推送 `main`；`@agenthub/ui` 与 Web production build、`pnpm qa:css-budget`、共享样式边界测试（2 files，14 passed）均通过；
- 当前生产镜像为 `agenthub:2026.9.9-v10`，image ID `sha256:c60c0a21759b7d54a053a5ce519a86b0633a347e308491d680d43620f9e3720e`，OCI revision `036cd71e810d3bb09aae0101a785ef341e574bc4`，架构 `linux/arm64`；
- 2026-09-09 08:42:12（Asia/Shanghai）仅 recreate `agenthub` service；health HTTP `200` 返回 `version: 1.1.0`、`database: pglite`、`web: true`，容器 `running/healthy`、exit `0`、OOM `false`；v9、v8 及 1.0.0 回滚镜像均保留；
- 部署前快照、有效 Compose 配置和回滚材料保存在 `/volume2/Project/.agenthub/central/deployments/20260909T004200Z-pre-shared-pinharness-css/`；未执行 `docker compose down`，未触碰数据卷和其他 Compose service；
- NAS-local Playwright 未登录真实入口 smoke 证据见 [`docs/qa/visual/v1.1.0/20-deployed-shared-pinharness-css-20260909.json`](qa/visual/v1.1.0/20-deployed-shared-pinharness-css-20260909.json)：1440/1024/768/390 四视口均 HTTP `200`、标题 `AgentHub`、无横向溢出，console/page/request error 均为 `0`；认证 Workspace、Agent/PTY 与独立视觉复核仍未验证。

### WorkspaceLayoutV2 共享契约第十轮直接迁移追加（2026-09-09）

- 将 `WorkspaceLayoutV2` 作为共享 UI 类型收归 `@agenthub/ui`，Workspace feature 的 `WorkspaceLayoutPreference` 保留兼容别名；旧 v1/stage/localStorage key 的读取、clamp、迁移和写回逻辑不变；
- 代码提交 `7468e3865c9f96be1423a42e236cbd512e9820a4` 已推送 `main`；UI/Web typecheck、`packages/ui/src/workbench.test.tsx` 与 `layoutPreferences.test.ts`（2 files，6 passed）、UI/Web build 均通过；
- 当前生产镜像为 `agenthub:2026.9.9-v11`，image ID `sha256:84f8783b3e7ffb87c49643d2706919e460bdd818fdee63e33e30a14228c4944d`，OCI revision `7468e3865c9f96be1423a42e236cbd512e9820a4`，架构 `linux/arm64`；
- 2026-09-09 09:08:40（Asia/Shanghai）仅 recreate `agenthub` service；health HTTP `200` 返回 `version: 1.1.0`、`database: pglite`、`web: true`，容器 `running/healthy`、exit `0`、OOM `false`；v10、v9 及 1.0.0 回滚镜像均保留；
- 部署前快照、v10/v11 inspect、容器清单和有效 Compose 配置保存在 `/volume2/Project/.agenthub/central/deployments/20260909T010825Z-pre-workspace-layout-contract/`；未执行 `docker compose down`，未触碰数据卷和其他 Compose service；
- NAS-local Playwright 未登录真实入口 smoke 证据见 [`docs/qa/visual/v1.1.0/21-deployed-workspace-layout-contract-20260909.json`](qa/visual/v1.1.0/21-deployed-workspace-layout-contract-20260909.json)：1440/1024/768/390 四视口均 HTTP `200`、标题 `AgentHub`、无横向溢出，console/page/request error 均为 `0`；认证 Workspace、Agent/PTY 与独立视觉复核仍未验证。

### PinHarness Slot 组件语义第十一轮直接迁移追加（2026-09-09）

- 为避免“看起来像组件但实际是 `<span>`”的私有替代，将 PinHarness Button 的 `asChild` 实现恢复为原始 `@radix-ui/react-slot`，链接/路由触发器继续保持真实元素语义和同一视觉 token；
- 代码提交 `393a4d623921b6cbdd22142169d3188b4dc49d00` 已推送 `main`；PinHarness primitives 回归测试（1 file，2 passed）、UI/Web lint/typecheck/build、Prettier 与 diff check 均通过；
- 当前生产镜像为 `agenthub:2026.9.9-v12`，image ID `sha256:2b0c6c230105324204c101f5c89516b034d8b9cb929e0d6ec41fded23c00674f`，OCI revision `393a4d623921b6cbdd22142169d3188b4dc49d00`，架构 `linux/arm64`；
- 2026-09-09 09:24:39（Asia/Shanghai）仅 recreate `agenthub` service；health HTTP `200` 返回 `version: 1.1.0`、`database: pglite`、`web: true`，容器 `running/healthy`、exit `0`、OOM `false`；v11、v10 及 1.0.0 回滚镜像均保留；
- 部署前快照、v11/v12 inspect、容器清单和有效 Compose 配置保存在 `/volume2/Project/.agenthub/central/deployments/20260909T012428Z-pre-slot-button/`；未执行 `docker compose down`，未触碰数据卷和其他 Compose service；
- NAS-local Playwright 未登录真实入口 smoke 证据见 [`docs/qa/visual/v1.1.0/22-deployed-slot-button-20260909.json`](qa/visual/v1.1.0/22-deployed-slot-button-20260909.json)：1440/1024/768/390 四视口均 HTTP `200`、标题 `AgentHub`、无横向溢出，console/page/request error 均为 `0`；认证 Workspace、Agent/PTY 与独立视觉复核仍未验证。

### PinHarness Radix Tabs 第十二轮直接迁移追加（2026-09-09）

- 将 PinHarness 的 Radix Tabs 基座（`Tabs`、`TabsList`、`TabsTrigger`、`TabsContent`）直接迁移至 `@agenthub/ui`，Workspace 移动视图和 Inspector 不再使用仅有 context 的私有 `AhTabs`；URL、InspectorTab 和业务数据契约保持不变；
- 新增 `@radix-ui/react-tabs@1.1.13`，共享测试覆盖 `data-state`、`aria-selected`、tabpanel 关系和键盘可访问基础；
- 代码提交 `214f92cc0623810e544b284912c2e75717ace9cf` 已推送 `main`；PinHarness primitives 3/3、WorkspacePage 19/19、UI/Web lint/typecheck/build、Workspace desktop/mobile Playwright 2/2、Prettier 与 diff check 均通过；
- 当前生产镜像为 `agenthub:2026.9.9-v13`，image ID `sha256:e63e91121b32ecf5efae9c3a006d966e90e7eaabc25cae45402b1aa96142d7cc`，OCI revision `214f92cc0623810e544b284912c2e75717ace9cf`，架构 `linux/arm64`；
- 2026-09-09 09:45:43（Asia/Shanghai）仅 recreate `agenthub` service；health HTTP `200` 返回 `version: 1.1.0`、`database: pglite`、`web: true`，容器 `running/healthy`、exit `0`、OOM `false`；v12、v11 及 1.0.0 回滚镜像均保留；
- 部署前快照、v12/v13 inspect、容器清单和有效 Compose 配置保存在 `/volume2/Project/.agenthub/central/deployments/20260909T014529Z-pre-radix-tabs/`；AgentHub 之外的容器 identity diff 为空；`openclaw-custom` 仅在快照间从 `unhealthy` 自行恢复为 `healthy`，未被本次部署重建；
- NAS-local Playwright 未登录真实入口 smoke 证据见 [`docs/qa/visual/v1.1.0/23-deployed-radix-tabs-20260909.json`](qa/visual/v1.1.0/23-deployed-radix-tabs-20260909.json)：1440/1024/768/390 四视口均 HTTP `200`、标题 `AgentHub`、无横向溢出，console/page/request error 均为 `0`；认证 Workspace、Agent/PTY 与独立视觉复核仍未验证。

### PinHarness Radix Select 第十三轮直接迁移追加（2026-09-09）

- 将 PinHarness 的 Radix Select 基座直接迁移至 `@agenthub/ui`，Composer 的 Session 配置由共享 Select 渲染模型、运行模式、推理强度；原生 `<select>` 和 feature 私有下拉样式已移除，REST/配置更新契约不变；
- 代码提交 `1224e1eda0c208f4885ea68de533a8d4e9f4269f` 已推送 `main`；PinHarness/Session 配置聚焦测试 5/5、WorkspacePage 16/16、UI/Web lint/typecheck/build、Prettier 与 diff check 均通过；
- 当前生产镜像为 `agenthub:2026.9.9-v14`，image ID `sha256:466fbbb73349a675a96864663a04602284fd8e025af5e01bbb8c3e0e053b55a2`，OCI revision `1224e1eda0c208f4885ea68de533a8d4e9f4269f`，架构 `linux/arm64`；
- 2026-09-09 10:03:23（Asia/Shanghai）仅 recreate `agenthub` service；health HTTP `200` 返回 `version: 1.1.0`、`database: pglite`、`web: true`，容器 `running/healthy`、exit `0`、OOM `false`；v13、v12 及 1.0.0 回滚镜像均保留；
- 部署前快照、v13/v14 inspect、容器 identity 清单和有效 Compose 配置保存在 `/volume2/Project/.agenthub/central/deployments/20260909T020308Z-pre-radix-select/`；AgentHub 之外的容器 identity diff 为空；
- NAS-local Playwright 未登录真实入口 smoke 证据见 [`docs/qa/visual/v1.1.0/24-deployed-radix-select-20260909.json`](qa/visual/v1.1.0/24-deployed-radix-select-20260909.json)：1440/1024/768/390 四视口均 HTTP `200`、标题 `AgentHub`、无横向溢出，console/page/request error 均为 `0`；认证 Workspace、Agent/PTY 与独立视觉复核仍未验证。

### Composer 与运行状态控件第十五轮直接迁移追加（2026-09-09）

- Composer 上下文入口、发送/停止同位按钮、Session 配置触发器和 Closed 状态继续按钮改用 `@agenthub/ui` 导出的 PinHarness `Button`；用户消息气泡改为实体 `primary-soft` surface，去除渐变噪声；AgentHub 的 Run/Approval/REST/WS 行为不变；
- 代码提交 `92b9bcec94061c3140500bae4c6bc7877f3d097f` 已推送 `main`；Workspace Vitest 9 files/41 passed，Web typecheck/build、目标 ESLint、Prettier 与 `git diff --check` 均通过；
- 当前生产镜像为 `agenthub:2026.9.9-v18`，image ID `sha256:9a060418567bf8a62945bf047582d36a403fb6d965f4549c52ca80da50c3e081`，OCI revision `92b9bcec94061c3140500bae4c6bc7877f3d097f`，架构 `linux/arm64`；2026-09-09 10:58:19（Asia/Shanghai）仅 recreate `agenthub` service，容器 `running/healthy`、exit `0`、OOM `false`，health HTTP `200` 返回 `version: 1.1.0`、`database: pglite`、`web: true`；
- v18 部署前快照、v17/v18 inspect、Compose 配置和容器清单保存在 `/volume2/Project/.agenthub/central/deployments/20260909T025331Z-pre-composer-controls/`；AgentHub 之外的容器 name/ID/image identity 未变；
- NAS-local Playwright 未登录真实入口 smoke 证据见 [`docs/qa/visual/v1.1.0/26-deployed-composer-controls-20260909.json`](qa/visual/v1.1.0/26-deployed-composer-controls-20260909.json)：1440/1024/768/390 四视口均 HTTP `200`、标题 `AgentHub`、无横向溢出，console/page/request error 均为 `0`；认证 Workspace、Agent/PTY、性能、备份恢复和独立视觉复核仍未验证。

### 全站共享 Button 桥接第十六轮直接迁移追加（2026-09-09）

- `@agenthub/ui` 的旧 `AhButton/AhIconButton` 兼容入口现在直接渲染 PinHarness `Button`，统一变体、尺寸、loading、图标、全宽和 focus token；Home、Projects、Agents、Prompt Library、Settings 等仍使用旧 API 的页面不再落入旧 `.ah-button` 外观，业务调用与路由契约保持不变；
- 代码提交 `b5e2770a5c1ba6ef725b97462769ef92b0511661` 已推送 `main`；UI primitives/App 聚焦测试 4 files/20 passed，Workspace 9 files/41 passed，UI/Web typecheck/build、全仓 lint/format 与 `git diff --check` 均通过；
- 当前生产镜像为 `agenthub:2026.9.9-v19`，image ID `sha256:8f232ff72f446b3e29cd07f765fa632261d5a1324bd24c4d701aedae06ea8f9b`，OCI revision `b5e2770a5c1ba6ef725b97462769ef92b0511661`，架构 `linux/arm64`；2026-09-09 11:15:28（Asia/Shanghai）仅 recreate `agenthub` service，容器 `running/healthy`、exit `0`、OOM `false`，health HTTP `200` 返回 `version: 1.1.0`、`database: pglite`、`web: true`；
- v19 部署前快照、v18/v19 inspect、Compose 配置和容器清单保存在 `/volume2/Project/.agenthub/central/deployments/20260909T031036Z-pre-shared-button-bridge/`；AgentHub 之外的容器 name/ID/image identity 未变；
- NAS-local Playwright 未登录真实入口 smoke 证据见 [`docs/qa/visual/v1.1.0/27-deployed-shared-button-bridge-20260909.json`](qa/visual/v1.1.0/27-deployed-shared-button-bridge-20260909.json)：1440/1024/768/390 四视口均 HTTP `200`、标题 `AgentHub`、无横向溢出，console/page/request error 均为 `0`；认证 Workspace、Agent/PTY、性能、备份恢复和独立视觉复核仍未验证。

### PinHarness 字段组件第十七轮直接迁移追加（2026-09-09）

- `AhInput`、`AhTextarea`、`AhThemeSelect` 和通用错误重试按钮改为直接复用 PinHarness `Input`、`Textarea`、Radix `Select`、`Button`；保留原有表单 label、description、required、adornment、ref 和业务回调契约，Projects/Agents/Prompt/Settings/Command Palette 统一使用同一套字段 token；
- 代码提交 `d5f0f7fb7c4c4881f35000b6149c97360ea92c9a` 已推送 `main`；字段/共享 primitives/App/Workspace 聚焦测试 16 files/73 passed，四视口 web-shell 48/48（含 axe serious/critical）通过；UI/Web typecheck/build、全仓 lint/format 与 `git diff --check` 均通过；
- 当前生产镜像为 `agenthub:2026.9.9-v20`，image ID `sha256:155a7c7316b090007165b5526d5199de964f3b8946a42f23b48502a468bea33c`，OCI revision `d5f0f7fb7c4c4881f35000b6149c97360ea92c9a`，架构 `linux/arm64`；2026-09-09 11:57:38（Asia/Shanghai）仅 recreate `agenthub` service，容器 `running/healthy`、exit `0`、OOM `false`，health HTTP `200` 返回 `version: 1.1.0`、`database: pglite`、`web: true`；
- v20 部署前快照、v19/v20 inspect、Compose 配置和容器清单保存在 `/volume2/Project/.agenthub/central/deployments/20260909T035051Z-pre-pinharness-fields/`；AgentHub 之外的容器 name/ID/image identity 未变；
- NAS-local Playwright 未登录真实入口 smoke 证据见 [`docs/qa/visual/v1.1.0/28-deployed-pinharness-fields-20260909.json`](qa/visual/v1.1.0/28-deployed-pinharness-fields-20260909.json)：1440/1024/768/390 四视口均 HTTP `200`、标题 `AgentHub`、无横向溢出，console/page/request error 均为 `0`；认证 Workspace、Agent/PTY、性能、备份恢复和独立视觉复核仍未验证。

### PinHarness Button 第十四轮直接迁移追加（2026-09-09）

- Workspace 对话 Approval、Composer 停止失败、Context 解析失败/应用变量操作改为直接使用 `@agenthub/ui` 导出的 PinHarness `Button`，移除这些路径上的 Mantine `AhButton` 兼容层；按钮语义、`variant`、禁用态和 destructive 状态沿用 PinHarness primitive，AgentHub 的 Approval/REST/WS 行为不变；
- 代码提交 `f2c7b665ef9bae03c633ce66583e7c408485dd75` 已推送 `main`；WorkspacePage/Conversation 定向 Vitest 2 files、24/24 通过；Web typecheck/build、三文件 ESLint/Prettier、`git diff --check` 均通过；
- 首次 v15 构建使用短 revision，未作为最终候选保留；随后以同一已推送 commit 的完整 SHA 构建 v16，OCI metadata 核验为 `arm64`、version `1.1.0`、full revision `f2c7b665ef9bae03c633ce66583e7c408485dd75`；v15/v16 镜像均未删除；
- 当前生产镜像为 `agenthub:2026.9.9-v16`，image ID `sha256:f104a428cd713a5a3a2941eb04f156b7903d50e12f3836d568f009d96c164d5f`；2026-09-09 10:30:04（Asia/Shanghai）仅 recreate `agenthub` service，容器 `running/healthy`、exit `0`、OOM `false`，health HTTP `200` 返回 `version: 1.1.0`、`database: pglite`、`web: true`；
- v16 部署前快照、v15/v16 inspect、Compose 配置和容器清单保存在 `/volume2/Project/.agenthub/central/deployments/20260909T022338Z-pre-direct-button-v16/`；AgentHub 之外的容器 name/ID/image identity 未变；
- NAS-local Playwright 未登录真实入口 smoke 证据见 [`docs/qa/visual/v1.1.0/25-deployed-direct-button-20260909.json`](qa/visual/v1.1.0/25-deployed-direct-button-20260909.json)：1440/1024/768/390 四视口均 HTTP `200`、标题 `AgentHub`、无横向溢出，console/page/request error 均为 `0`；认证 Workspace、Agent/PTY、性能、备份恢复和独立视觉复核仍未验证。

### 深色主题桥接第六轮直接部署追加（2026-09-09）

- 修复主题 Provider 与 PinHarness `.dark` 根类之间的断链：保留 `data-agenthub-theme` 兼容契约，同时同步根 class，确保 PinHarness 深色 token、组件和滚动条样式实际生效；
- 代码提交 `c23770ae2b91a01a146f51ee78be5efbd693222f` 已推送 `main`；`@agenthub/ui` provider 3/3、App 12/12、全仓 lint/typecheck、Web build 均通过；
- 当前生产镜像为 `agenthub:2026.9.9-v7`，image ID `sha256:47d594bd22e9d0634307f0d964472f33b5146df7f463f295cd75ba1a3152dff6`，OCI revision `c23770ae2b91a01a146f51ee78be5efbd693222f`，架构 `linux/arm64`；
- 2026-09-09 03:47:12（Asia/Shanghai）仅 recreate `agenthub` service；health HTTP `200` 返回 `version: 1.1.0`，容器 `running/healthy`，其他容器 identity 未变；
- 部署前快照位于 `/volume2/Project/.agenthub/central/deployments/20260908T194646Z-pre-dark-theme/`；v6、v5/v4/v3/v2 与 1.0.0 回滚镜像均保留；
- NAS-local Playwright 未登录静态 smoke 证据见 [`docs/qa/visual/v1.1.0/17-deployed-dark-theme-20260909.json`](qa/visual/v1.1.0/17-deployed-dark-theme-20260909.json)，四视口 HTTP `200`、无横向溢出、console/page/request error 为 `0`；认证后的深色 Workspace、Agent/PTY 与完整视觉验收仍未验证。

### 响应式语义第五轮直接迁移追加（2026-09-09）

- 修复无 `matchMedia` 宿主下的断点判定：显式 `max/min-width` 统一读取真实 `innerWidth`，保留 Workspace 辅助 tab 的可访问语义；对话标题仅以 `sr-only` 保留测试和读屏锚点，不回退视觉层；
- 代码提交 `d12ab1df6b66732b90a15c865f3c3e5f8d724e31` 已推送 `main`；App 9/9、WorkspacePage 16/16、Workspace 四视口 Playwright 4/4、Web build、全仓 lint/typecheck 均通过；
- 当前生产镜像为 `agenthub:2026.9.9-v6`，image ID `sha256:55461561fa96e9c7c1950b2b5a3e1805d17b74569229f3d5e6974a134d34b94f`，OCI revision `d12ab1df6b66732b90a15c865f3c3e5f8d724e31`，架构 `linux/arm64`；
- 2026-09-09 03:16:22（Asia/Shanghai）仅 recreate `agenthub` service；health HTTP `200`、容器 `running/healthy`、exit `0`、OOM `false`；v5/v4/v3/v2 与 1.0.0 回滚镜像均保留；
- 部署前快照与有效 Compose 配置保存在 `/volume2/Project/.agenthub/central/deployments/20260908T190903Z-pre-responsive-semantics/`；未执行 `docker compose down`，未触碰数据卷和其他 Compose service；
- NAS-local Playwright 未登录静态 smoke 见 [`docs/qa/visual/v1.1.0/16-deployed-responsive-semantics-20260909.json`](qa/visual/v1.1.0/16-deployed-responsive-semantics-20260909.json)，四视口 HTTP `200`、无横向溢出、console/page/request error 为 `0`；认证 Workspace、真实 Agent/PTY、性能和独立视觉复核仍未验证。

## 本轮真实部署 smoke

- NAS 本地 Playwright Chromium 已连接真实 `1.1.0` 地址，未登录首页在 1440、1024、768、390 四个视口均返回 HTTP 200、页面标题 `AgentHub`，横向溢出为 0，console error/page error/request failure 均为 0；记录见 [`docs/qa/visual/v1.1.0/10-deployed-login-1440.json`](qa/visual/v1.1.0/10-deployed-login-1440.json)。
- 该 smoke 只证明真实静态登录入口可达，不等同于认证后的 Workspace、Agent/ACP、Terminal 或完整视觉验收；Chromium 记录了一个 IP origin 的 `Origin-Agent-Cluster` warning，未产生页面或请求错误。

## 代码级验证

已通过的切片门禁：

- `@agenthub/ui` typecheck/build；UI primitives/layout/workbench Vitest：6 files，25/25；
- Workspace Vitest：9 files，41/41；UI primitives/layout/workbench Vitest：6 files，25/25；ACP adapter：2 files，12/12；Terminal dock、长会话窗口与辅助栏焦点恢复均覆盖；
- `pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm build`、`pnpm qa:css-budget`、`git diff --check`；Workspace CSS 16366 bytes，小于 16384 bytes 门限；
- 全仓 Vitest（单 worker、hook/test timeout 120s，2026-09-10 Asia/Shanghai 重跑）：72 files，68 passed / 4 skipped；314 tests 中 304 passed / 10 skipped；长会话窗口用例等待上限已固定为 30s，避免 NAS 高负载下的偶发测试超时；
- 迁移后页面语义门禁：desktop-1440 高风险 Workspace/Agent/Projects/Context/Work/Sessions/Prompt/Settings 8/8 通过；四视口 Agent/Projects/Sessions 12/12 通过；fixture 注入断线 WebSocket stub，避免本地 preview 代理重连噪声干扰结果；
- Mock Playwright：最新 Workspace 四视口 `4/4` 通过（含初始跟随与 cwd 可见性）；页面语义用例已补齐异步 ready 等待，fixture 同时隔离断线 WebSocket，不把本地 preview 的重连噪声计入页面结果；fixture 仍不代表真实运行时；
- 版本真值：`pnpm release:version-truth 1.1.0 --allow-incomplete` 通过，11 个 workspace package 与 AppShell 版本一致，residues 为空；
- 已推送提交（按功能切片）：`35dfc5e`（共享 UI 基础）、`b0eee6f`（Workspace 对话）、`fe3fd7a`（全局壳层）、`444f817`（版本真值）、`a9c8037`（候选固化）、`fe2e49e`（响应式面板交互）、`dbb8b50`（Panel host 根因）、`5653772`（Workbench 样式与动效预算）、`427cf72`（验证证据）、`8c817a5`（动效与移动反馈）、`9eb3f88`（辅助栏交互）、`07705db`（轮次虚拟化）、`b188a8c`（触控目标）、`29def87`（文字密度）、`28bd4c9`（验收断言）、`17de41e`（抽屉宿主）、`1977333`（Command Bar）、`6cbc82b`（抽屉宽度）、`371203d`（移动面板测试）、`5ae223e`（初始跟随与上下文事实）、`0d0f257`（ACP 版本元数据）、`52de0c7`（忽略伪滚动）、`befa67b`（cwd 可见性断言）、`fdad2c0`（触摸位移意图）、`e77d5c1`（未测量窗口）、`2eb3bc7`（Git 按需诊断）、`9ddcca2`（长会话测试稳定性）、`1251580`（认证用户身份展示）。

## v7 认证真实部署证据

- NAS-local Chromium 使用授权账号登录成功，v7 真实 Workspace 矩阵为普通/复杂历史 Session × 1440/1024/768/390 × light/dark，共 16 个页面；每页 `scrollWidth === clientWidth`，Composer 可见，console/page/request failure 与非预期 HTTP 错误均为 0；壳层用户区显示 `Kkwans`。
- 复杂历史 Session 的归档 Project 初始只请求可用的 Git status；`/git/diff`、`/git/commits`、`/git/branches` 不再在首屏发送，移动端 Git tab 与检查器关闭按钮交互通过。截图保存在 `/tmp/agenthub-v7-auth/matrix/`，未保存认证 cookie 或密码。

## 尚未宣称完成的门禁

发布候选仍需完成真实 Agent/ACP streaming、Approval、native PTY、200% zoom/safe-area、备份恢复、性能预算和独立视觉复核。认证后的静态 Workspace 矩阵已完成，但不能替代这些运行时与独立审查证据；Mock fixture、未登录 smoke 和本地截图也不能把发布 manifest 变为 `complete: true`。对应证据仍应写入 `docs/qa/visual/v1.1.0/manifest.json`，在 `complete: true` 前不得把本版本称为完整验收通过。

- 本次生产替换是用户明确要求下的可回滚候选部署，不改变 `complete: false` 的验收结论；若后续门禁失败，使用上述备份恢复 1.0.0 Compose/`.env` 并只重建 `agenthub` service。

# 实施进度

最后更新：2026-08-15

## v0.6 当前 Goal：产品化与可用性重构

状态：`M1-M9 / UX_REFACTOR_COMPLETE · M10 / AUTOMATED_REGRESSION_READY · M11 / NAS_RELEASE_CANDIDATE_DEPLOYED · ACP/LIVE/NAS4_VERIFIED · TERMINAL_UI_READY`，尚未声明视觉验收完成。

- 已建立新的 durable Goal，范围以根目录两份 v0.6 方案文档为 Source of Truth。
- 已读取并冻结 v0.5 基线：HEAD `9040efdf`，Vitest 165 passed/7 skipped，lint、typecheck、
  build 通过；build 仍报告管理页与 CSS chunk 偏大。
- 已确认主要产品债务：`ControlPages.tsx` God Component、页面 inline form、手填 Project path/
  container ID/adapter、raw enum、缺少 discovery、PromptOS JSON/UUID 暴露和 Terminal 产品/安全缺口。
- M0 输出已落盘到 `docs/implementation/v0.6/BASELINE.md` 与
  `docs/implementation/v0.6/PRODUCT_DOD.md`，包含迁移地图、API/路径安全契约、首批十个逻辑提交
  计划与部署回滚边界。
- M0 时当前运行环境无法读取 root-only 正式 Compose 目录，也没有浏览器/Computer Use 通道；该
  基线限制已在 M11 通过受控 NAS 发布核验解决，TX5Pro 视觉验收仍保持未声明。

### 已完成切片

- M1 UI 基础层：`@agenthub/ui` 新增 `FormDialog`、`ConfirmDialog`、Field/TextField/TextArea、SelectField、Combobox、AdvancedSection、PageHeader、SectionHeader、Skeleton；继续复用 Radix Themes 与 Phosphor，没有引入第二套组件框架。
- M1 presentation layer：`apps/web/src/presentation/domain-labels.ts` 集中映射 Agent、Runtime、Prompt、Task、Run、Approval 状态，主界面不直接显示内部枚举。
- M2 discovery/backend：新增 Docker Engine socket 只读 list/inspect client、Runtime/Agent candidate/rescan/adopt API、允许根目录 filesystem API、Project candidate 扫描和 `preflight-path` 接口；adopt 时重新 inspect 并保留 container ID pinning。
- M2 UI 首段：Project 改为目录选择器 + discovered candidate Dialog；Agent 改为 Runtime/Agent 扫描、接入、启动/停止和自动 preflight；Session、Goal、Task、Prompt 创建入口改为统一 Dialog；Prompt 创建与 Version 创建改为 Dialog，key 默认为名称生成。
- M5-M7 UX：Project 支持编辑/归档 Dialog；Goal/Task 支持编辑 Dialog；已接入 Agent 支持默认模型/模式 Dialog；Prompt Version 增加结构化变量编辑器，Raw JSON 仅保留为高级模式；路由改从 `features/*/pages` 边界加载，避免新路由继续依赖 `ControlPages.tsx`。
- Agent defaults backend：新增 `PATCH /api/v1/agents/:id`，只允许更新 `defaultModel`/`defaultMode`，启动命令、adapter、target 和凭据不在此契约内。
- 自动化证据：新增 Runtime discovery、filesystem symlink/traversal、Web ordinary-user contract 测试；聚焦测试
  6 files/24 tests 通过；Remote Node App 测试覆盖 Dialog 注册、roots 和一次性注册码。
- M2/M3 安全边界：Project path preflight 现在在 UI 先展示“添加前检查”，服务端再按
  `AGENTHUB_WORKSPACE_ROOTS_JSON` 的 canonical root 做 containment；Docker mount 只接受已允许的
  realpath 根目录，未配置 allow-list 或越界 mount 不会进入文件浏览/Agent 映射。
- M5-M7 交互收口：Remote Node 注册、PromptOS Label 移动均迁移到共享 `FormDialog`；Workspace
  PromptOS provenance、PromptOS binding target/Task 状态、Overview Agent 类型和 Runtime status
  使用集中 presentation label，不再把 raw enum 直接交给普通用户。共享 Field 的必填标记与 label
  语义分离，保证 Dialog 表单可访问名称稳定。
- 错误体验：扩展前端稳定 error code 到中文下一步提示，保留原始状态只用于调试视图；Remote Node
  和 Project 的错误不再依赖 raw backend wording。
- Settings 体验：管理员密码更新与外部 API token 创建已迁移到共享 Dialog；普通用户不再在设置页
  直接面对长表单，密码字段继续复用单一可见性按钮。
- Feature 拆分：删除 `ControlPages.tsx`，Sessions、Tasks、Settings 已拥有独立实现与路由边界；
  PromptOS 保留 route shell，PromptDetail、Versions、Labels、Diff、Bindings、Playground、Context
  与 Skills 区块迁入 `features/promptos/components/PromptOsSections.tsx`。普通用户契约测试已同步
  读取 route shell 与 PromptOS sections，避免结构迁移后测试失真。
- 表单控件收口：Task 看板的 Project 筛选与 Goal/Task 主操作改用共享 `SelectField`/Radix `Button`；
  PromptOS 版本、Diff、Playground 与 Context 的写入/选择控件改用共享 Field/FormTextArea/SelectField，
  保留变量 builder 的紧凑编辑布局。新增 v0.6 feature boundary contract，防止旧 God Component、原生
  写入入口和 raw binding label 回归。
- Workspace 拆分：`WorkspacePage.tsx` 保留 Session 查询、URL 状态和布局事件；SessionRail、Conversation、
  Inspector（含 Files/Diff/Git/Run）与 Composer 迁入 `features/workspace/components/WorkspaceSections.tsx`，
  没有改动事件 cursor、Approval exactly-once、Git action 或 Terminal capability 语义。
- v0.6 版本发布收口：根包、workspace 包、共享版本常量、ACP clientInfo 与 Compose 默认值统一为
  `0.6.0`；健康接口与镜像 OCI label 均返回/标记 `0.6.0`。对应提交为 `c167d4f`，已推送
  `origin/main`。
- v0.6 自动化回归：非沙箱全仓 Vitest 通过 45 个文件、184 passed、9 skipped；TypeScript、ESLint
  与 production build 通过（Web 1715 modules transformed）。受限沙箱中的 pnpm `ENOENT` 与早先
  的监听 `EPERM` 均不作为代码失败。
- v0.6 真实集成回归：`AGENTHUB_E2E_LIVE=1 corepack pnpm test:live` 通过 4 个文件、9 个测试；新增
  一次性 Git 仓库中的真实 Codex 文件变更、工作区 Diff、selected-file stage 与 commit 证据。Remote
  Node close race 已等待 Session READY 收敛；Claude Code 的固定 `claude-agent-acp` 缺失明确保持
  `BROKEN`，Hermes 的 workspace 未映射保持 `WORKSPACE_UNMAPPED`，OpenClaw ACP 命令通过。
- discovery live 闭环已真实通过：`discovery → Runtime adopt → Agent adopt/preflight → Project →
Session → Run → Message → close`；adopt 响应现在返回最新持久化 Agent 快照，避免 READY 预检被旧
  `UNVERIFIED` 状态覆盖。live 文件并行已关闭，避免真实 Codex/PGlite 启动竞态造成假失败。
- ACP 事件归一化现在会在 `tool_call_update` 缺省 `kind`/`locations`/`title` 时继承同一工具初始事件的
  元数据，避免供应商合法的 partial update 丢失工具类型；fixture 已覆盖该回归。
- 最新 GitHub Actions release gate：run `31886283190`（commit `e11eed7`）全绿，lint、typecheck、
  test、build 与 Playwright E2E 均通过；Node.js 20 action deprecation 仅为 GitHub annotation。
- M8-M9 CSS 收敛：移除 `styles.css` 尾部 v4 补丁块，统一到 `apps/web/src/styles/design-system.css`；
  修复 Radix orange solid button 对比度后，四视口 axe 4/4、完整 Playwright E2E 24/24 通过。
- v0.6 NAS 发布：已备份正式 Compose、`.env` 与旧 browser token 至
  `/volume2/Project/.agenthub/central/deployments/20260814T045513Z-pre-v06/`，仅重建
  `/volume2/DockerProject/agenthub/docker-compose.yml` 的 `agenthub` service；正式镜像为
  `agenthub:0.6.0-nas.1`（ARM64，revision `c167d4f`），容器 `running/healthy`，健康接口返回
  `version=0.6.0`、`database=pglite`、`web=true`，端口仍为 `192.168.5.110:3210`。
- 发布边界：未执行 `docker compose down`，未删除镜像、卷、用户数据，也未修改或重启其他 Agent
  容器；正式 Compose 仍注册为 Docker project `agenthub`。真实 Agent smoke 已通过，TX5Pro/浏览器
  视觉因本轮没有可用浏览器通道仍保持未验证状态。
- 最新 ACP/live 修复已以 `agenthub:0.6.0-nas.3`（ARM64，revision `4eb548d`，image digest
  `sha256:36c54094d81b9c43ed2302593ad25464105f11fb7cc7e437ef1a87ca3cd2ce9c`）部署；升级前备份位于
  `/volume2/Project/.agenthub/central/deployments/20260815T122000Z-pre-nas3/`。容器新的 ID 为
  `f704fc2270ab15afd49ef9df9c7b184b543445a49f8592f1beef475536c5d1e9`，最终 `running/healthy`，
  健康接口仍返回 `version=0.6.0`、`database=pglite`、`web=true`，旧 `nas.2` 镜像保留。
  完整记录见 `docs/qa/nas/2026-08-15-v06-live3/`。
- discovery/live 修复已继续发布为 `agenthub:0.6.0-nas.4`（ARM64，revision `e11eed7`，image
  digest `sha256:d5a7745b70667521ac86243984013c6a3b37b8adb88efd33bd0a0680eb9b2cca`）；升级前备份位于
  `/volume2/Project/.agenthub/central/deployments/20260815T130846Z-pre-nas4/`。容器 ID 为
  `3d9ba293780758b66497987855240ab494bed68e8efe92f7645ef9c4b19ac7ec`，最终 `running/healthy`，
  健康接口返回 `version=0.6.0`、`database=pglite`、`web=true`，主机与容器 server/ACP dist
  SHA-256 一致。完整记录见 `docs/qa/nas/2026-08-15-v06-live4/`。

### 当前进行中

- 视觉与人工可用性 gate 仍未完成：当前环境没有授权的浏览器/Computer Use/TX5Pro 通道，不能把
  Playwright fixture 或 NAS `curl` 结果声明为 1440/1024/768/390 实机验收。
- 普通用户旅程的后端闭环已有自动化与真实 Codex/Remote Node 证据；Claude Code、Hermes、OpenClaw
  仍按真实 preflight 能力差异呈现，不把缺少 adapter 或 workspace 映射误报为 READY。
- M8-M9：Local Project Terminal 已接入 Workspace：能力 READY 时使用 xterm.js 连接既有 Terminal
  API 与 `terminal:<id>` topic；Docker/Remote Terminal 仍不在 v0.6 范围。NAS native binding 缺失时
  显示 `PTY_NATIVE_BINDING_UNAVAILABLE`，不伪造浏览器 PTY。

### 下一步

- 继续补齐 discovery route/service contract tests 与 CI gate；缺失 Agent 或未映射工作区必须明确记录
  `SKIP/MISSING/WORKSPACE_UNMAPPED`，并保持真实供应商能力矩阵可追踪。核心 discovery live 闭环已
  通过，后续只补齐边界和回归场景。
- 在获得授权浏览器通道后，执行 1440/1024/768/390 的视觉审查；当前 NAS v0.6 已发布，但本轮不把
  `curl`/fixture/静态 build 结果等同于 TX5Pro 视觉验收。
- 继续按普通用户旅程完善 Project → Agent → Session → Approval → Diff/Git → PromptOS → Task Review
  的真实后端证据，保持每个独立逻辑变更可回退。

## v0.5 当前 Goal：可用性闭环

- 已建立新的 durable Goal：从普通用户真实旅程出发，完成首次使用、Project → Agent →
  Session/Run → Approval → Git → PromptOS → Task Review 闭环，并完成真实后端浏览器、
  TX5Pro、Compose、GitHub 与 CI 验收。
- 已完成代码、后端、可访问性和 TX5Pro 四路只读审计。正式 Compose 与真实数据基线共捕获
  11 个桌面/移动页面状态，没有拦截 API 或伪造 WebSocket；证据见
  `docs/qa/tx5pro/2026-08-11-v05-baseline/`。
- 基线审计识别出的首次使用依赖死路、Project → Session 断链、Session 服务端安全校验、
  Workspace 分区错误、长会话事件、Approval/取消/断线恢复、Git/Task/PromptOS 审阅闭环，
  以及 URL/移动端/键盘/焦点/CSS 问题已在 V5.1–V5.4 修复。
- v0.5 产品、交互、安全、测试和回滚合同已固化为
  `docs/implementation/V0.5_USABILITY_CLOSURE.md`。
- V5.1 已完成：Project 直接进入受约束的 Session 创建；服务端重新验证 Project、Agent、
  Execution Target、cwd containment 与 symlink escape；概览补齐首次使用路径。
- V5.2 已完成：Workspace 分区错误/重试、长 Session event cursor、断线恢复/关闭、Run 取消
  deadline 已完成。Approval 已改为原子决定 + Outbox + 审计事件；含糊回执收敛为
  `UNKNOWN/DEAD` 且不盲目重投，中文界面给出下一步。
- V5.3 已完成实现：普通 Session 的 Git 面板提供 status、Diff、历史、分支和
  selected-files commit；Task Review 显示 acceptance criteria、Run/Git evidence，返工必须填写
  反馈并创建新 Session/Run；PromptOS/Skill 的 Agent/Task Binding 使用按 Project 过滤的可发现
  名称。Web、Task 与 Git 聚焦测试、typecheck 和聚焦 lint 已通过。
- V5.4 已完成：Workspace 的 Files/Diff/Git/Run 与文件路径、PromptOS 的 Prompt/Tab、Task 的
  Project/Execution/Review 均写入 URL，刷新、前进/后退和分享链接可恢复上下文；命令面板补齐
  combobox/listbox 键盘模型，Task Review 与 Session 表单错误关联字段，390 px 核心触控目标
  达到 44 px，并修复窄屏可访问名称与颜色对比度。
- V5.4 最终门禁：Web typecheck、聚焦 ESLint、production build 通过；fixture Playwright 在
  1440/1024/768/390 四档视口共 24 项全部通过，覆盖 URL 恢复、键盘返回、移动端触控、无横向
  溢出，以及 Overview/Task/Settings 的 axe serious/critical 零违规。fixture 预览没有真实
  Server，因此日志中的 `/ws` proxy `ECONNREFUSED` 是预期隔离噪声，不作为真实后端证据。
- V5.5 已完成：ephemeral Express/PGlite real-backend Playwright 3/3 通过；live gate 7/7
  通过，覆盖真实 Codex、五类 Agent preflight 与 Worktree；TX5Pro Chrome 150 最终 31/31
  通过，共 24 张截图，0 request failure、console/page error、HTTP 4xx/5xx 与外部请求。
- TX5Pro 旅程真实完成账号登录、Execution Target、Project、Codex preflight、Goal/Task、Prompt
  v1/Binding、ACP Approval、文件写入、selected-files Git commit、Task Review 与重新登录；
  确定性写入使用 CUSTOM_ACP fixture，与真实 Codex preflight 证据明确分离。证据见
  `docs/qa/tx5pro/2026-08-11-v05-closure/`。
- 实机验收发现并修复移动 Git drawer 内容收缩、Monaco 外部 CDN/CSP、DiffEditor 模型清理和
  Git commit 成功回执提前消失。最终隔离 Server、临时目录与 SSH tunnel 均已回收。
- V5.6 已完成：全量 release gate、v0.5 Compose 备份与升级、正式 NAS health/容器验收、GitHub
  推送和 CI 成功终态均已完成。正式容器当前为 `agenthub:0.5.0-nas.1`、`running/healthy`，
  回滚备份见 `docs/qa/nas/2026-08-13-v05-deployment/`；本次没有执行 `compose down`，也没有
  删除镜像、卷、用户数据或既有 Agent 容器。
- CI run `31666597711` 的 `pnpm test` 已通过 37 个文件（165 passed、7 skipped）；此前同一
  commit 的 CI 发现 `react-resizable-panels` 测试环境竞态，已由 `483bd3a` 固定统一
  `ResizeObserver` setup 后重新通过完整 CI。

## v0.4 当前 Goal：品牌、概览与性能收口

- 登录/首次设置页已重构为同一张紧凑认证卡片：品牌、场景标题和状态在一个信息层级内，
  不再保留独立钥匙区或大面积无意义留白。
- 品牌标志改为官方 Phosphor `ShareNetwork`，Web favicon 与 React UI 使用同一图形语义；
  项目不再维护手绘品牌 SVG。Phosphor Core 采用 MIT License。
- 全站密码框继续复用 `PasswordField`，并隐藏 Edge/IE 原生 reveal 控件，确保只显示右侧
  一个自定义可见性按钮；输入聚焦态统一为单层橙色描边。
- 概览已改为响应式四面板控制面：桌面采用 7/5、5/7 的错位网格，移动端单列；移除灰色
  空洞、贯穿式拼板和“等待你的决定”左侧单边强调条。项目记录只占自身内容宽度。
- 已清理管理表单、Task、PromptOS、Workspace 等现存 3px 单边强调条样式，禁止再以
  `border-left` 表达优先级。
- Web 页面已改为路由级 lazy loading，PromptOS/Workspace 样式跟随路由加载；首屏 JS 从
  645.07 kB 降至 337.15 kB，减少 47.7%，生产构建不再触发 500 kB chunk 警告。
- `agenthub:0.3.0-nas.6` 已通过绿联 Compose 无 `down` 切换，容器以 root/privileged 运行并
  恢复 healthy；旧 `nas.5` 镜像和配置备份保留，数据卷及既有 Agent 容器未修改。
- TX5Pro Chrome 150 完成 1440/1024/768/390 实机视觉验收：登录/首次设置页只有一个密码
  眼睛，概览没有灰色空洞或单边强调条，390px 卡片间距为 12px，全部尺寸无横向溢出，
  0 request failure、console/page/HTTP error 和外部请求。证据归档于
  `docs/qa/tx5pro/2026-08-10-nas6-ui-visual/`。
- 当前视觉验收使用正式部署静态资源与真实 `/api/v1/health`；首次设置和概览业务数据使用
  只读 Playwright fixture，以免创建账号或修改正式数据。该证据不替代真实后端测试。

## v0.3 Compose 迁移记录

- 用户已明确要求把 v0.3.0 从 host-native systemd 改为绿联 Docker Compose，并授权
  `user: 0:0` 与 `privileged: true`；新 durable Goal 已建立。
- 已确认此前 `192.168.5.110:3210` 拒绝连接的直接原因是 systemd 只监听
  `127.0.0.1:3210`，服务本身健康。
- 已新增 ARM64 Compose、固定 digest Dockerfile、root-only token helper、部署/回滚说明和
  ADR-014。镜像 `agenthub:0.3.0-nas.1` 已构建为 Linux ARM64 runtime，Node.js 24.19.0、
  Git 2.39.5，OCI revision 固定到部署源码 commit。
- 正式冷备份位于
  `/volume2/Project/.agenthub/central/deployments/20260810T102845Z-pre-compose/`；原
  `agenthub.service` 已停止并禁用，但 unit/env 与数据快照均保留，可回滚。
- Compose Project `agenthub` 已部署到 `/volume2/DockerProject/agenthub`，Compose 标签与
  `docker compose ls` 均将其枚举为独立项目；容器以 `0:0`、`privileged=true`、
  `restart=unless-stopped` 运行，只发布 `192.168.5.110:3210`。
- LAN 入口启用强制认证。首次 Compose 验收使用 root-only API token 完成迁移验证；用户指出
  这不适合作为普通用户登录流程后，Web 已改为首次创建唯一管理员、用户名/密码登录和
  HttpOnly Cookie，API token 只保留为折叠的外部集成能力。账号、密码 hash 和浏览器会话由
  `0003_sweet_owl.sql` 持久化，不改写既有 Project/Target/PGlite 数据。
- 首次 TX5Pro LAN 验收发现 Helmet 默认 `upgrade-insecure-requests` 会把 HTTP 静态资源升级为
  HTTPS，导致浏览器 `ERR_SSL_PROTOCOL_ERROR`；已增加显式 transport 配置并补回归测试。
  修复后 1440/1024/768/390 共 16 项检查全部通过，0 request failure、console/page/HTTP
  error 与外部请求，证据归档于 `docs/qa/tx5pro/2026-08-10-compose-lan/`。
- 部署和恢复证据见 `docs/qa/nas/2026-08-10-compose-migration/`；Claude Code、Hermes、
  OpenClaw 的 container ID、镜像和原 `exited` 状态在迁移及重启前后均未变化。
- 401 根因已复现：浏览器没有旧部署 Bearer token，受保护 REST 和 `/ws` 均正确拒绝；旧前端
  又把平台登录错误误写成“Agent 需要授权”。当前登录门禁在任何受保护 Query 前完成，401
  显示“登录已失效”，加载态、错误态、设置页双列布局与 9/12/16px 圆角层级已统一。
- 管理员登录版已更新为 `agenthub:0.3.0-nas.3`；更新前冷备份位于
  `/volume2/Project/.agenthub/central/deployments/20260810T195343-pre-account-auth/`。受控
  Compose 重启后容器恢复 healthy，首次设置状态、原 Project/Execution Target 均持久恢复，
  三个既有 Agent 容器保持原完整 ID、镜像和 `exited` 状态。
- TX5Pro Chrome 150 从 LAN 直连正式服务完成管理员首次设置页验收：1440/390 均无横向
  溢出，0 request/console/page/HTTP 错误与 0 外部请求；页面只要求用户名、密码和确认密码，
  不展示 token、Session 或命令行。证据归档于
  `docs/qa/tx5pro/2026-08-10-account-auth/`。
- 登录页视觉修订已实机完成：专属 Hub/节点 SVG 标志替换字母 A，顶部钥匙空白块移除，
  所有密码框复用带可见性按钮的 `PasswordField`，全站输入聚焦态统一为单层蓝色描边；
  TX5Pro computed style、1440/390 与截图证据归档于
  `docs/qa/tx5pro/2026-08-10-login-polish/`。

## v0.3 当前状态

- 已创建新的 durable Goal，范围为 UI/UX 重构、真实浏览器验收、host-native 部署和自身 Project 注册。
- 现场确认重构前 AgentHub 未部署：无进程、Docker 容器、systemd unit 或 `3210` 监听。正式部署固定为 host-native `systemd` 服务、`127.0.0.1:3210`，不会创建 AgentHub Docker。
- 已完成现有 UI 审计和重构：`packages/ui` 从空壳升级为官方 Radix Themes + Phosphor 组件层；移除 Web 的 Lucide 依赖，保留 Tailwind 4、TanStack Query、Monaco 与 react-resizable-panels。
- App Shell 已改为石墨中性色中文工具界面；新增可用的 `Ctrl/Cmd+K` 命令面板、skip link、连接状态和 Radix 移动导航 Dialog。
- 概览、Task、Agent、设置采用连续控制面和 1px 分隔，减少同质卡片墙；Task/Run 使用橙色“运行脊柱”表达执行阶段。
- PromptOS 和 Workspace 使用 Radix Tabs；Remote Node revoke 使用 AlertDialog；Worktree Review 使用 Dialog；重点动作使用标准 Button、Badge、Callout、Skeleton 与 IconButton。
- 移除无行为的 Session 筛选；未支持的新建 Terminal 明确 disabled 并说明 native PTY 限制；Approval 仍只展示 Agent 原始合法选项。
- Web 单元测试 10 项通过；全仓非沙箱 Vitest 33 个文件通过、3 个 live 文件按 gate 跳过，114 项通过、7 项跳过；lint、typecheck 与 production build 通过。
- TX5Pro 最终实机验收 20 项全部通过：1440/1024/768/390、真实 Codex Run、Task 人工确认、命令面板、移动导航、Workspace drawer、0 个 request/console/page/HTTP 错误和 0 外部请求。证据归档于 `docs/qa/tx5pro/2026-08-10-v03-ui/`。
- v0.3.0 已正式部署为 `agenthub.service`：`Kkwans:admin`、`enabled`、`active/running`、仅监听 `127.0.0.1:3210`，健康返回 PGlite/Web 可用；不是 Docker 部署。
- 持久目录为 `/volume2/Project/.agenthub/central/{data,worktrees}`，mode `0700`；env 为 `/etc/agenthub/agenthub.env`，mode `0640`。受控重启后健康与注册记录均恢复。
- 正式数据库已注册 `AgentHub NAS 宿主机`（`LOCAL_HOST/READY`）和 AgentHub 自身 Project（`ACTIVE`）；Project preflight 路径、权限、Git/main、AGENTS.md 与 pnpm 全部 PASS。
- 部署前后 Claude Code、Hermes、OpenClaw 容器保持原 `exited` 状态，未修改 Docker/Compose、镜像或 volume。
- 版本元数据已统一为 v0.3.0；部署证据、校验和和回滚见 `docs/qa/nas/2026-08-10-v03-deployment/`。公开 GitHub `main` 与 annotated tag `v0.3.0` 已推送。
- 最终全仓 gate 遇到 NAS `/tmp` tmpfs 100% 的 `ENOSPC` 后，没有删除其他项目缓存；改用 `/dev/shm/agenthub-test-tmp` 重跑，33 个文件通过、3 个 live 文件按 gate 跳过，114 项通过、7 项跳过。
- GitHub Actions run `31374423006` 用时 2m23s，install、lint、typecheck、test、build 和 Playwright E2E 全部通过。
- 正式服务已设置专用 `TMPDIR=/volume2/Project/.agenthub/central/tmp`，避免 NAS 全局 `/tmp` 100% 影响 Agent 子进程；更新前 env/unit 已备份，重启后进程环境、健康、Project 和容器未变性均通过。
- 设计合同与回滚见 `docs/implementation/V0.3_UI_REDESIGN.md`。

## 当前

- M0：已完成。
- M1：已完成。
- M2：已完成。
- M3：已完成。
- M4：已完成。
- M5：已完成。
- M6：已完成。
- 已创建 durable Goal。
- 已初始化 `main` 分支与 pnpm monorepo。
- 已固定 Node.js 24、pnpm 11、TypeScript、ESLint、Prettier、Vitest、Playwright 与 CI 基线。
- 已锁定 ACP v1 依赖：SDK `1.3.0`、codex-acp `1.1.14`、claude-agent-acp `0.66.0`。
- v0.1 与 v0.2 TX5Pro 实机验收均已完成；Remote Node 报告与截图归档于 `docs/qa/tx5pro/2026-08-10-remote-node/`。

## 环境事实

- NAS 架构：Linux ARM64。
- 宿主机 Codex：`0.146.0`，已有 ChatGPT 登录。
- Claude Code、Hermes、OpenClaw 通过现有 Docker 容器部署。
- Hermes 当前没有 `/volume2/Project` 工作区映射；MVP 必须返回 `WORKSPACE_UNMAPPED`，不得修改 Compose。
- OpenCode 当前宿主机未安装；live test 允许 `SKIP: MISSING`，fixture 必须通过。
- `node-pty@1.1.0` 在当前 Linux ARM64 环境无可用预构建产物，且宿主机无本地编译工具；已作为 optional dependency 安装并禁用 build script。运行时必须报告 Terminal capability=false，不得用普通 Shell 冒充 PTY。

## 验证记录

M0：

- `pnpm install --frozen-lockfile`：通过。
- `pnpm lint`：通过。
- `pnpm typecheck`：通过，9 个 workspace project 完成。
- `pnpm test`：通过，1 个文件、1 个测试。
- `pnpm build`：通过，全部 package 与 Web production bundle 完成。
- `pnpm format:check`：通过。

M1：

- 初始 migration：20 张 MVP 表，`drizzle-kit check` 通过。
- PGlite startup/migration、Prompt Version immutable、Label 事务移动、Approval exactly-once、Session seq unique/monotonic：通过。
- REST `/api/v1`、统一错误信封、request ID、Zod validation：通过。
- 单 `/ws` topic、subscribe、`afterSeq` replay 与实时 publish：通过真实本地 TCP 测试。
- Session/Run/Task 状态机与 deterministic fake adapter 的 complete/approval/cancel/fail/disconnect：通过。
- 全仓：4 个测试文件、18 个测试通过；lint、typecheck、build、format check 通过。

M2：

- Process Supervisor：绝对 executable、argv/`shell:false`、进程组、timeout、输出上限、脱敏及 protocol cancel→TERM→KILL：通过。
- Docker 显式接管：完整 container ID 复验、MANUAL/ON_DEMAND、最长工作区映射、实际 mount 复验、活动 Session 停止保护和固定 Agent 命令：通过。
- ACP v1：initialize、session/new/load/resume/close、prompt、permission、cancel、tool/file/plan/usage 归一化与真实 stdio fixture：通过。
- 五类 Agent 注册、capability 与 preflight 状态持久化：通过。
- Session/Run/Message/Event/Approval、exactly-once 决策、Git BEFORE/AFTER SHA、取消、关闭与服务重启恢复：通过。
- 全仓：12 个测试文件、45 个测试通过；lint、typecheck、build 通过。
- Codex live：`codex-acp@1.1.14` 完成 ACP v1 initialize 和 `session/new`，状态 `READY`；宿主机 Codex 仍单独报告 `0.146.0` 与 ChatGPT 已登录。
- Claude Code live：容器内 Claude Code `2.1.168` 可用，但缺少 `claude-agent-acp`，状态 `BROKEN`；未运行 `npx latest`，未修改镜像/Compose。
- Hermes live：Hermes Agent `0.10.0` 和 `hermes acp` 存在；当前 Project 无映射，AgentHub preflight 返回 `WORKSPACE_UNMAPPED`。
- OpenClaw live：OpenClaw `2026.6.11` 提供 `openclaw acp`；清洁 stdio 后 Gateway 返回 scope upgrade pending approval，状态 `AUTH_REQUIRED`；该版本未确认存在 `agent exec` 子命令，不启用回退。
- live probe 后 `claude-code`、`hermes`、`openclaw-official` 均恢复原始 `exited` 状态。

M3：

- Project add/preflight：`realpath`、目录/读写权限、Git/branch/dirty、AGENTS.md/CLAUDE.md/OpenSpec 与 package manager hints：通过。
- 只读文件树/内容：root lexical containment、realpath containment、symlink escape、`../`、绝对路径、单/双编码 traversal、大文件和二进制限制：通过。
- Git：status、Diff、commits、branches、staged/selected-files commit；selected commit 不混入其他已 staged 文件：通过。
- Run Git snapshot：BEFORE/AFTER 状态与 SHA 持久化，snapshot 失败不改变 Agent Run outcome：通过。
- Terminal：真实 `node-pty` open/input/resize/output/close 生命周期和独立 `terminal:*` topic 已实现；
  新增 `terminal.closed` 生命周期审计事件，无 native binding 时禁止 shell fallback。
- 当前 NAS runtime 诊断：`available=false`、`PTY_NATIVE_BINDING_UNAVAILABLE`、`linux/arm64`。
- M3 聚焦回归：Project/Git/Terminal/Session 共 16 项测试通过；lint、typecheck、全仓 build 通过。

M4：

- 中文 Web Shell：概览、项目、任务、Agent、会话、PromptOS、设置一级导航与共享 TanStack Query/API/WebSocket 数据层：完成。
- Dashboard 基线只呈现待批准、运行中、Agent 健康和 Project，不使用 KPI 卡片墙。
- Coding Workspace：可调多栏 Session、对话/工具/Approval、只读文件/Monaco、Diff、Git、Run 上下文和固定 Composer：完成。
- Composer 固定展示 Agent、模型、模式、Project/cwd、branch、PromptOS、Skill；模型和模式按
  capability 隐藏，Terminal 由底部 Local Project Terminal dock 单独呈现并说明真实能力状态。
- 响应式：桌面多栏，900px 以下使用 Workspace tabs 和侧边检查器，390px 使用全宽 drawer；实现导航抽屉、键盘 Escape、焦点可见和 reduced-motion。
- Agent UI：显式注册宿主机/Docker Execution Target、完整 container ID、工作区映射、启动策略、内置 Agent Profile、preflight、生命周期操作与 capability 调试视图：完成。
- UI 文案：操作、说明、表单、状态、错误和空状态使用简体中文；Agent/PromptOS/Git/Terminal/model/mode/path/branch/command/protocol/vendor data 保留原文。
- M4 回归：`pnpm lint`、`pnpm typecheck`、Web 单元测试、Web production build 均通过。

M5：

- Prompt stable identity 与 immutable Version：每次保存由事务锁定 Prompt 并分配下一版本，自动移动 `latest`；变量模板必须在 object JSON Schema 中声明。
- Label：`latest` 禁止手工移动/删除，`production` 与自定义标签支持事务移动和快速回退。
- Diff/Render：TEXT 按文本、CHAT 按 role/message JSON 结构生成 Diff；Render 返回 resolved version、label、content hash、缺失变量和最终内容。
- Binding：实现 Project → Agent → Task、同 slot priority、LABEL/VERSION selector、启停和完整 provenance。
- Run 集成：发送前解析 Context Preview；缺 required variable 阻断，成功 Run 保存 prompt/version/label/hash/binding/target 来源和 final context hash。
- Skill：只扫描 Project 内 `.agents/skills`/`.codex/skills` 的 `SKILL.md` metadata 并支持绑定；realpath containment 阻止 symlink escape，不复制 AGENTS.md/CLAUDE.md，不安装 Marketplace。
- 中文 PromptOS UI：Prompt 列表/详情、版本、标签、差异、绑定、渲染演练、上下文预览、Skill 扫描/绑定；保存按钮明确为“创建新版本”。
- Workspace Composer：展示真实 PromptOS 生效项和 provenance，支持变量 JSON 重新解析，缺变量/解析异常时禁止发送 Run。
- M5 聚焦回归：PromptOS service 7 项、Session/Run 4 项、REST 1 项、Web UI 3 项通过；`pnpm lint`、`pnpm typecheck`、全仓 build 通过。

M6：

- Goal/Task：完成 CRUD、Goal 状态、Task 看板排序与状态机、“交给 Agent 开始”、Run 完成进入待审阅、失败/取消进入受阻、用户 `APPROVE` 后才完成。
- Dashboard：只聚合运行中 Session、待 Approval、待审阅/受阻 Task、最近终态 Run、Git outcome 与 Agent 健康。
- Auth：M6 当时实现 loopback `local_trusted` 与非 loopback Bearer token。当前已由 ADR-015
  扩展为唯一管理员账号、scrypt 密码、HttpOnly Cookie 和会话撤销；API token 退居外部集成兼容路径。
- Production：Server 自动托管 `apps/web/dist` 并提供 SPA fallback；临时 production Server 使用内存 PGlite 启动，`/api/v1/health` 返回 `web=true`，`/tasks` 返回 Web index。
- 核心 E2E：确定性贯通 Project → PromptOS → Task → Agent → Approval exactly-once → Git BEFORE/AFTER → Dashboard → 人工审阅。
- 浏览器 E2E：NAS 本地 Playwright Chromium 在 1440、1024、768、390 四种视口共 12 项通过；根据 1024 截图修复 Dashboard Agent 健康区挤压。
- Live gate：Codex 真实 ACP preflight、Session、流式响应和 cancel notification 通过；Claude/Hermes/OpenClaw 容器固定命令验证通过；OpenCode 明确 `SKIP: MISSING`。
- Live gate 后 `claude-code`、`hermes`、`openclaw-official` 均恢复原 `exited` 状态，完整 container ID 未变化。
- 最终全仓 gate：`pnpm lint`、`pnpm typecheck`、`pnpm build`、`pnpm format:check` 通过；标准 Vitest 为 22 个文件通过、1 个 live 文件按环境 gate 跳过，82 项通过、5 项跳过；Playwright 12 项通过；live Vitest 5 项通过。

TX5Pro 实机验收：

- TX5Pro：Windows NT `10.0.26200.0`、Node `24.0.0`、Playwright `1.62.1`、Google Chrome `150.0.7871.182`。
- 通过 SSH local forward 访问仅监听 NAS loopback 的隔离 AgentHub，不创建 token、不复用跨项目凭据、不触碰 Docker/Compose。
- 从空 PGlite 数据库完成 Execution Target → Project → Codex preflight → Goal/Task → Session/Run stream → 待审阅 → 人工确认完成闭环。
- 修复真实 ACP 可选 `externalRunId` 与 context-only `usage_update` 导致的空 Drizzle patch；新增回归测试。
- 修复 Workspace Session 列表状态滞后，并让 App Shell 建立和维持统一全局 `/ws` 连接。
- 修复后最终单次验收 25 项全部通过；1440、1024、768、390 均无根页面横向溢出，全局 WebSocket 已连接。
- 浏览器运行时结果：0 个 request failure、0 个 console error、0 个 page error、0 个 HTTP 4xx/5xx、0 个外部请求。
- TX5Pro 修复后全量 gate：`pnpm lint`、`pnpm typecheck`、`pnpm build`、`pnpm format:check` 通过；非沙箱 Vitest 22 个文件通过、1 个 live 文件按 gate 跳过，84 项通过、5 项跳过；Playwright 12 项通过。
- 最终验收进程与 SSH 隧道已回收，TX5Pro `43210` 和 NAS `3210` 无遗留监听。

v0.2 Worktree Task Runner：

- W1：独立 Execution 状态机、`worktree_executions` migration/repository、partial unique
  index、并发状态移动和 restart recovery 已完成。
- W2：每 Project 单并发 FIFO、managed Git worktree、Agent Session/Run、Approval 等待、
  Review/Rework/Cancel、冲突预检和显式 `--no-ff` Merge Gate 已完成。
- W3：中文 Task 控制面、Execution 轨道、Review evidence、Diff、继续修改、取消和批准合并
  已完成；保留 v0.1“直接运行”入口。
- Worktree UI：单元测试 7 项通过；Playwright 1440、1024、768、390 共 12 项通过。
- Worktree live：独立临时 Git repository + PGlite + 宿主机 pinned Codex 完成真实修改、
  Review Diff、受管 commit 与双亲 merge commit；1 项通过，耗时 64.41 秒。
- Worktree 最终标准 gate：`pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm build`
  通过；Vitest 25 个文件通过、2 个 live 文件按环境 gate 跳过，97 项通过、6 项跳过。
- live fixture 已在独立 Server 关闭后清理；未触碰现有 Project、Agent Docker、Compose、
  镜像或 volume。

v0.2 Remote Node：

- R1：一次性 registration token、Ed25519 设备身份、challenge/signature、revoke、heartbeat、
  reconnect、1 MiB message limit 与 `/node/ws` gateway 已完成。
- R2：`REMOTE_NODE` Execution Target、授权 roots、Agent inventory、远程 Project preflight、
  只读文件，以及 Session/Run/Approval/cancel/close 已完成；Remote Git/Worktree/Terminal 按
  v0.2 范围明确返回 unsupported。
- Remote Node 自动化：协议、identity、gateway、daemon、repository、workflow 与安全边界
  已覆盖；v0.2 最终标准 Vitest 为 33 个文件通过、3 个 live 文件按 gate 跳过，112 项通过、
  7 项跳过。
- Remote Node UI：中文注册、一次性 secret、连接命令、在线状态、fingerprint、roots、
  inventory、诊断与 revoke 完成；Web 单元 8 项、Playwright 四视口 16 项通过。
- 真实 live：临时 PGlite + Central Server + Node daemon + 宿主机 pinned Codex 完成注册、
  远程 Project、preflight、Session stream 与 close；Assistant 返回 `REMOTE_OK`。
- TX5Pro：Windows 10 build 26200、Chrome `150.0.7871.182`，通过 SSH local forward 操作
  中文 UI；26 项检查、1440/1024/768/390、0 request failure、0 console/page error、
  0 HTTP 4xx/5xx、0 外部请求。证据见 `docs/qa/tx5pro/2026-08-10-remote-node/`。
- 验收临时 Server、Node、PGlite 与隧道已回收，NAS `3210`、TX5Pro `43210` 无遗留监听；
  未修改或启停现有 Agent Docker/Compose、镜像或 volume。
- v0.2 最终 gate：`pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm build` 全部通过；
  Playwright 四视口 16 项通过；Remote Node 与 Worktree 真实 Codex live 2 项通过，耗时
  100.08 秒。
- 为遵守“不改动现有 Agent Docker/Compose/数据”的 v0.2 Goal，最终 live 只选择 Remote Node
  与 Worktree 两个临时 fixture；会启动/停止现有 Agent 容器的 `agent-preflight.test.ts` 未重跑。
  v0.1 已归档该容器 live 结果，本次相关 Docker/Agent Profile 代码未修改。
- release gate 后临时 fixture 均已清理，NAS `3210`/TX5Pro `43210` 无遗留监听；Claude、
  Hermes、OpenClaw 容器保持原 `exited` 状态及原完整 container ID。
- v0.2.0 版本元数据、部署/API/数据库/安全/排障/发布说明、公开 GitHub main 与 tag 已完成。

## 未验证项

- Claude Code 需在镜像内固定安装 `@agentclientprotocol/claude-agent-acp@0.66.0` 后才能验证 auth/session。
- Hermes 需增加覆盖 Project 的部署级 workspace mount 后才能验证项目 Session；本次未修改 Compose。
- OpenClaw 需在原生 Gateway 中批准 scope upgrade 后才能验证 `session/new` 和 prompt；本次未替用户批准授权请求。
- 当前 NAS 无 node-pty ARM64 native binding，Terminal UI 必须显示 capability=false；未伪装 PTY。

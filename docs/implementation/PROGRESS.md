# 实施进度

最后更新：2026-08-16

## v0.6 当前 Goal：产品化与可用性重构

状态：`M1-M9 / UX_REFACTOR_COMPLETE · M10 / AUTOMATED_REGRESSION_READY · M12 / NAS11_DEPLOYED · M13 / DISCOVERY_BOUNDARY_NAS12_DEPLOYED · M14 / REMOTE_INVENTORY_NAS13_DEPLOYED · M15 / DISCOVERY_STATUS_NAS14_DEPLOYED · M16 / PROMPTOS_BINDING_UX_NAS15_DEPLOYED · M17 / TASK_REVIEW_COPY_NAS16_DEPLOYED · M18 / REMOTE_PROJECT_PATH_NAS17_DEPLOYED · M19 / ERROR_COPY_NAS18_DEPLOYED · ACP/LIVE/VENDOR_MATRIX/TERMINAL_UI_VERIFIED · VISUAL_GATE_PENDING`，尚未声明视觉验收完成。

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
- Discovery 操作反馈：新增共享 `InlineError`，为重新扫描、Runtime/Agent 接入、启动/停止、Project
  预检和默认设置失败提供 `role=alert` 的中文提示；Agent 与 Remote Node 的 adapter 展示统一通过
  `labelAdapterKind`，不直接渲染原始枚举。
- Workspace 事件展示：新增 `labelAgentEventType`，工具卡将 `tool.call.*`、`agent.plan.updated` 等
  内部事件枚举统一翻译为中文；正常对话视图不再显示原始协议值，未知事件安全降级为“执行事件”。
- 共享表单可访问性：`@agenthub/ui` 的 `Field` 将说明/错误关系绑定到真实 input、textarea、select，
  `FormTextField`/`FormTextArea` 默认提供 `autocomplete="off"` 与稳定 `name`；显式认证 autocomplete
  保持不变。聚焦测试 `apps/web/src/components/FormFields.test.tsx` 4/4 通过，决策见 `ADR-019`。
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
- v0.6 自动化回归：非沙箱全仓 Vitest 通过 48 个文件、192 passed、9 skipped；TypeScript、ESLint
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
- 最新 GitHub Actions release gate：run `31895892171`（commit `ea51790`）全绿，lint、typecheck、
  test、build 与 Playwright E2E 均通过；Node.js 20 action deprecation 仅为 GitHub annotation。
- Remote Node Project 提交 `cdb7d5b` 的 GitHub Actions run `31931214963` 已完成且 `success`；同一套
  lint、typecheck、test、build 与 Playwright E2E 门禁通过。
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
- Local Project Terminal 已以 `a6f5c16` 交付：Workspace 使用官方 `xterm.js` + `FitAddon`，复用
  `terminal:<id>` topic 和既有安全 Terminal API；Server 增加 `terminal.closed` 生命周期事件，Compose
  显式传入 `AGENTHUB_PROJECT_OWNER_UID/GID`。完整自动化回归为 45 files、184 passed、9 skipped，Web
  build 为 1715 modules transformed。
- Terminal UI nas.5 已发布：`agenthub:0.6.0-nas.5`（ARM64，image digest
  `sha256:0c30d4eb70b396febf273c86b9a7d8373a054cb4bb9aea9baff88cd15fd7ec09`，revision `a6f5c16`），容器
  `c519db777442eb0276cec5f5971b681f939558408688edaeeaf5e82b293264eb` 最终 `running/healthy`，健康接口
  返回 `version=0.6.0`、`database=pglite`、`web=true`，根页面 HTTP 200。升级前备份位于
  `/volume2/Project/.agenthub/central/deployments/20260815T141727Z-pre-nas5/`；完整记录见
  `docs/qa/nas/2026-08-15-v06-live5/`。
- NAS `linux/arm64` 当前真实 capability 为 `PTY_NATIVE_BINDING_UNAVAILABLE`；Terminal UI 显示中文原因并
  禁用打开操作，不用 Shell 模拟 PTY。Docker/Remote Terminal 仍不在 v0.6 范围。
- ARM64 native PTY nas.7 已发布：`agenthub:0.6.0-nas.7`（ARM64，image digest
  `sha256:df5e1c3a5e120e2604f8677cd4bd43a371c24d68b9135ccd82bee37cb3b4ecb9`，revision `a6f5c16`），
  容器 `cc11ab51e1e31a7bdd4b30f31dcff89efa2d39ff8dd50550d2a563a7f7c2b528` 最终 `running/healthy`，健康
  接口返回 `version=0.6.0`、`database=pglite`、`web=true`。native builder 由
  `deploy/compose/Dockerfile.nas-native` 固化，容器内 `node-pty.spawn` 可加载。
- nas.7 授权 capability 返回 `terminal.available=true`、`code=READY`、`platform=linux`、`arch=arm64`；
  真实 Project Terminal API 完成 open/input/close 烟测。备份位于
  `/volume2/Project/.agenthub/central/deployments/20260815T144927Z-pre-nas7/`，完整记录见
  `docs/qa/nas/2026-08-15-v06-live7/`。仅执行 `docker compose up -d --no-build agenthub`，未执行
  `compose down`，未删除镜像、卷、用户数据或其他 Agent 容器。
- 共享表单可访问性修复已发布为 `agenthub:0.6.0-nas.8`（ARM64，image digest
  `sha256:0da6c9e92d12fc0f1ccf39aef7837e7020543e32c68343362f30a9fab8f47174`，revision `23205f3`），
  容器 `9a8171965f9ac462ef71853ccd5820f578faeb21b7670eda841dd5fce799b169` 最终 `running/healthy`，
  `/api/v1/health` 返回 `version=0.6.0`、`database=pglite`、`web=true`。因 NAS 代理不可用，native
  重编译路径未继续；已验证的 nas.7 native base 通过 `Dockerfile.nas-overlay` 仅覆盖 server/web
  dist，独立 node-pty spawn 与真实 Terminal API open/input/close 均通过。备份位于
  `/volume2/Project/.agenthub/central/deployments/20260815T153002Z-pre-nas8/`，完整记录见
  `docs/qa/nas/2026-08-15-v06-live8/`。仅执行 `docker compose up -d --no-build agenthub`，未执行
  `compose down`，未删除镜像、卷、用户数据或其他 Agent 容器。
- Discovery 操作反馈修复已发布为 `agenthub:0.6.0-nas.9`（ARM64，image digest
  `sha256:4e95f0d4aa88faea791f0c4a146a9fbe0b6fab03750acad5bec062150c42f77b`，revision `06e4c2b`），
  容器 `db19526cecd4c70ea0c3db4cad80d599b5d35cf5a434dd56ce3122a90cc58b25` 最终 `running/healthy`，
  `/api/v1/health` 返回 `version=0.6.0`、`database=pglite`、`web=true`；授权 capability 仍为
  `terminal READY / linux arm64`，真实 Terminal open/input/close 与独立 node-pty spawn smoke 通过。
  升级前备份位于 `/volume2/Project/.agenthub/central/deployments/20260815T160630Z-pre-nas9/`，
  完整记录见 `docs/qa/nas/2026-08-15-v06-live9/`。仅执行 `docker compose up -d --no-build agenthub`，
  未执行 `compose down`，未删除镜像、卷、用户数据或其他 Agent 容器。
- Workspace 事件中文展示修复已发布为 `agenthub:0.6.0-nas.10`（ARM64，image digest
  `sha256:9ad53fbd6e9e80c2be9eec14286970d68eded41ab119eb5fb73c78e998932e2a`，revision `ea51790`），
  容器 `e732efb2aa54af8b30d8899613c20ef43f0bbcf8dee42dd6984e7c2b779febcd` 最终 `running/healthy`，
  `/api/v1/health` 返回 `version=0.6.0`、`database=pglite`、`web=true`；授权 capability 仍为
  `terminal READY / linux arm64`，真实 Terminal open/input/close 与独立 node-pty spawn smoke 通过。
  升级前备份位于 `/volume2/Project/.agenthub/central/deployments/20260815T163614Z-pre-nas10/`，
  完整记录见 `docs/qa/nas/2026-08-16-v06-live10/`。仅执行 `docker compose up -d --no-build agenthub`，
  未执行 `compose down`，未删除镜像、卷、用户数据或其他 Agent 容器。
- FormDialog 焦点与关闭控件修复已提交为 `3508d22`：打开时优先聚焦首个错误控件，关闭时恢复到触发
  按钮；Radix Dialog 关闭图标改为真实 `button`，新增 jsdom 焦点回归测试。全量 Vitest 为 48 个文件、
  `192 passed / 9 skipped / 201 total`，Playwright E2E 仍为 24/24（1440/1024/768/390 fixture）通过。
- nas.11 已发布为 `agenthub:0.6.0-nas.11`（ARM64，image digest
  `sha256:013e01d5d93b1f32131795bedde4a7b46f02ba46b819747b379ab74969d664a1`，revision `3508d22`），
  容器 `0db954ef887a897203eb5a6d86a16bc16f8bd36e54c340461633fa102ac0cc7e` 最终 `running/healthy`。
  授权 capability 仍为 `terminal READY / linux arm64`；真实 Terminal open、统一 `/ws` 订阅、input、
  close 与独立 node-pty spawn smoke 通过。升级前备份位于
  `/volume2/Project/.agenthub/central/deployments/20260815T171733Z-pre-nas11/`，完整记录见
  `docs/qa/nas/2026-08-16-v06-live11/`。仅执行 `docker compose up -d --no-build agenthub`，未执行
  `compose down`，未删除镜像、卷、用户数据或其他 Agent 容器；`.tmp-v05` 仍不存在。
- Discovery 接入边界已提交为 `123af32` 并通过 GitHub CI `31923237501`；停止、未识别或不支持的
  Runtime/Agent 候选不再显示可接入动作，服务端返回稳定 `AGENT_CANDIDATE_NOT_ADOPTABLE`，前端映射
  中文下一步提示。新增 AgentDiscovery service 测试 6 项与 discovery HTTP contract 测试 3 项，覆盖
  状态映射、停止竞态、幂等接入、参数校验和稳定错误信封。
- nas.12 已发布为 `agenthub:0.6.0-nas.12`（ARM64，image digest
  `sha256:2c51ef8148565bd6390c5f8938d4deeecd5c77234294d68976ab65f8db3db3d3`，revision
  `123af329e1a578f6f235ed4a6a251db3d9de528b`），容器
  `7181e640ac0aff13a5863c8f5698d481710e67ead1f06aa8d3403f47fe11cb6f` 最终 `running/healthy`。
  授权 capability 仍为 `terminal READY / linux arm64`；真实 Terminal API + 统一 `/ws` topic
  open/input/output/close smoke 通过（terminal `405103b9-e836-43ef-a9a5-f515aae4f8bd`）。升级前备份位于
  `/volume2/Project/.agenthub/central/deployments/20260816T030407Z-pre-nas12/`，完整记录见
  `docs/qa/nas/2026-08-16-v06-live12/`。仅执行 `docker compose up -d --no-build agenthub`，未执行
  `compose down`，未删除镜像、卷、用户数据；`.tmp-v05` 不存在。发布快照期间观察到其他项目容器
  的外部漂移，因此只对 Claude Code、Hermes、OpenClaw 四个明确受保护容器核对并确认 name/ID/image 未变。
- Remote Node inventory 已提交为 `2fbc3dc` 并通过 GitHub CI `31924583891`；统一 Agent discovery 现在会
  合并 Remote Node inventory、按 `inventoryKey` 精确选择同类 Agent、去重已注册 Agent，并把
  `ONLINE/OFFLINE/REVOKED` 与 `AVAILABLE/MISSING/BROKEN` 映射为可接入、停止、缺依赖或异常状态。
  远程 Agent 接入会保留 inventory key，并使用 Remote Node 的第一个允许 root 作为 preflight cwd；前端
  对离线、撤销、缺依赖和 inventory 无效状态提供中文下一步提示。新增服务端、路由、Agent 选择和 Web
  discovery 契约测试。
- nas.13 已发布为 `agenthub:0.6.0-nas.13`（ARM64，image digest
  `sha256:44c4049fc919957c6e3a45356ba433d7650468d1ed9a032e13835bbcd4b4442f`，revision
  `2fbc3dc18a60be3fbaf7a07bb4fe46d15303bc56`），容器
  `cda2a499d7770e3db8aaa0f11e476a0b71b1ddb863d1c2cd1053ef75de339ee0` 最终 `running/healthy`。
  授权 capability 仍为 `terminal READY / linux arm64`；构建时与运行时 `node-pty`、真实 Terminal API
  与统一 `/ws` topic open/input/output/close smoke 均通过（terminal
  `c1b0f42f-8b6e-4094-99b8-410545308fea`）。升级前备份位于
  `/volume2/Project/.agenthub/central/deployments/20260816T034029Z-pre-nas13/`，完整记录见
  `docs/qa/nas/2026-08-16-v06-live13/`。仅执行 `docker compose up -d --no-build agenthub`，未执行
  `compose down`，未删除镜像、卷、用户数据；`.tmp-v05` 不存在。受保护 Claude Code、Hermes、OpenClaw
  容器的 name/ID/image 发布前后保持一致。
- Agent 状态修正已提交为 `37ebaa8` 并通过 GitHub CI `31926163032`：固定 Codex ACP 依赖存在时不再
  误报 `MISSING_DEPENDENCY`；宿主缺依赖、异常或不支持的 Agent 不再显示可接入动作；前端隐藏普通
  Docker 容器的 UNKNOWN 候选，并明确提示隐藏数量和接入前置条件。当前 NAS discovery 共返回 75 个
  候选，其中 8 个为支持的 Agent、67 个普通容器被 UI 隐藏；Codex 为 `INSTALLED`，OpenCode 为
  `MISSING_DEPENDENCY` 且不可接入。
- nas.14 已发布为 `agenthub:0.6.0-nas.14`（ARM64，image digest
  `sha256:d96ce748d45bbe48cb904bf70c33ee39e0127ec152b54098ebfaaac6b190d1c2`，revision
  `37ebaa89f32326c254ac4a9b81977f551cf32716`），容器
  `5bb92c59564f1575e94411837f7301f16963b19fe970242846e2e76cc43b9f4b` 最终 `running/healthy`。
  授权 capability 仍为 `terminal READY / linux arm64`；构建时与运行时 `node-pty`、真实 Terminal API
  与统一 `/ws` topic open/input/output/close smoke 均通过（marker `nas14-pty-ok`）。升级前备份位于
  `/volume2/Project/.agenthub/central/deployments/20260816T041830Z-pre-nas14/`，完整记录见
  `docs/qa/nas/2026-08-16-v06-live14/`。仅执行 `docker compose up -d --no-build agenthub`，未执行
  `compose down`，未删除镜像、卷、用户数据；`.tmp-v05` 不存在。受保护 Claude Code、Hermes、OpenClaw
  容器的 name/ID/image 与 live smoke 前后一致。
- PromptOS 绑定展示修复已提交为 `29d475c` 并通过 GitHub CI `31927521417`：固定版本不再向普通用户
  暴露内部 UUID，标签/删除状态与优先级统一使用中文可读文案；新增绑定列表的版本、标签和内部标识回归断言。
  全仓 Vitest 为 49 个文件通过、205 passed/9 skipped；Playwright 四视口 24/24 通过。
- nas.15 已发布为 `agenthub:0.6.0-nas.15`（ARM64，image ID
  `sha256:23213a07b30f6abbe84566f820657af8598b9ab0299aa2d8bf7f32f8f1610820`，revision
  `29d475cf723ed53eb21ec701a40287c7785bc253`），容器
  `3b89e27d871bed8a911bd2390678986b5fc6639b57760620599548bf9706dedc` 最终 `running/healthy`。
  `/api/v1/health` 返回 `status=ok`、`version=0.6.0`、`database=pglite`、`web=true`；授权 capability
  仍为 `terminal READY / linux arm64`、Remote Node `outbound_websocket`。真实 Terminal API + 统一
  `/ws` topic open/input/output/close smoke 通过（marker `nas15-pty-ok`，terminal
  `baf32fe4-56b9-4a4b-a0cb-818112e7d95d`）。升级前备份位于
  `/volume2/Project/.agenthub/central/deployments/20260816T045503Z-pre-nas15/`，完整记录见
  `docs/qa/nas/2026-08-16-v06-live15/`。仅执行 `docker compose up -d --no-build agenthub`，未执行
  `compose down`，未删除镜像、卷、用户数据；`.tmp-v05` 不存在。受保护 Claude Code、Hermes、OpenClaw
  容器的 name/ID/image 与发布前一致。
- Task/Worktree/PromptOS 用户文案收口已提交为 `51711f0` 并通过 GitHub CI `31929088781`：Task
  审阅、Git 之前/之后、基准分支、任务分支、Worktree 路径与审阅证据均不再泄漏英文内部字段；Context
  空状态的 `priority` 也已改为中文优先级。新增 v0.6 feature boundary contract，并同步更新四视口
  Playwright 断言；全仓 Vitest 为 49 个文件通过、206 passed/9 skipped，Playwright 24/24 通过。
- nas.16 已发布为 `agenthub:0.6.0-nas.16`（ARM64，image ID
  `sha256:317073aeb5540969bbaefd08f5c1d3b5731e8c93cb7978534d0b9f2b17e5813d`，revision
  `51711f0ce3936ca8d8263481f0b026bb083fa29f`），容器
  `72140d39166a2e5b536766eafc648fe3d71d7ab880afbf34d9e80474a8331b29` 最终 `running/healthy`。
  `/api/v1/health` 返回 `status=ok`、`version=0.6.0`、`database=pglite`、`web=true`；根页面 HTTP 200，
  当前 bundle 含“审阅证据”文案。授权 capability 仍为 `terminal READY / linux arm64`、Remote Node
  `outbound_websocket`。真实 Terminal API + 统一 `/ws` topic open/input/output/close smoke 通过（marker
  `nas16-pty-ok`，terminal `4766d6e2-d36a-4a4a-9d0a-689f3e0a49de`）。升级前备份位于
  `/volume2/Project/.agenthub/central/deployments/20260816T053418Z-pre-nas16/`，完整记录见
  `docs/qa/nas/2026-08-16-v06-live16/`。仅执行 `docker compose up -d --no-build agenthub`，未执行
  `compose down`，未删除镜像、卷、用户数据；`.tmp-v05` 不存在。受保护 Claude Code、Hermes、OpenClaw
  容器的 name/ID/image 与发布前一致。
- Remote Node Project 路径链路已恢复并提交为 `cdb7d5b`：授权 roots 进入统一 PathPicker，目录浏览与候选
  工程扫描通过 Remote Node 固定 `fs.list` RPC，Project 添加前预检新增目标感知的
  `POST /api/v1/projects/preflight`；相对路径、symlink/traversal 和 revoked/offline Node 均保持服务端边界。
  聚焦测试 4 files/17 tests、Remote Node workflow 1/1、全仓 Vitest 50 files/211 passed/9 skipped、
  Playwright 24/24、TypeScript、ESLint 和 production build 均通过。完整 NAS 记录见
  `docs/qa/nas/2026-08-16-v06-live17/`。
- nas.17 已发布为 `agenthub:0.6.0-nas.17`（ARM64，image ID
  `sha256:2e984c0be37cb3efc31aeacbbbf8771045058c30957f4bd1039d0a261dc1c6c2`，revision `cdb7d5b`），
  容器 `40f977973aef15382bf593b5df3c76dfed426fe72ed652c4af00da39ebe3c07e` 最终 `running/healthy`。
  `/api/v1/health` 返回 `status=ok`、`version=0.6.0`、`database=pglite`、`web=true`；根页面 HTTP 200，
  capability 为 `terminal READY / linux arm64` 与 `Remote Node outbound_websocket`。升级前备份位于
  `/volume2/Project/.agenthub/central/deployments/20260816T062241Z-pre-nas17/`。仅执行
  `docker compose up -d --no-build agenthub`，未执行 `compose down`，未删除镜像、卷、用户数据或其他
  Agent 容器；`.tmp-v05` 不存在，受保护容器完整 ID 与状态保持不变。
- M19 中文错误提示收口已提交为 `e98c65b`：修正 Remote Node 文件浏览/Git 的过期版本文案，并覆盖后端
  AppError 的中文下一步提示，避免普通用户看到原始英文错误。typecheck、lint、2 个前端 Vitest 文件
  （6 tests）和 production build 均通过，GitHub 已推送到 `main`。
- nas.18 已发布为 `agenthub:0.6.0-nas.18`（ARM64，image ID
  `sha256:f343a3054c39a266d84e6b2d03cf8cdb6136038ad986ae6ce74cb800d11567e4`，revision `e98c65b`），
  容器 `817bf63e4afeec8f1241cc1d58e3f20212ed499900a1c959d0f9327cf64dff95` 最终 `running/healthy`。
  `/api/v1/health`、授权 capability、根页面和静态 bundle 新旧文案核验均通过；升级前备份位于
  `/volume2/Project/.agenthub/central/deployments/20260816T064912Z-pre-nas18/`。仅执行
  `docker compose up -d --no-build agenthub`，未执行 `compose down`，未删除镜像、卷、用户数据或其他
  Agent 容器；`.tmp-v05` 不存在，受保护容器完整 ID 与状态保持不变。完整记录见
  `docs/qa/nas/2026-08-16-v06-live18/`。

### 当前进行中

- 视觉与人工可用性 gate 仍未完成：当前环境没有授权的浏览器/Computer Use/TX5Pro 通道，不能把
  Playwright fixture 或 NAS `curl` 结果声明为 1440/1024/768/390 实机验收。
- 普通用户旅程的后端闭环已有自动化与真实 Codex/Remote Node 证据；Claude Code、Hermes、OpenClaw
  仍按真实 preflight 能力差异呈现，不把缺少 adapter 或 workspace 映射误报为 READY。
- M8-M9：Local Project Terminal 已接入 Workspace：能力 READY 时使用 xterm.js 连接既有 Terminal
  API 与 `terminal:<id>` topic；Docker/Remote Terminal 仍不在 v0.6 范围。通用镜像缺少 native binding
  时仍显示 `PTY_NATIVE_BINDING_UNAVAILABLE`，nas.14 通过 ARM64 native base overlay 后保持 READY。
- 供应商 live capability matrix 已复跑：4 个 live 文件、9 个测试全部通过；Codex 的 preflight/session/
  stream/cancel 与一次性 Git 变更、Diff、commit 通过，Claude Code 固定 adapter 缺失保持 BROKEN，Hermes
  的 Project 映射限制保持 WORKSPACE_UNMAPPED，OpenClaw ACP 命令通过，OpenCode 缺失明确 SKIP/MISSING。
- Task/Worktree/PromptOS 的剩余英文内部字段已完成收口；下一步只保留真实浏览器视觉门禁和供应商能力差异的
  普通用户提示优化，不把 fixture、静态 bundle 或 NAS `curl` 结果提升为视觉 READY。

### 下一步

- 继续把已验证的供应商能力差异落到普通用户路径：缺失 adapter、未授权、容器停止、workspace 未映射
  和普通未知容器都必须给出明确中文下一步；不得把静态发现或 fixture 状态提升为 READY。
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
- 历史 M3 诊断记录：当时 NAS runtime 为 `available=false`、`PTY_NATIVE_BINDING_UNAVAILABLE`、`linux/arm64`；
  该状态已由当前 v0.6 nas.7 native image 验证结果 supersede，详见上方 nas.7 记录。
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
- 历史 v0.2 未验证项：当时 NAS 无 node-pty ARM64 native binding，Terminal UI 必须显示 capability=false；
  当前 v0.6 nas.7 已通过 native image 和真实 API smoke，历史记录不代表当前部署状态。

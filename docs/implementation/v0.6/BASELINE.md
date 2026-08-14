# AgentHub v0.6 基线与执行地图

最后更新：2026-08-14

## 基线范围

本文件对应 `AgentHub_v0.5_全面审计与v0.6技术方案.md` 与
`AgentHub_v0.6_任务规划与实施路线.md` 的 M0 输出。v0.6 以普通开发者完成
“发现 Project → 发现 Agent → 创建 Session → 工作 → Diff/Git/审阅”为完成标准，
不把 v0.5 的代码覆盖率或 fixture 通过等同于产品可用。

## 代码与 Git 基线

| 项目         | 结果                                       |
| ------------ | ------------------------------------------ |
| HEAD         | `9040efdf99a62a880ae60748970b27a8d868e166` |
| 分支         | `main`，跟踪 `origin/main`                 |
| 已有修改     | 无已跟踪修改                               |
| 用户新增文件 | 根目录两份 v0.6 方案文档未跟踪，保留原样   |
| 版本         | `0.5.0`                                    |
| 架构         | `aarch64`，Node 24 / pnpm workspace        |

本轮不覆盖或清理两份用户提供的方案文档。提交和 push 仍需按当前任务另行授权，
本阶段只建立可追踪实施基线。

## 自动化基线

以下命令在非沙箱环境执行，避免本地监听被沙箱 `EPERM` 阻断：

```bash
TMPDIR=/dev/shm/agenthub-v06-baseline corepack pnpm test
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm build
```

结果：

- Vitest：37 个文件通过、3 个跳过；165 个测试通过、7 个跳过。
- ESLint：通过。
- TypeScript build：通过。
- Production build：通过；当前仍有大 chunk 警告，`ControlPages` 约 92 kB、`Common`
  约 112 kB，主 CSS 约 781 kB，这是 M1 拆分与 M9 CSS 收敛的真实改进目标。

第一次在受限沙箱运行测试得到 `listen EPERM` 与未处理错误，不能作为代码回归；该
结果已保留在执行记录中，真实非沙箱基线是上面的通过结果。

## 现有文件与问题地图

| 领域      | 当前实现                                        | v0.6 迁移目标                                                                            |
| --------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Web 路由  | `apps/web/src/App.tsx`                          | 保持路由稳定，路由只负责 shell 与 query                                                  |
| 管理页面  | `apps/web/src/pages/ControlPages.tsx` 约 90 kB  | `features/projects`、`agents`、`sessions`、`tasks`、`settings`                           |
| PromptOS  | `apps/web/src/pages/PromptOsPage.tsx` 约 44 kB  | route shell + list/version/label/binding/playground/dialog 组件                          |
| Workspace | `apps/web/src/pages/WorkspacePage.tsx` 约 52 kB | 保持事件逻辑，拆 SessionRail/Conversation/Inspector/Composer/TerminalDock                |
| UI 包     | `packages/ui/src/index.ts`                      | Dialog/Form/Picker/State/DataTable/Presenter 基础层                                      |
| CSS       | `styles.css` 约 84 kB + `v3-*.css`              | 单一 token 与 feature 样式来源，删除迁移后的 inline form 补丁                            |
| 后端      | 已按领域拆分                                    | 保留 Project/Agent/Session/Task/PromptOS/Git runtime，仅新增 product interaction service |

## v0.6 文件迁移地图

```text
ControlPages.tsx
  -> features/projects/{pages,components,dialogs,pickers,hooks,schemas}
  -> features/agents/{pages,components,discovery,dialogs,hooks,schemas}
  -> features/sessions/{pages,components,dialogs,hooks,schemas}
  -> features/tasks/{pages,components,dialogs,hooks,schemas}
  -> features/settings/{pages,components,dialogs}

PromptOsPage.tsx
  -> features/promptos/{pages,components,dialogs,editors,pickers}

WorkspacePage.tsx
  -> features/workspace/{pages,components,panels,docks}
```

迁移采用可回退的增量方式：先复制边界并保持 API/行为，再替换写操作入口，最后删除
旧 inline form。未迁移的页面不与新 feature 共享隐式状态。

## Discovery API 最终契约

### Runtime

```text
GET  /api/v1/discovery/runtimes
POST /api/v1/discovery/runtimes/:candidateId/adopt
```

Runtime candidate 是短生命周期视图，不直接落库。Docker candidate 只读
`/containers/json` 与 `/containers/:id/json`，adopt 时重新 inspect 并生成现有
`execution_target`，保留 container ID pinning。

### Agent

```text
GET  /api/v1/discovery/agents?targetId=<id>
POST /api/v1/discovery/agents/rescan
POST /api/v1/discovery/agents/:candidateId/adopt
```

Candidate 统一返回 `READY`、`AUTH_REQUIRED`、`INSTALLED`、`STOPPED`、
`MISSING_DEPENDENCY`、`UNSUPPORTED` 或 `BROKEN`，并携带 source、target、版本、
认证状态和 capability preview。adopt 后服务端自动 preflight；普通 UI 不要求
executable、adapter 或 container ID。

### Server-side Project filesystem

```text
GET /api/v1/execution-targets/:id/filesystem/roots
GET /api/v1/execution-targets/:id/filesystem/directories?path=<path>
GET /api/v1/execution-targets/:id/project-candidates?root=<root>
```

目录条目返回 canonical path、Git/branch、项目 markers、package manager 和可选原因；
浏览器原生 `showDirectoryPicker()` 不进入产品主流程。

## PathPicker 安全契约

1. 根目录来自 `AGENTHUB_WORKSPACE_ROOTS_JSON` 或已授权 Remote Node roots，禁止默认开放 `/`。
2. 每次请求先校验 lexical containment，再 `realpath()`，最后再次校验 symlink containment。
3. 拒绝 `..`、编码 traversal、绝对路径越界和 symlink escape；目录深度、条目数和单次执行时间有上限。
4. 每次选择 Project 和每次 Run 前重新验证 target、mount mapping、real root 与 cwd。
5. Docker 被动发现不执行容器命令；adopt/preflight 才允许固定、argv、`shell:false` 的命令。
6. Remote Node 仅能在 daemon 上报且中央已授权的 roots 内浏览。

## UI 基础层清单

`@agenthub/ui` v0.6 只基于现有 Radix Themes、Radix primitives 与 Phosphor，不新增第二套
视觉框架：

```text
Dialog / ConfirmDialog / ResponsiveDialog / FormDialog
Field / FieldLabel / FieldDescription / FieldError / FieldGroup
TextField / TextArea / SelectField / Combobox / EntityPicker / PathPickerShell
AdvancedSection / Button / IconButton / StatusBadge / Badge
PageHeader / SectionHeader / Toolbar / DataTable
LoadingState / EmptyState / ErrorState / Skeleton / Callout
```

用户可见枚举集中在 `apps/web/src/presentation/domain-labels.ts`，raw enum 只在
Advanced/Debug 视图出现。

## 首批十个逻辑提交（计划，不代表已创建）

1. `docs(v06): 建立产品化重构基线与五级验收门禁`
2. `refactor(web): 按业务领域拆分管理页面`
3. `feat(ui): 建立统一 Dialog 与 Form 组件体系`
4. `refactor(web): 建立领域枚举展示层`
5. `feat(runtime): 增加 Docker 与本地执行环境自动发现`
6. `feat(project): 增加安全的服务端目录选择器`
7. `feat(agent): 实现本地、Docker 与 Remote Node Agent 自动发现`
8. `refactor(web): 迁移 Project、Runtime 与 Agent 写操作弹窗`
9. `refactor(promptos): 重构 Prompt、Version、Binding 产品体验`
10. `feat(session): 完成 Session/Workspace 产品化与真实 Codex smoke`

后续 Terminal、视觉收敛、QA 与 release 仍保持单一逻辑提交，不把未验证切片合并为
一个“完成”提交。

## 部署与回滚基线

- 仓库 Compose 模板：`deploy/compose/docker-compose.yml`。
- 历史正式 Compose 路径：`/volume2/DockerProject/agenthub/docker-compose.yml`。
- 已知 v0.5 NAS 回滚证据：`/volume2/Project/.agenthub/central/deployments/20260813T040918Z-pre-v05/`。
- v0.6 发布前必须重新取得目标 NAS 的当前 Compose、image、container、health、端口、
  数据目录与 checksums；本次受限运行环境无法读取 `/volume2/DockerProject/agenthub`
  的 root-only 文件，也未执行任何部署变更。
- 发布策略保持 `docker compose stop agenthub` + 备份 + `up -d --no-build` 或项目约定
  的最小替换；禁止 `compose down`、删除镜像、卷、用户数据或其他 Agent 容器。
- 回滚保留旧 image、旧 Compose、PGlite data/worktrees 与 container state，恢复后只验证
  health、登录、Project、Agent 和既有数据。

## 视觉审计限制

当前可用工具没有浏览器/Computer Use 通道，Product Design audit 无法按照截图规则捕获
本轮新鲜证据。代码审计、组件测试和 fixture/real-browser 脚本可以继续；TX5Pro 1440、
1024、768、390 的人工视觉验收只能在获得浏览器通道后记录为 `RELEASE_READY`。

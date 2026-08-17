# AgentHub 实施计划

## 成功标准

交付可运行、可追踪的 Project → Agent → Session → Approval → Diff/Git → PromptOS → Task 闭环；所有用户操作文案使用中文，专业数据保持原文；真实能力与缺失能力均由后端 preflight 驱动，不以 mock 页面代替集成。

## 里程碑

| 里程碑 | 范围                                             | 状态   |
| ------ | ------------------------------------------------ | ------ |
| M0     | 仓库、Goal、工程基线、文档与 ADR                 | 已完成 |
| M1     | 数据层、REST、WebSocket、核心领域与 fake adapter | 已完成 |
| M2     | 进程监管、Docker、ACP、五类 Agent、Session 闭环  | 已完成 |
| M3     | Project、只读文件、Git、Terminal 能力            | 已完成 |
| M4     | 中文 Web Shell 与 Coding Workspace               | 已完成 |
| M5     | PromptOS 版本、标签、绑定与 UI                   | 已完成 |
| M6     | Goal/Task、Dashboard、安全、E2E 与发布           | 已完成 |

## 每阶段门禁

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

UI 阶段增加 `pnpm test:e2e`；真实 Agent 验收使用 `AGENTHUB_E2E_LIVE=1 pnpm test:live`，但缺失 Agent 或未映射工作区必须以明确的 `SKIP/MISSING/WORKSPACE_UNMAPPED` 结果记录。

## 回滚

- 每个提交保持单一逻辑、可独立回退。
- 数据库迁移只向前追加，并在迁移说明中记录恢复方法。
- Docker live test 记录原始启动状态，只恢复启动状态，不操作 Compose、镜像与卷。
- 不自动停止运行中的容器；测试中由 AgentHub 启动且原本 stopped 的容器在 live test 收尾时恢复 stopped。

完整范围以根目录两份合同与用户已确认的实施计划为准。

## v0.2

执行顺序已经锁定：先完成 Worktree Task Runner，再完成 Remote Node。Worktree 的详细
契约、验收与回滚见 `docs/implementation/V0.2_WORKTREE.md`。

| 里程碑 | 范围                                                   | 状态   |
| ------ | ------------------------------------------------------ | ------ |
| W1     | Worktree 领域状态、迁移、repository 与安全 Git 服务    | 已完成 |
| W2     | 持久队列、Agent Run、Review/Rework/Merge 编排          | 已完成 |
| W3     | 中文任务控制面、E2E、真实 Git 验收与提交               | 已完成 |
| R1     | Remote Node 注册、设备身份与 outbound secure WebSocket | 已完成 |
| R2     | Remote target、Agent inventory、repo roots 与执行闭环  | 已完成 |
| R3     | 中文管理 UI、安全测试、live 与真实部署浏览器验收       | 已完成 |
| R4     | v0.2 文档、release gate、版本标签与 GitHub 发布        | 已完成 |

## v0.3 UI/UX 与 NAS 部署

| 里程碑 | 范围                                                          | 状态   |
| ------ | ------------------------------------------------------------- | ------ |
| U1     | 运行状态核验、设计审计、Radix/Phosphor 组件合同               | 已完成 |
| U2     | App Shell、公共组件、概览与基础管理页面                       | 已完成 |
| U3     | Task/Worktree、Workspace 与 PromptOS 重构                     | 已完成 |
| U4     | 可访问性、四视口、真实部署 Playwright 与 anti-slop pre-flight | 已完成 |
| D1     | host-native 常驻部署、健康检查与 AgentHub 自身 Project        | 已完成 |
| D2     | privileged Compose 迁移、绿联项目注册与 LAN token 验收        | 已完成 |
| D3     | 管理员登录、Cookie Session 与认证/UI 体验修订                 | 已完成 |

## v0.5 可用性闭环

v0.5 以普通用户真实旅程为唯一完成标准，详细合同见
`docs/implementation/V0.5_USABILITY_CLOSURE.md`。

| 里程碑 | 范围                                              | 状态   |
| ------ | ------------------------------------------------- | ------ |
| V5.1   | 首次使用、兼容 Agent、Session 创建与服务端校验    | 已完成 |
| V5.2   | Workspace 数据、事件、Approval、停止与恢复可靠性  | 已完成 |
| V5.3   | Git、Task Review/Rework 与 PromptOS 可发现绑定    | 已完成 |
| V5.4   | URL 状态、移动端、键盘、焦点、错误状态与 CSS 收敛 | 已完成 |
| V5.5   | 真实后端 Playwright、live 与真实部署视觉全旅程    | 已完成 |
| V5.6   | Compose 发布、文档、GitHub 与 CI 终态             | 已完成 |

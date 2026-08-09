# AgentHub v0.1 实施计划

## 成功标准

交付可运行、可追踪的 Project → Agent → Session → Approval → Diff/Git → PromptOS → Task 闭环；所有用户操作文案使用中文，专业数据保持原文；真实能力与缺失能力均由后端 preflight 驱动，不以 mock 页面代替集成。

## 里程碑

| 里程碑 | 范围                                             | 状态   |
| ------ | ------------------------------------------------ | ------ |
| M0     | 仓库、Goal、工程基线、文档与 ADR                 | 已完成 |
| M1     | 数据层、REST、WebSocket、核心领域与 fake adapter | 进行中 |
| M2     | 进程监管、Docker、ACP、五类 Agent、Session 闭环  | 待开始 |
| M3     | Project、只读文件、Git、Terminal 能力            | 待开始 |
| M4     | 中文 Web Shell 与 Coding Workspace               | 待开始 |
| M5     | PromptOS 版本、标签、绑定与 UI                   | 待开始 |
| M6     | Goal/Task、Dashboard、安全、E2E 与发布           | 待开始 |

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

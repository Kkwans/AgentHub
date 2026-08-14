# AgentHub v0.6 Product Definition of Done

v0.6 不允许使用单一 `DONE` 标记。每个 Feature 必须依次通过以下五层，且证据路径写入
`docs/implementation/PROGRESS.md` 或对应 QA 报告。

| 层级                     | 必须证明                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------- |
| `BACKEND_READY`          | service、route、Zod 校验、安全边界、unit test                                                           |
| `UI_READY`               | loading、empty、error、success、keyboard、responsive                                                    |
| `UX_READY`               | 无内部 ID、无可避免路径输入、无 raw enum、合理 defaults、discovery、progressive disclosure、Dialog/Form |
| `REAL_INTEGRATION_READY` | real backend、真实 filesystem、真实 runtime、真实 Agent（适用时）                                       |
| `RELEASE_READY`          | fixture/real E2E、4 视口视觉审查、手工用户旅程、无回归、文档、回滚证据                                  |

## P0 发布门禁

- Project 主流程不要求手输绝对路径。
- Docker Runtime 主流程不要求 container ID、hostname、os、arch。
- Agent 自动发现且普通添加流程不要求 executable/adapter。
- Prompt Kind/Type、Execution Target kind 和运行状态都有中文 presentation。
- Create/Edit 均使用 Dialog 或 responsive Sheet，不再挂载页面 inline form。
- `ControlPages.tsx` 已按业务域拆分，UI package 有正式 Dialog/Form/Field/Picker 基础层。
- Real Codex 完成 discovery → adopt → preflight → Session → turn → response → disposable repo file mutation → Diff → commit。
- Terminal 在 v0.6 明确降级为“仅 Local Project Terminal 能力诊断与安全环境边界”；浏览器端 PTY、Docker/Remote Terminal 不进入本版本 DoD，UI 不再提供伪装成可用的禁用按钮。
- 1440/1024/768/390 视觉检查、产品契约测试、CI 和 rollback evidence 全部存在。

## 普通用户 UX Gate

### Project

```text
添加 Project → 选择 Runtime → 浏览目录/选择发现的 Repository → 查看 Preflight → 添加
```

主流程允许输入名称和描述，但不要求 root path。高级选项才允许手动路径，并显示风险和
失败原因。

### Agent/Runtime

```text
设置 Runtime → 重新扫描 → 选择已发现容器/本地环境 → 确认 → 自动 preflight
Agents → 重新扫描 → 选择候选 → 添加
```

所有供应商原始命令、adapter、container ID 只在 Advanced/Debug 展示。

### Session/Task/PromptOS

- Session 使用 Project/Agent/Title 的 Dialog，Model/Mode/cwd 在 Advanced。
- Goal/Task、Review/Rework、Prompt、Version、Binding 均使用统一 Dialog/Form。
- PromptOS 普通界面显示“用途”“内容格式”“生产版本”“最新版本”和可搜索名称，
  不要求 UUID 或 JSON。
- Workspace 保留会话工作台结构，增加清晰的 context bar、运行状态、Approval、Diff/Git
  和 capability-driven Terminal，而不是改成普通 Dashboard。

## Quality and safety gates

- 普通 UI 不出现 `LOCAL_HOST`、`DOCKER_CONTAINER`、`SYSTEM`、`REVIEW`、`TEXT`、`CHAT` 等 raw enum。
- 所有 mutation 使用字段级错误、首个错误聚焦、加载中禁用重复提交、关闭 Dialog 后恢复焦点。
- 所有 path 操作通过 root policy、realpath、symlink containment；被动 discovery 只读。
- Terminal 只允许显式环境变量白名单，不继承 token/secret/password/key；权限策略和审计边界可见。
- 不能以 mock、fixture、健康检查或无横向滚动替代真实用户旅程证据。

# AgentHub 仓库约定

## 规格优先级

1. 当前用户指令；
2. `AgentHub_Codex_Prompt.md`（执行合同）；
3. `AgentHub_PromptOS_MVP_技术方案.md`（产品与架构合同）；
4. `docs/implementation/` 中已记录的决策。

冲突时按以上顺序处理。MVP 不启用 OpenSpec。

## 工程约定

- 使用 Node.js 24、pnpm workspace、TypeScript 严格模式与 ESM。
- 对外 REST 路径统一以 `/api/v1` 开头；WebSocket 统一使用 `/ws`。
- 核心领域不得依赖 ACP、OpenClaw 或 Docker 的供应商类型。
- 面向用户的导航、说明、按钮、状态、表单、错误与空状态使用简体中文；Agent、PromptOS、Git、Terminal、模型、模式、协议、路径、分支、命令和供应商原始数据保持原文。
- 文件修改使用路径 containment 与 symlink escape 防护；子进程一律 argv + `shell: false`。
- 不输出、复制或持久化 Agent 原生登录凭据；只保存凭据引用。
- 不修改或重建现有 Agent Compose，不删除容器、镜像或数据卷。

## 验证与交付

- 每个逻辑切片至少执行与风险匹配的 lint、typecheck、test 与 build。
- UI 切片增加 Playwright；没有可用浏览器通道时明确记录未验证，不声明视觉验收完成。
- 使用中文 Conventional Commits；每个提交只包含一个已验证的逻辑变更。
- 不 push、不创建 PR，除非当前任务明确授权。

# UI 参考审计

## 设计方向

AgentHub 是高密度、长时间使用的本地工程控制平面，不采用营销落地页、KPI 卡片墙或通用 AI 渐变风格。视觉重点是清晰层级、可靠状态、固定上下文与高信息密度。

## 参考模式

### Codeg Workspace

- 借鉴：对话、文件/Diff、Git/运行上下文的并列工作区；Composer 持续展示执行上下文。
- 不照搬：品牌视觉、非本项目的数据结构与超出 v0.1 的协作能力。

### Paperclip 控制平面

- 借鉴：进行中、需要处理、等待批准和 Agent 健康围绕“下一步行动”组织。
- 不照搬：KPI 仪表盘、组织级 RBAC、多 Agent swarm 与企业编排。

### Langfuse Prompt Management

- 当前参考：[Prompt Management 概览](https://langfuse.com/docs/prompt-management/overview)、[Version Control](https://langfuse.com/docs/prompt-management/features/prompt-version-control)、[Playground](https://langfuse.com/docs/prompt-management/features/playground)。
- 借鉴：Prompt identity/version/label 的清晰区分；`latest` 自动维护、`production` 可移动/回退；版本 Diff、变量输入与 side-by-side Playground。
- AgentHub 扩展：Binding、Project → Agent → Task Context Preview 与 Run provenance 属于 coding workflow，不照搬 Langfuse runtime。
- 不照搬：在线模型调用、Eval、Observability、计费、云端协作、protected label 企业权限和独立部署。

## 视觉约束

- 主色采用偏冷的墨蓝/青灰，状态色只用于真实状态，不做装饰。
- 中文正文使用系统中文无衬线栈；路径、命令、hash 与结构化数据使用等宽字体。
- 桌面端以可调整多栏为主；1024/768 转 tabs；390 只保留主会话并用 drawer 展示辅助信息。
- 使用边线、留白和轻微表面色区分层级，避免所有内容都放入圆角卡片。
- 动效只服务于连接、状态变化和面板切换，并尊重 `prefers-reduced-motion`。

## 不包含

不包含 Workflow Designer、Marketplace、Memory/RAG、Prompt Eval、RBAC/SSO、Remote Node、自动 worktree、完整 Git 客户端或容器镜像管理。

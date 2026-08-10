# 实施决策

## D-001：合同优先级

状态：已接受。`AgentHub_Codex_Prompt.md` 为执行合同，`AgentHub_PromptOS_MVP_技术方案.md` 为产品/架构合同；冲突时执行合同优先，当前用户指令最高。

## D-002：ACP 版本

状态：已接受。v0.1 使用稳定 ACP v1；v2 只保留隔离扩展点。依赖固定为 `@agentclientprotocol/sdk@1.3.0`、`codex-acp@1.1.14`、`claude-agent-acp@0.66.0`。

## D-003：现有 Docker Agent 接管

状态：已接受。允许显式注册后 inspect/start/stop/exec 固定 Agent 命令；不重建、不修改 Compose、不删除；container ID 每次运行前重验。默认手动启动，逐 Profile 可选按需启动，永不自动停止。

## D-004：OpenClaw 路径

状态：已接受。优先官方 `openclaw acp`，缺失时检测 `openclaw agent exec` 单回合回退。npm Gateway SDK 占位包不进入 v0.1。

## D-005：Terminal 降级

状态：已接受。当前 ARM64 NAS 无 `node-pty` 预构建产物和编译工具。Terminal 能力必须在运行时自检并报告不可用；不安装系统工具，不以子进程管道模拟 PTY。

## D-006：UI 语言

状态：已接受。用户操作与解释文案使用简体中文；Agent、PromptOS、Git、Terminal、模型、模式、路径、分支、命令、协议和供应商原始数据保留专业原文。

## D-007：v0.2 实施顺序

状态：已接受。先实现 Worktree Task Runner，再实现 Remote Node。Worktree 先固化任务隔离、
队列、审阅和 merge gate 语义；Remote Node 随后复用这些领域契约，仅替换执行位置与传输层。

## D-008：Worktree 生命周期与合并

状态：已接受。Worktree Execution 使用独立持久状态机，每 Project 单并发，Review 占用
队列槽位。只有用户显式批准后才创建受管 commit 并执行 `--no-ff` merge；不自动清理
worktree 或 task branch。详细依据见 `ADR-012`。

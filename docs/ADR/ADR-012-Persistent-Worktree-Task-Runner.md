# ADR-012：持久化 Worktree Task Runner

## 状态

已接受，适用于 v0.2。

## 背景

v0.1 的 Task 直接在 Project root 创建 Session，能够完成 Agent Run 与人工审阅闭环，
但不能隔离并发任务，也没有任务分支、持久队列和 merge gate。v0.2 要在不破坏既有
Task API 的前提下引入 isolated checkout、task branch、queue、Agent run、review 与
merge gate。

## 决策

- 保留 v0.1 的 `TaskStatus`，新增供应商无关的 `WorktreeExecutionStatus`：
  `QUEUED → SETTING_UP → RUNNING ↔ AWAITING_INPUT → REVIEW → MERGING → DONE`，
  并支持 `BLOCKED`、`CANCELED`。
- Worktree Execution 单独持久化；一个 Task 可保留历史 Execution，但同一 Task 只允许
  一个未结束 Execution。
- 同一 Project 同时只允许一个活跃 Execution。`REVIEW` 也占用活跃槽位，确保下一项
  不会在前一项完成审阅和 merge gate 前开始。
- managed worktree root 默认位于 AgentHub data root 的 `worktrees/`；路径由服务端 UUID
  生成，不接受客户端绝对路径。每次 Git 操作重新验证 containment 与 symlink 边界。
- task branch 默认命名为 `agenthub/task-<task-id-short>-<execution-id-short>`；所有 ref
  都经 `git check-ref-format --branch` 验证，所有 Git 命令使用 argv 和 `shell: false`。
- 队列成功后 Task 映射到 `IN_PROGRESS`；Agent Run 完成映射到 `WAITING_REVIEW`；
  merge 成功后映射到 `DONE`；失败映射到 `BLOCKED`。
- 用户选择“继续修改”时复用当前 Session，并启动新的 Run；Approval 等待映射到
  `AWAITING_INPUT`。
- 用户明确选择“批准并合并”后，AgentHub 才在隔离 worktree 中执行 `git add -A` 和
  受管提交，再对 Project 当前 base branch 执行 `--no-ff` merge。合并前必须通过：
  Project 主工作区干净、仍位于 base branch、base SHA 仍为其祖先、无未解决冲突。
- merge 失败时尽力执行 `git merge --abort`，Execution 回到 `REVIEW` 并记录稳定错误码；
  不把失败的 merge 状态留在主工作区。
- v0.2 不自动删除 worktree 或 task branch。清理属于独立、显式且可审计的后续能力。

## 结果

- v0.1 的直接 Task Run 与 API 保持兼容。
- 服务重启后，`QUEUED` 可继续调度；无法安全恢复的 setup/run/merge 标为 `BLOCKED`，
  worktree 与分支保留用于诊断和恢复。
- Review 页面必须展示 base、branch、worktree path、Git status、Diff、Session/Run 和
  merge preflight，不以仅有状态标签代替真实证据。

## 回滚

代码可按提交回退。数据库迁移只向前追加；回滚应用版本时保留新增表，不删除 worktree、
分支或用户数据。任何已完成 merge 使用普通 Git revert 处理，不执行历史重写。

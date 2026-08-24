# v0.7 Real Codex E2E Evidence

## 运行命令

```text
env -u CODEX_PERMISSION_PROFILE -u CODEX_CI AGENTHUB_E2E_LIVE=1 \
  corepack pnpm exec vitest run tests/live/discovery-codex.live.test.ts \
  --config vitest.live.config.ts --reporter=verbose
```

## 结果

- 时间：2026-08-25（Asia/Shanghai）
- Test Files：1 passed
- Tests：2 passed
- 真实 Codex discovery → adopt → preflight → Session 创建：通过。
- 真实断线恢复：杀掉当前 Codex 子进程后，Session 进入 `DISCONNECTED`，`resume` 恢复为 `READY`，再次 Run、消息持久化和最终 `CLOSED`：通过。
- 真实文件变更闭环：Codex 写入 disposable Git 仓库、真实 Approval（多次权限请求自动处理）、Diff、Git commit、关闭持久化：通过。
- 测试只使用隔离的临时 PGlite、临时 Codex home 和 disposable Git 仓库，未修改 AgentHub 项目仓库或生产数据卷。

## 阻塞修正

首次运行的断线恢复断言已经全部通过，但在 Run 完成事件与 Session `RUNNING → READY` 持久化事件之间立即关闭，触发了 `SESSION_HAS_ACTIVE_RUN`。测试门禁增加了等待 Session 终态收敛的检查后重新运行，两个用例均通过；没有修改生产 Session 状态机。


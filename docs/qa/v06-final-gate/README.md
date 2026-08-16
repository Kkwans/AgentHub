# AgentHub v0.6 自动化收尾门禁

日期：2026-08-16

## 已通过

| 门禁                                   | 结果                                                                               |
| -------------------------------------- | ---------------------------------------------------------------------------------- |
| 非沙箱全仓 Vitest                      | 51 个文件，221 passed，9 skipped                                                   |
| Playwright E2E                         | 24/24 passed，覆盖 1440/1024/768/390、URL 恢复、键盘和 axe                         |
| 真实 Agent live gate                   | 4 个文件，9 passed；覆盖 Codex、Remote Node、Worktree、Docker Agent 与能力差异路径 |
| TypeScript / ESLint / production build | 已通过；Web 1716 modules transformed                                               |

## 修复的门禁回归

Playwright 首次收尾运行发现 Remote Node 测试仍查找旧的 `授权 roots` accessible name；产品实现已经统一为中文 `授权目录`。提交 `f0e84a3` 更新测试契约后，Remote Node 四 viewport 聚焦测试 4/4、完整 E2E 24/24 通过。

## 真实能力边界

- Codex live 闭环通过。
- Claude Code 的固定 `claude-agent-acp` 缺失时保持 `BROKEN`，不伪称 READY。
- Hermes workspace 未映射时保持 `WORKSPACE_UNMAPPED`。
- OpenClaw ACP 需要供应商 scope approval 时保持 `AUTH_REQUIRED`。

## 尚未完成

当前环境没有授权浏览器/Computer Use/TX5Pro 通道，因此 1440/1024/768/390 人工视觉审查、真实人工可用性 checklist 和生产浏览器验收仍是 `VISUAL_GATE_PENDING`，不能用 Playwright fixture 替代。

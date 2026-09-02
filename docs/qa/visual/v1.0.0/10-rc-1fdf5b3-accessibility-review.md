# 当前候选可访问性复核

- 矩阵：10 条核心路由 × 7 视口 × light/dark，共 140 页；来源为当前 `main` 的 isolated real server。
- 自动化结果：axe WCAG 2A/2AA、2.1A/2.1AA 严重和关键级别违规为 0；报告完整写入 `10-rc-1fdf5b3-accessibility.json`。
- 当前候选运行时 commit：`1fdf5b316d8e4cdbe62528b7b088ba029fb9abe6`。
- 仍未由该自动化矩阵覆盖：完整键盘 Workspace 路径、drawer/dialog 关闭后的焦点返回、PTY 生命周期与终端输入、200% 缩放交互；axe `incomplete` 项共 190 个，需结合人工复核，不将其误报为违规。

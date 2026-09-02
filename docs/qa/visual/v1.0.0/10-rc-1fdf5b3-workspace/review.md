# 当前候选 Workspace 状态复核

- 矩阵：ready、running、approval、failed、closed、git-changes、terminal 七种 Workspace 状态 × 7 视口 × light/dark，共 98 张截图。
- 自动化结果：health 为 `1.0.0`、`pglite`、web dist 可用；console、page error、failed request、横向溢出和已测 geometry violations 均为 0。
- 当前候选运行时 commit：`1fdf5b316d8e4cdbe62528b7b088ba029fb9abe6`。
- 本矩阵使用 ACP protocol test agent fixture，不代表生产 Agent/ACP；arm64 环境缺少 `node-pty` 原生绑定，PTY 打开、输入、resize、close 仍未验证。
- login、loading、error、offline 由异常态专项矩阵覆盖；人工视觉评分及 table-column-alignment、state-frame-shift、composer-readable-column、drawer-width 等规则仍需人工或专项几何证据。

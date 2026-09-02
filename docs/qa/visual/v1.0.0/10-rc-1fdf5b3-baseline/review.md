# 当前候选视觉复核

- 矩阵：10 条核心路由 × 7 视口 × light/dark，共 140 张截图；来源为当前 `main` 的 isolated real server。
- 自动化结果：health 为 `1.0.0`、`pglite`、web dist 可用；console、page error、failed request、横向溢出和已测 geometry violations 均为 0。
- 当前候选运行时 commit：`1fdf5b316d8e4cdbe62528b7b088ba029fb9abe6`。
- 人工视觉评分：`UNVERIFIED`；本文件不把自动化无错误或首轮截图当作 ≥9/10 人工评分。
- loading/error、running/approval/failed/closed、Git changes、terminal 等专项状态不在本 baseline 的正常页面矩阵中，需由专项证据覆盖。
- geometry 脚本仍列出 `table-column-alignment`、`state-frame-shift`、`composer-readable-column`、`drawer-width` 为未测量规则；本目录是 baseline 证据，不代表完整 release geometry gate 已完成。

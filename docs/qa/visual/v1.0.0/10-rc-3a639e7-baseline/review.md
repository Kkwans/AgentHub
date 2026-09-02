# 当前候选视觉复核

- 矩阵：10 条核心路由 × 7 视口 × light/dark，共 140 张截图。
- 运行事实：隔离真实 server，health 为 `1.0.0`、`pglite`、web dist 可用；console、page error、failed request、横向溢出和 geometry violations 均为 0。
- 纠偏轮次：`f686361` 已修复 390px 主导航的纵向图标/文字布局与移动端残留折叠入口；本轮在该提交后的候选上重新捕获完整矩阵。
- 视觉人工评分：`UNVERIFIED`。本文件不把自动化无错误或首轮截图当作 ≥9/10 人工评分；登录、loading/error、running/approval/failed/closed、Git changes、terminal 等状态仍需专项证据。
- geometry 脚本仍明确列出 `table-column-alignment`、`state-frame-shift`、`composer-readable-column`、`drawer-width` 为未测量规则，不能宣称完整几何门禁全绿。

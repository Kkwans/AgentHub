# Phase 0 隔离基线复核

状态：已完成截图矩阵；这是当前代码的基线记录，不是 v1.0 RC。

- 矩阵：Light/Dark × 7 viewport × 10 core routes，共 140 张 PNG。
- 证据：`audit.json`、`geometry.json`、`SHA256SUMS`。
- 自动结果：0 console error、0 page error、0 failed request、0 横向溢出；几何基线检查通过。
- 已人工抽查宽屏 Home、宽屏 Workspace、暗色 Prompt、手机 Agents、手机 Settings、暗色手机 Workspace。
- 当前页面仍显示历史版本标签、部分空态和旧的 Workspace 布局；这些是待 v1 迁移的基线差异，未在 Phase 0 中修复。
- `geometry.json.releaseReady` 保持 `false`；列对齐、状态位移、Composer 阅读列和 drawer 宽度仍未测量。
- 登录、loading/error/offline 和 Workspace 的完整运行状态矩阵尚未纳入本目录，不能据此宣称完整 v1 验收。

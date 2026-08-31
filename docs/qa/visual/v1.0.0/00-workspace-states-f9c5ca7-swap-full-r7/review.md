# Phase 0 Workspace 状态基线复核

状态：已完成隔离真实服务器状态矩阵；这是当前代码的基线记录，不是 v1.0 RC。

- 矩阵：ready、running、approval、failed、closed、Git changes、Terminal capability ×
  Light/Dark × 7 viewport，共 98 张 PNG。
- 证据：`audit.json`、`geometry.json`、`SHA256SUMS`；`geometry-audit` 已通过 98 页。
- 采集期间 0 console error、0 page error、0 failed request；earlyoom 未杀浏览器进程。
- 后端 failed Run 已真实产生，但页面没有显示预期的“最近一次 Run 失败”横幅；
  每页 `stateEvidence.bannerFound` 保留该差异，交由 Workspace 阶段修复。
- Git changes 的真实文件变更已写入隔离 Git 仓库；复选框是否在当前响应式视图可见由
  `gitFileSelectionFound` 记录，drawer 交互专项尚未作为通过条件。
- 当前隔离宿主机 `node-pty` 原生 binding 不可加载，Terminal 生命周期属于
  `unverifiedStates`；报告记录 capability=false，不以普通 Shell 替代 PTY。
- 登录、loading/error/offline、列对齐、状态位移、Composer 阅读列和 drawer 宽度仍未测量；
  `geometry.json.releaseReady` 保持 `false`。

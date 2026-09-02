# 当前候选 Workspace 状态复核

- 矩阵：ready、running、approval、failed、closed、git-changes、terminal 7 类状态 × 7 个视口 × light/dark，共 98 张截图。
- 运行事实：`db168e0`，NAS-local Playwright Chromium，隔离真实 server；health 为 `1.0.0`、`pglite`、web dist 可用。
- 结果：98/98 快照完成；非预期 console、page error、failed request、横向溢出和 geometry 基线违规均为 0。
- 后端状态：running、approval、failed、closed 由真实隔离 ACP fixture 驱动；git-changes 写入隔离 Project 的 `README.md`，未修改仓库工作树。
- Terminal：运行时报告 `PTY_NATIVE_BINDING_UNAVAILABLE`（linux/arm64），因此 PTY 打开、输入、resize、关闭仍未验证；这不是把缺失能力误报为通过。
- geometry 脚本仍将 `table-column-alignment`、`state-frame-shift`、`composer-readable-column`、`drawer-width` 标记为未测量；本报告是 Workspace 状态证据，不代表完整发布几何门禁。
- 登录、loading/error/offline 状态已由 `10-rc-26a8a57-exception` 覆盖；审批重连交付、键盘全路径、drawer focus return、200% zoom 和人工视觉评分仍未验证，生产 Agent/ACP 目标未触碰。

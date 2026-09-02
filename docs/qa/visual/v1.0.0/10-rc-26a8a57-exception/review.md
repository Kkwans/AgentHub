# 当前候选异常状态复核

- 矩阵：登录、加载、错误、离线 4 类状态 × 7 个视口 × light/dark，共 56 张截图。
- 运行事实：`26a8a57`，NAS-local Playwright Chromium，隔离真实 server；health 为 `1.0.0`、`pglite`、web dist 可用。
- 结果：56/56 快照完成；非预期 console、page error、failed request、横向溢出和 geometry 基线违规均为 0。
- 预期网络现象：错误状态使用不存在的 Session 路由，HTTP 404 已归类为预期；离线状态在 Workspace shell 加载后主动断网，失败请求已归类为预期。
- 认证修复：`26a8a57` 使认证预加载 Promise 只服务首次查询，创建管理员后 React Query 重新验证会读取最新认证状态；该行为已由真实 token 登录聚焦用例验证。
- geometry 脚本仍将 `table-column-alignment`、`state-frame-shift`、`composer-readable-column`、`drawer-width` 标记为未测量；本报告是专项状态证据，不代表完整发布几何门禁。
- PTY 生命周期、审批重连交付和人工视觉评分仍未验证；生产 Agent/ACP 目标未触碰。

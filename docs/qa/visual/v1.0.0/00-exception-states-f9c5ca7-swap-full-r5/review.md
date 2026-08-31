# Phase 0 异常态基线复核

状态：已完成隔离真实服务器的登录、加载、错误和断网矩阵；这是当前代码的基线记录，不是 v1.0 RC。

- 矩阵：login、loading、error、offline × Light/Dark × 7 viewport，共 56 张 PNG。
- 证据：`audit.json`、`geometry.json`、`SHA256SUMS`；`complete: true`，`geometry-audit` 已通过 56 页。
- 非预期结果：0 console error、0 page error、0 failed request、0 横向溢出。错误态的 HTTP 404 和断网态的 `ERR_INTERNET_DISCONNECTED` 保留在 `expected*` 字段中。
- login：真实 token auth 首次创建临时管理员后，使用无 Cookie 的新 Context 访问 `/overview`，确认“登录 AgentHub”。账号和数据只存在隔离临时 PGlite，未触碰生产。
- error：无效 Session 路由真实返回全局“暂时无法加载 / Session 不存在”错误提示；404 资源错误属于该场景的预期证据。
- offline：先真实加载 Workspace，再切断 Context 网络；Workspace 壳仍在，断网 API 请求被记录为预期失败。当前页面没有独立的离线提示，需在后续 Shell/Workspace 阶段决定并验收。
- loading：CDP 真实网络条件为 latency 1000ms、download/upload 25KB/s，250ms 时直接截取同一页面；此时应用脚本尚未完成，截图保留初始空白加载现场，`themePending` 属预期。当前没有可见的初始 Loading UI，需在后续设计阶段补齐。
- `geometry.json.releaseReady` 保持 `false`；列对齐、状态位移、Composer 阅读列和 drawer 宽度仍未测量，PTY 生命周期和断线后 Approval 投递仍未验证。

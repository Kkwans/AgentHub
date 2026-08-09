# 故障排查

## 服务无法启动

- `INVALID_SERVER_PORT`：检查 `AGENTHUB_PORT` 是否为 `0..65535` 的整数。
- `AUTH_MODE_REQUIRED` / `INSECURE_NON_LOOPBACK_BIND`：非 loopback 必须设置 `AGENTHUB_AUTH_MODE=token`。
- `AUTH_TOKEN_NOT_CONFIGURED`：token 模式需要 bootstrap token 或数据库内至少一个未撤销 token。
- PGlite 失败：检查 `AGENTHUB_DATA_DIR` 的父目录权限和剩余空间；不要删除现有数据库目录。
- PostgreSQL 失败：检查 `DATABASE_URL`、网络、证书与 migration 权限。

## Web 页面不可用

- `/api/v1/health` 的 `web=false`：先执行 `pnpm build`，或用 `AGENTHUB_WEB_DIST` 指向包含 `index.html` 的绝对/可解析目录。
- API 正常但前端路由 404：确认请求由 AgentHub Server 处理，而不是直接用没有代理配置的静态服务器。
- token 模式持续 401：在“设置”中更新当前浏览器 token；浏览器只保存于当前 `sessionStorage`。
- `/ws` 断开：确认反向代理允许 WebSocket upgrade，并透传 `Sec-WebSocket-Protocol`。

## Agent preflight

- `MISSING`：目标运行环境没有固定命令；AgentHub 不会临时安装 `latest`。
- `BROKEN`：命令存在但 adapter/协议启动失败。当前 Claude Code 容器需要固定安装 `claude-agent-acp@0.66.0`。
- `AUTH_REQUIRED`：在 Agent 原生运行时完成授权。AgentHub 不读取或复制凭据。
- `WORKSPACE_UNMAPPED`：Docker mount 未覆盖 Project root。修改部署前先评估 Compose/volume 影响并取得单独授权。
- `CONTAINER_REPLACED`：同名容器 ID 已变化；重新人工核验并显式注册完整 ID。

## Run、Approval 与 Task

- `SESSION_NOT_READY`：等待当前 Run 结束或恢复断开的 Session。
- `APPROVAL_OPTION_INVALID`：只能提交 Agent 原始返回的合法 option ID。
- Approval 重复提交返回同一已决结果，不会再次发送给 Agent。
- Run 完成而 Task 未完成是正常门禁：Task 会进入“待审阅”，必须由用户确认。
- Run 失败/取消会把关联 Task 标为“受阻”，修复原因后再设为“就绪”。

## Project、Git 与 Terminal

- `PATH_TRAVERSAL` / symlink escape：目标路径超出 Project root，服务按安全边界拒绝。
- Git selected-files commit 不会自动包含其他文件；检查所选路径和 staged 状态。
- `PTY_NATIVE_BINDING_UNAVAILABLE`：当前平台没有可用 `node-pty` native binding。AgentHub 不使用普通 shell 模拟 PTY。

## Docker 安全诊断

- 只核验显式注册的 container name 与完整 ID。
- 活动 Session 会阻止停止容器；先取消 Run 并关闭 Session。
- 不使用 `docker compose down`，不删除容器、镜像或 volume 作为排障步骤。

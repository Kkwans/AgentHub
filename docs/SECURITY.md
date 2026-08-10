# 安全模型

## 默认暴露

- 默认只监听 `127.0.0.1`，使用 `local_trusted`。
- 任何非 loopback bind 都必须配置 token auth，否则服务拒绝启动。
- token 只保存 hash；供应商 secret 只保存引用。
- `AGENTHUB_HOST` 为非 loopback 时必须同时设置 `AGENTHUB_AUTH_MODE=token`，否则在监听端口前拒绝启动。
- token 模式首次启动需要 `AGENTHUB_BOOTSTRAP_TOKEN`；已有数据库 token 后可移除 bootstrap secret。
- 浏览器访问 token 只保存于 `sessionStorage`，HTTP 使用 Bearer header，WebSocket 使用受限 subprotocol credential；生产远程访问仍需 TLS 终止。

## API token

- `POST /api/v1/auth/tokens` 生成 256-bit 随机 token，只在创建响应中显示一次。
- 数据库只保存带算法前缀的 SHA-256 hash；列表与撤销响应不返回 hash。
- `DELETE /api/v1/auth/tokens/:id` 只做可追踪撤销，不物理删除记录。
- `GET /api/v1/health` 与 `GET /api/v1/auth/status` 可匿名读取，其他 `/api/v1` 接口和 `/ws` 在 token 模式统一认证。

## 进程与 Docker

- executable 必须是绝对路径或来自受控 Profile；参数使用 argv，`shell: false`。
- Docker 目标必须显式注册 container name 与当前 container ID。
- 每次 start/stop/exec 前重新 inspect 并比对 ID，避免同名替换。
- Docker 接口只开放 inspect/start/stop/exec-fixed-agent-command，不提供通用命令入口。
- Docker 权限等同主机高权限，设置页必须显示警告与诊断状态。

## 路径

- Project root 使用 realpath。
- 所有文件访问同时校验 lexical containment 与 realpath containment。
- 拒绝 `..`、编码 traversal、绝对路径注入和 symlink escape。
- Docker cwd 使用最长 workspace mapping 前缀换算，并在每次 Run 前重验。

## Worktree 与 merge gate

- managed worktree 路径只由 Server 在 `AGENTHUB_WORKTREE_ROOT` 下生成，不接受客户端路径。
- Git executable 固定为 `/usr/bin/git`，所有 ref、路径和参数使用 argv 与 `shell: false`。
- 每次 Review/Merge 重新验证 Project common dir、task branch、worktree identity 与 realpath
  containment；拒绝非法 ref、traversal、symlink escape 和被替换的 worktree。
- merge 前要求主工作区 clean、当前分支匹配、base ancestry 未失效并通过冲突预检。
- 不自动执行 reset、rebase、force push、branch delete 或 worktree cleanup；merge 失败时只
  abort 当前 merge 并回到 Review，现场保留供人工诊断。

## 日志与诊断

- 对 token、cookie、Authorization header、常见 API key、Agent auth payload 与用户配置的敏感模式脱敏。
- 默认日志不包含完整 Prompt、文件正文或供应商原始 payload。
- 原始调试信息需要显式开启并在返回前脱敏。
- 服务日志明确 redact `Authorization`、token、password 与 secret 字段；token 不允许通过 query string 传递。

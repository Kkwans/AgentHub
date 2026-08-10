# 安全模型

## 默认暴露

- 默认只监听 `127.0.0.1`，使用 `local_trusted`。
- 任何非 loopback bind 都必须配置认证，否则服务拒绝启动。
- 密码、浏览器会话 token 与 API token 都不保存明文；供应商 secret 只保存引用。
- `AGENTHUB_HOST` 为非 loopback 时必须同时设置 `AGENTHUB_AUTH_MODE=token`，否则在监听端口前拒绝启动。
- token 模式首次启动不要求 bootstrap secret；零账号时只开放一次性管理员设置流程，数据库
  singleton constraint 在首个账号创建后关闭该路径。
- 管理员密码使用 Node.js `scrypt` 加随机 salt 派生；网页认证使用 7 天有效的 HttpOnly、
  SameSite=Strict Cookie，浏览器 JavaScript 不能读取会话 token，HTTP 与 WebSocket 自动复用同源 Cookie。
- `AGENTHUB_BOOTSTRAP_TOKEN` 只作为可选 API/回滚兼容能力，不进入普通用户界面。

## 本机管理员与浏览器会话

- MVP 只支持一个本机 `ADMIN`，不伪装成多用户/RBAC 系统。用户名做 NFKC 规范化和大小写无关匹配。
- 密码长度限制为 12..128；连续 5 次错误登录会对该客户端冷却 15 分钟。
- 浏览器会话只保存 SHA-256 hash、到期时间、最近使用与撤销时间；退出登录和密码变更都会撤销会话。
- 修改密码需要当前管理员密码；修改后除当前新会话外，其他浏览器全部退出。

## API token

- `POST /api/v1/auth/tokens` 生成 256-bit 随机 token，只在创建响应中显示一次。
- 数据库只保存带算法前缀的 SHA-256 hash；列表与撤销响应不返回 hash。
- `DELETE /api/v1/auth/tokens/:id` 只做可追踪撤销，不物理删除记录。
- `GET /api/v1/health`、`GET /api/v1/auth/status`、login 与零账号时的 setup 入口可匿名访问；
  其他 `/api/v1` 接口和 `/ws` 统一验证管理员 Cookie 或明确的 API token。

## 进程与 Docker

- executable 必须是绝对路径或来自受控 Profile；参数使用 argv，`shell: false`。
- Docker 目标必须显式注册 container name 与当前 container ID。
- 每次 start/stop/exec 前重新 inspect 并比对 ID，避免同名替换。
- Docker 接口只开放 inspect/start/stop/exec-fixed-agent-command，不提供通用命令入口。
- Docker 权限等同主机高权限，设置页必须显示警告与诊断状态。
- 当前 NAS 的 AgentHub Compose 经用户明确授权使用 root、privileged、Docker socket、Project
  rw 和 Codex HOME rw；该组合等同 NAS root，不提供容器隔离保证。Compose 只应运行已验证的
  AgentHub 镜像，并且不得因此扩大既有 Agent 容器的接管范围。
- root Git 使用 `SUDO_UID` 识别明确的 Project owner，并只读挂载 Git identity 配置；不设置
  `safe.directory=*`，也不因此新增 push/credential API。
- 当前 `192.168.5.110:3210` 是受账号登录保护的 LAN HTTP 入口；不可信网络或跨网访问必须在
  前置代理终止 TLS，避免登录密码与 Cookie 被旁路观察。
- HTTP 模式不发送仅适用于可信 origin 的 COOP，也不使用 `upgrade-insecure-requests` 强制
  相对资源改成 HTTPS；TLS 入口设置 `AGENTHUB_SECURE_TRANSPORT=true` 后恢复 COOP，其余
  Helmet CSP 与安全头在两种模式均保留。

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

## Remote Node

- Node 只建立 outbound WebSocket，不开放 SSH、RPC HTTP 或其他入站管理端口；非 loopback 连接必须使用 `wss://`。
- 首次注册使用 32-byte 随机一次性 token。中央只保存 SHA-256 hash，校验、过期检查与消费在事务中完成；明文只在创建响应中出现一次。
- Node 本地生成 Ed25519 key pair，private key 以 `0600` 保存在 Node 数据目录；中央只保存 public key 与 SHA-256 fingerprint。
- 每次连接由中央生成 challenge，Node 对固定域分离 payload 签名；revoke 后当前连接关闭，后续认证拒绝。
- 中央注册码 roots 与 Node 本地 realpath roots 必须匹配。每次 Project、cwd、文件请求仍在 Node 上重新执行 lexical/realpath containment 与 symlink escape 防护。
- Node 只接受 versioned RPC allow-list；Agent 必须来自本地 inventory，并用固定 Profile、argv 与 `shell: false` 启动。中央不能传入任意 executable、shell command 或 provider credential。
- 协议限制单条消息为 1 MiB，并为 RPC 设置 request ID 与 timeout；断线不自动重放有副作用的 prompt、approval 或 cancel。
- Remote Git、Remote Worktree、远程 Terminal 与远程 Docker 管理不属于 v0.2；服务返回明确的 unsupported 状态，不以本机能力代替远端执行。

## 日志与诊断

- 对 token、cookie、Authorization header、常见 API key、Agent auth payload 与用户配置的敏感模式脱敏。
- Remote Node 日志不得输出注册码、private/public key 原文、签名或 provider environment；诊断只展示 fingerprint、roots、inventory 和脱敏错误。
- 默认日志不包含完整 Prompt、文件正文或供应商原始 payload。
- 原始调试信息需要显式开启并在返回前脱敏。
- 服务日志明确 redact `Authorization`、Cookie、token、password、currentPassword、newPassword
  与 secret 字段；任何凭据都不允许通过 query string 传递。

# 安全模型

## 默认暴露

- 默认只监听 `127.0.0.1`，使用 `local_trusted`。
- 任何非 loopback bind 都必须配置 token auth，否则服务拒绝启动。
- token 只保存 hash；供应商 secret 只保存引用。

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

## 日志与诊断

- 对 token、cookie、Authorization header、常见 API key、Agent auth payload 与用户配置的敏感模式脱敏。
- 默认日志不包含完整 Prompt、文件正文或供应商原始 payload。
- 原始调试信息需要显式开启并在返回前脱敏。

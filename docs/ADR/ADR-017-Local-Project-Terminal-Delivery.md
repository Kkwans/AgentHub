# ADR-017：Local Project Terminal 交付边界

状态：已接受

日期：2026-08-15

## 背景

AgentHub 已有 `node-pty` 服务端生命周期和独立 `terminal:*` WebSocket topic，但 Workspace 之前
只显示“后续版本”，导致普通用户无法使用或判断 Terminal 状态。NAS ARM64 当前没有可加载的
`node-pty` native binding；Compose 又以 root/privileged 运行，不能用普通 Shell 伪造 PTY，也不能
把 root shell 无提示地暴露给浏览器。

## 决策

- v0.6 交付 `Local Project Terminal`，使用官方 `@xterm/xterm` 与 `@xterm/addon-fit` 渲染器。
- 浏览器只调用既有 `/api/v1/terminals` open/input/resize/close API，并复用唯一 `/ws` 连接的
  `terminal:<id>` topic；不创建第二条实时连接。
- 浏览器 cwd 只能来自当前 Project root 内的相对路径；服务端继续执行 realpath、symlink 和
  shell allow-list 校验。
- PTY 环境只使用显式 allow-list；Compose 显式注入 Project owner UID/GID，PTY 在能力可用时尽量
  drop privilege。Docker/Remote Terminal 不在 v0.6 范围内。
- `PTY_NATIVE_BINDING_UNAVAILABLE`、Project 未绑定或能力查询失败时，Workspace 显示中文原因，
  打开动作不可用；绝不回退到普通子进程或假 Terminal。
- open/close/shutdown 发布 `terminal.opened`、`terminal.closed`、`terminal.exited` 生命周期消息，
  便于调试和审计；输出仍只在对应 Terminal topic 中传输。

## 验收

- UI 单元测试覆盖 capability unavailable、相对 cwd、open/close、topic 订阅。
- Server 单元测试覆盖 PTY native binding 缺失、owner UID/GID、环境脱敏和 close 审计事件。
- NAS 若 native binding 仍缺失，必须显示 `PTY_NATIVE_BINDING_UNAVAILABLE`，不得声明 Terminal
  live 交互通过；具备 native binding 的环境才执行真实 open/input/resize/output/close。

## 回滚

回滚只需恢复前一个 Web/server 镜像或提交；不删除镜像、卷或用户数据。Compose 回滚保留原有
owner UID/GID 变量兼容性，仍禁止 `docker compose down`。

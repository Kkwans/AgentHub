# TX5Pro Remote Node 实机验收

## 结论

2026-08-10 在 TX5Pro 的 Google Chrome `150.0.7871.182` 上完成 AgentHub v0.2
Remote Node 实机验收。26 项检查全部通过，覆盖在线 Node、授权 roots、Agent
inventory、远程 Project、真实 Codex preflight、Session 流式输出、Task 人工确认与
1440/1024/768/390 响应式布局。

机器可读证据见 [report.json](./report.json)。

## 运行边界

- AgentHub 仅监听 NAS `127.0.0.1:3210`，TX5Pro 通过进程内 SSH local forward
  访问 `127.0.0.1:43210`。
- Remote Node daemon 主动连接 `/node/ws`，设备身份、PGlite 数据库和注册码均位于
  本次专用临时目录。
- Node 仅授权 `/volume2/Project/AgentHub`，没有使用 SSH 作为 Remote Node 执行通道。
- 使用现有 Codex 登录和 pinned `codex-acp@1.1.14`，没有复制或持久化登录凭据。
- 未修改或启停任何 Agent Docker/Compose、镜像、volume。
- 验收后已关闭 Node daemon、AgentHub server 和 SSH tunnel；NAS `3210` 与 TX5Pro
  `43210` 均无残留监听。

## 真实闭环

1. TX5Pro 设置页展示 Remote Node 在线状态、Ed25519 指纹、授权 roots 与 Codex inventory。
2. 浏览器通过 Remote Node Execution Target 添加真实 Project 并完成远程预检。
3. 注册 Remote Codex Agent，真实 preflight 达到 `READY`。
4. 通过中文 UI 创建 Goal、Task，并选择“直接运行”。
5. Central Server 经 outbound Node 启动真实 Codex Session，流式返回
   `TX5PRO_AGENTHUB_OK`。
6. Run 完成后 Task 进入待审阅，由用户操作“确认完成”。
7. 1440、1024、768、390 均无根页面水平溢出，移动导航、Workspace tabs 与 drawer 可用。
8. 浏览器没有 `requestfailed`、console error、page error、HTTP 4xx/5xx 或外部请求。

## 实机发现

- TX5Pro 当前地址为 `192.168.5.115`；NAS 当前地址为 `192.168.5.110`。旧主机记录与
  当前地址角色不同，验收前通过 SSH banner、主机名和已知指纹完成核验，没有跳过
  host key 检查。
- v0.2 Task 页已将旧“交给 Agent”入口拆分为“隔离执行”和“直接运行”。验收驱动已
  更新为明确选择“直接运行”，避免误入 Worktree 路径。

## 截图

- [1440 Remote Node](./remote-node-1440.png)
- [1440 Workspace](./workspace-1440.png)
- [1440 Task 完成](./tasks-done-1440.png)
- [1024 概览](./overview-1024.png) / [1024 Workspace](./workspace-1024.png)
- [768 概览](./overview-768.png) / [768 Workspace](./workspace-768.png)
- [390 概览](./overview-390.png) / [390 Workspace](./workspace-390.png) /
  [390 设置](./settings-390.png)

验收驱动为 v0.6 前的历史脚本（现已移除），本目录仅保留
`AGENTHUB_EXPECT_REMOTE_NODE_NAME` 切换到 Remote Node 路径。

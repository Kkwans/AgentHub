# TX5Pro 实机验收记录

## 结论

2026-08-10 在 TX5Pro 上使用系统已安装的 Google Chrome `150.0.7871.182` 和 Playwright `1.62.1`，对修复后的 AgentHub v0.1 构建执行了一次从空 PGlite 数据库开始的完整实机验收。最终 25 项检查全部通过，浏览器未出现 `requestfailed`、console error、page error、HTTP 4xx/5xx 或非 AgentHub 外部请求。

完整机器可读结果见 [report.json](./report.json)。

## 安全与运行边界

- AgentHub 只监听 NAS `127.0.0.1:3210`，TX5Pro 通过进程内 SSH local forward 访问 `127.0.0.1:43210`。
- 使用 `local_trusted`，没有创建或复制 token，也没有复用其他项目的浏览器凭据。
- 验收数据写入专用临时 PGlite 目录；没有写入生产数据库。
- 没有修改 Agent Docker Compose、镜像、volume 或容器状态。
- 验收进程退出时主动终止自己创建的 SSH 隧道；收尾检查确认 TX5Pro `43210` 与 NAS `3210` 均无遗留监听。

## 真实闭环

1. 通过中文 UI 注册 `LOCAL_HOST` Execution Target。
2. 添加 `/volume2/Project/AgentHub` Project 并完成真实目录/Git 预检。
3. 添加 Codex Agent，并使用 pinned `codex-acp@1.1.14` 完成真实 preflight。
4. 创建 Goal 与 Task，点击“交给 Agent”。
5. 创建真实 Session/Run，Codex 流式返回 `TX5PRO_AGENTHUB_OK`。
6. Run 完成后 Task 进入“待审阅”，再由用户操作“确认完成”进入“完成”。
7. 验证 PromptOS、Terminal/Docker/auth 设置边界及全局 WebSocket 状态。
8. 验证 1440、1024、768、390 视口、移动导航、Workspace tabs/drawer 和根页面无横向溢出。

## 实机发现与修复

- ACP 的 `externalRunId` 是可选字段；旧实现无条件执行 Drizzle patch，真实 Codex 返回空值时抛出 `No values to set`，API 误报 502。现已只在字段存在时写入。
- Codex 的 `usage_update` 可只有 context `used/size`；旧实现无条件写入不存在的 input/output token 字段，导致事件消费者断开。现已在存在可持久化 token 字段时才 patch。
- Workspace 收到 Run 完成事件后只刷新 Session 详情，Session 列表仍显示“运行中”。现已同步刷新列表查询。
- App Shell 原先只有 Workspace 订阅 topic 时才建立 WebSocket，其他页面会显示“已断开”。现已由全局连接状态监听器建立并维持统一 `/ws` 连接。

## 截图

- [1440 Workspace](./workspace-1440.png)
- [1440 Task 完成](./tasks-done-1440.png)
- [1024 概览](./overview-1024.png) / [1024 Workspace](./workspace-1024.png)
- [768 概览](./overview-768.png) / [768 Workspace](./workspace-768.png)
- [390 概览](./overview-390.png) / [390 Workspace](./workspace-390.png) / [390 设置](./settings-390.png)

## 可复用入口

本记录使用的旧版外部设备验收驱动已在 v0.6 移除；本目录仅保留历史报告与截图，不再作为当前发布入口。

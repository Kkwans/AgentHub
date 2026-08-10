# AgentHub v0.3 UI/UX TX5Pro 实机验收

- 日期：2026-08-10
- 结果：PASS
- TX5Pro：Windows 10 build 26200、Node.js 24.0.0、Google Chrome 150.0.7871.182
- 访问方式：TX5Pro `127.0.0.1:43210` 通过 SSH local forward 连接 NAS `127.0.0.1:3210`
- 数据隔离：使用临时 PGlite 与临时 worktree 目录；没有读写正式部署数据
- 容器边界：没有修改或启停 Claude Code、Hermes、OpenClaw 的 Docker/Compose、镜像或 volume

## 验收闭环

从空数据库在真实浏览器中完成：

1. 注册 `LOCAL_HOST` Execution Target；
2. 将 `/volume2/Project/AgentHub` 添加为 Project；
3. 注册 Codex 并完成 pinned ACP preflight；
4. 创建 Goal、Task、Session 与 Run；
5. 真实 Codex 流式返回 `TX5PRO_AGENTHUB_OK`；
6. 浏览器将真实 Run 对应的 Task 确认为完成。

真实 Session ID：`63247ae9-a391-4c68-8c5e-3448ed8f9eef`。该 ID 只属于隔离验收数据库，不会出现在正式部署数据库中。

## UI/UX 检查

- 1440：概览、命令面板、PromptOS、设置、Task 与 Workspace；
- 1024：概览、Workspace、连接状态与根页面溢出；
- 768：概览、Workspace、连接状态与根页面溢出；
- 390：概览、Workspace、设置、移动导航、Tabs、Inspector drawer 与根页面溢出；
- 命令面板支持键盘打开、自动聚焦、筛选和关闭；
- 全部视口保持统一 WebSocket 已连接；
- 0 个 request failure、console error、page error、HTTP 4xx/5xx 和外部请求。

最终报告共 20 项检查，全部通过。机器可读结果见 [report.json](report.json)。

## 验收中发现并修复

- Radix `Badge` 迁移后旧的 `.status-badge` 验收选择器失效，已改为 `.rt-Badge`；
- 390px 下连接状态曾被隐藏，违反运行状态固定可达的设计合同，已恢复显示；
- Dashboard、Agent 与设置页仍有卡片墙倾向，已收敛为连续控制面和 1px 分隔；
- 未实现的新建 Terminal 操作改为明确 disabled，并展示 native PTY 能力限制。

## 证据

同目录保存 14 张最终截图和 `report.json`。截图均来自最后一次通过验收的 build；临时 AgentHub Server 与 TX5Pro SSH tunnel 在正式部署前回收。

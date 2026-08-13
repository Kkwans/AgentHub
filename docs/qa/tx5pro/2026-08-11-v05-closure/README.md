# AgentHub v0.5 TX5Pro 可用性闭环验收

日期：2026-08-11
浏览器：TX5Pro Google Chrome `150.0.7871.182`
结果：`PASS`，31/31 项检查通过

## 验收环境

- NAS loopback `127.0.0.1:3220` 启动一次性隔离 AgentHub 实例，使用独立 PGlite、worktree
  和 Git Project；没有读写正式数据库或正式 Compose 数据卷。
- TX5Pro 通过由验收进程持有的 SSH tunnel 访问该实例，并使用真实 Chrome、真实 REST、真实
  WebSocket 与真实浏览器 Cookie；没有拦截 `/api/v1` 或模拟 `/ws`。
- 管理员账号通过页面首次设置，只使用三字符用户名和六字符密码。账号、数据库、Project、Git
  提交和 fixture 输出都位于一次性目录。
- Codex Profile 使用宿主机已固定的 `codex-acp` 完成真实 preflight；需要可重复写文件、Approval
  和 Git 证据的 Run 使用确定性 CUSTOM_ACP stdio fixture。两类证据在报告中分开记录。

## 用户旅程

实机完成了以下闭环：

1. 首次设置管理员并建立 Cookie/WebSocket 会话；
2. 通过 UI 注册 Execution Target、Git Project、CUSTOM_ACP 与 Codex Agent；
3. 创建 Goal、Task、Prompt v1、Task Binding，并完成本地渲染；
4. 从 Task 直接运行 Agent，处理“允许一次”Approval，真实子进程写入
   `fixture-output.md`；
5. 在 Workspace Git 面板勾选文件并创建 commit；
6. 在 Task Review 查看 acceptance criteria 与 Git 现场，人工确认完成；
7. 退出后仅凭账号密码重新登录并恢复页面；
8. 在 1024、768、390 三档补充 Overview、Task、PromptOS、Workspace、Settings、移动导航和
   Git drawer 响应式检查。

## 结果与运行时证据

- 31 项检查全部通过，24 张截图已与本报告一同归档；
- 0 个 `requestfailed`；
- 0 个 console error、page error 或 HTTP 4xx/5xx；
- 0 个非 AgentHub 外部请求；
- 1024、768、390 的受测页面均无根页面横向溢出；
- 最终移动 Git drawer 为全宽布局，并保留唯一、明确的 44 × 44 px 关闭按钮。

结构化结果见 [`report.json`](report.json)。关键截图包括：

- `agents-ready-1440.png`
- `approval-pending-1440.png`
- `workspace-git-1440.png`
- `task-done-1440.png`
- `workspace-git-drawer-390.png`

## 验收中发现并修复的问题

- 移动检查器没有稳定的显式关闭入口，并在 flex 容器中按内容宽度收缩；现已增加唯一关闭
  按钮并强制检查器占满 drawer。
- Monaco 默认访问 jsDelivr，与产品 CSP 和离线要求冲突；现改为 Vite 本地 worker，不再发起
  外部请求。
- Monaco 0.56 与 `@monaco-editor/react` DiffEditor 清理顺序会产生运行时异常；现由
  `SafeDiffEditor` 延后释放模型，实机未再记录页面错误。
- Git commit 成功后因工作区变干净导致回执组件提前卸载；现将成功回执保留在状态切换之外。

## 回收与边界

最终验收结束后，隔离 Server 收到 `SIGINT` 并按受约束前缀删除自身临时目录；TX5Pro tunnel
已停止，NAS `3220` 与 TX5Pro `43210` 不再监听。失败轮次的 TX5Pro 原始证据未删除。正式
AgentHub Compose、正式数据库、Claude Code、Hermes、OpenClaw 的容器、镜像、Compose 与数据卷
均未在本轮中修改。

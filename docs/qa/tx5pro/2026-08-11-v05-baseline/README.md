# AgentHub v0.5 TX5Pro 基线审计

日期：2026-08-11
目标：`http://192.168.5.110:3210`
浏览器：TX5Pro Google Chrome `150.0.7871.182`

## 方法与边界

- 使用正式 `agenthub` Docker Compose 部署、正式静态资源、真实数据库、真实 REST 与真实
  WebSocket；没有拦截 `/api/v1`，没有注入 fixture。
- 自动化只通过已有管理员授权进入正式页面。凭据通过加密 SSH stdin 传入，不写入脚本、
  截图、报告或仓库，也没有输出 secret。
- 浏览器层阻止所有非 `GET` 请求。本轮没有创建、修改、启动、停止或删除任何业务对象、
  容器、镜像、Compose、数据卷或账号。
- 报告中的“通过”仅表示页面捕获与只读运行时审计完成，不表示主业务旅程已通过。

## 截图审计

| 证据                     | 状态            | 发现                                                                         |
| ------------------------ | --------------- | ---------------------------------------------------------------------------- |
| `01-login.jpg`           | 登录页          | 布局已收敛；输入和主按钮高度 36–38 px，低于本阶段移动触控目标                |
| `02-overview.jpg`        | 真实概览        | 没有 Agent、Session 或 Run；多个空状态都能说明缺失，但缺少统一的首次使用路径 |
| `03-projects.jpg`        | Project 列表    | 已有 AgentHub Project；“打开工作区”实际进入无创建能力的 Session 列表         |
| `04-agents.jpg`          | Agent 管理      | 只有 READY 的本机 Execution Target，没有注册 Agent；预检按钮触控区过小       |
| `05-sessions.jpg`        | Session 空状态  | 没有“新建 Session”主操作，文案所述路径无法完成                               |
| `06-tasks.jpg`           | Task 看板       | 空看板以五列占据大面积空间，首次用户缺少下一步引导                           |
| `07-promptos.jpg`        | PromptOS 空状态 | 大型双栏空容器先于核心创建动作，信息层级和空间利用不合理                     |
| `08-settings.jpg`        | 设置            | 多组能力卡片与灰色间隔形成割裂布局，层级与操作密度仍需收敛                   |
| `10-mobile-projects.jpg` | 390 px Project  | Git、状态和主操作列被隐藏，用户无法从 Project 开始会话                       |
| `11-mobile-agents.jpg`   | 390 px Agent    | “注册 Execution Target”换成两行，多个操作目标低于 44 px                      |
| `12-mobile-tasks.jpg`    | 390 px Task     | 五列看板被横向截断，没有状态切换或滚动提示                                   |

逐控件尺寸、页面文本、视口、scroll width 和运行时问题见 `report.json`。本轮共捕获 11 个
页面状态，浏览器未记录 request failure、console error、page error 或被动 HTTP 失败；该结果
不能替代写操作、Approval、取消、断线重连和真实 Agent Run 验收。

## 结论

v0.5 的发布门禁应优先处理 Project → Session 断链、首次使用依赖、Workspace 错误完整性、
Approval/取消/恢复可靠性、Git/Task 审阅闭环以及移动端操作可达性。完成后必须使用真实账号、
真实 API/WS 和真实 Agent 在 TX5Pro 重跑全旅程，不能用本基线或 fixture 截图代替。

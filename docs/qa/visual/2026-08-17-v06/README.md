# v0.6 自动化视觉验收

日期：2026-08-17

部署：`agenthub:0.6.0-nas.52`  revision：`e00c668`

入口：`http://192.168.5.110:3210/`

## 验收方法

- 使用 Playwright 1.62.1 + Chromium headless 连接真实 NAS 部署，不使用 mock 页面。
- 通过受保护的浏览器认证上下文访问页面；token 只在进程内使用，不写入截图、报告或日志。
- 对 `/overview`、`/projects`、`/tasks`、`/agents`、`/sessions`、`/promptos`、`/settings` 执行
  1440、1024、768、390 四个视口截图；Agent 页面额外等待运行环境扫描完成后复拍。
- 通过页面 console 监听和 DOM 横向溢出扫描复核稳定性。

仓库内固定入口为 `scripts/qa/real-deployment-visual.cjs`，通过 `pnpm test:visual:real` 执行。
它只接受真实部署地址和 root-only token 文件路径，不提供外部设备、人工浏览器或 fixture 模式；
token 只在进程内注入 HTTP/WebSocket，不写入报告：

```bash
sudo -n env \
  PLAYWRIGHT_BROWSERS_PATH=/home/Kkwans/.cache/ms-playwright \
  AGENTHUB_BASE_URL=http://192.168.5.110:3210 \
  AGENTHUB_BROWSER_TOKEN_FILE=/volume2/DockerProject/agenthub/secrets/browser-token \
  AGENTHUB_VISUAL_OUTPUT=/volume2/Project/AgentHub/docs/qa/visual/<date> \
  corepack pnpm test:visual:real
```

## 结论

`AUTOMATED_VISUAL_GATE_PASS`。本轮确认并修复了七个高影响问题：

1. 768/390 宽度下移动菜单使用旧的 fixed 样式覆盖页头，导致 `AGENTHUB`/页面标题只露出尾部；现在菜单回到页头布局流，标题完整可见。
2. 手机端 Project 卡片的“开始会话”和“编辑/归档”共用同一 CSS Grid 行，操作文本相互覆盖；现在操作项按独立行排列。
3. Agent 发现列表将 Agent 短名称与运行环境分成独立层级，避免 390px 宽度下容器名挤进标题并造成不必要的折返。
4. Agent 发现列表不再同时显示相同的 Agent 名称与类型标签，减少重复信息。
5. 390px 下缺少依赖/运行环境停止的错误提示统一放在 Agent 内容列，避免落入图标列造成错位。
6. Agent 实时连接失败时不再把 WebSocket/供应商原始异常直接展示给普通用户，统一显示中文下一步并将脱敏诊断放入调试折叠区。
7. 手机端 Task 看板保留单列可读宽度，以横向滚动查看其他状态，不再把五列压缩成不可读窄条。

复核结果：

- 四个视口、七个主要页面均无横向溢出：`scrollWidth === clientWidth`，共 28 组检查通过。
- 截图页面 console error 数量为 `0`。
- 登录页显示单一密码查看按钮，品牌图标为网络节点图标，不再使用大写 `A` 占位。
- Agent 页面在等待扫描完成后显示真实运行环境、容器停止状态、依赖缺失和已接入 Agent；初始加载骨架截图不作为验收证据。
- nas.48 Agent 页面 390px 回归的 `scrollWidth`、`clientWidth`、`bodyScrollWidth` 均为 `390`，console error 为 `0`；截图显示 `Codex`、`OpenClaw`、`Claude Code`、`Hermes` 标题与 `运行环境：...` 次级信息分层。
- nas.52 Agent 页面 390px 截图确认重复类型标签已移除、错误提示与内容列对齐、Task 首列保持可读；四视口 console error 仍为 `0`。
- `/tasks` 与真实 Workspace 会话的 1440/390 核心路径复核无横向溢出、console/page/request error 均为 `0`；Workspace 连接失败展示中文错误卡和脱敏诊断入口。

## 关键截图

| 场景 | 截图 |
| --- | --- |
| 登录页 1440 | [`01-login-1440.png`](./01-login-1440.png) |
| 概览 768（页头修复） | [`02-overview-768.png`](./02-overview-768.png) |
| 项目 390（操作项修复） | [`03-projects-390.png`](./03-projects-390.png) |
| Agent 1440（稳定状态） | [`04-agents-1440-stable.png`](./04-agents-1440-stable.png) |
| Agent 390（稳定状态） | [`04-agents-390-stable.png`](./04-agents-390-stable.png) |
| 设置 768 | [`08-settings-768.png`](./08-settings-768.png) |
| Task 390 | [`08-tasks-390.png`](./08-tasks-390.png) |
| Workspace 390 | [`09-workspace-390.png`](./09-workspace-390.png) |

完整截图及机器可读结果见当前目录的 `audit.json`、`agents-stable.json`。

## 边界与后续

- 本记录是 NAS 本地 Chromium 对真实 Compose 部署执行的唯一正式自动化视觉验收；不依赖 TX5Pro、外部设备、人工浏览器或 fixture 页面。自动化证据不覆盖特定操作系统、触控设备或 DPI 的差异。
- 设置页在 NAS 当前状态下会展示 67 个未识别容器，信息密度较高但没有溢出或遮挡；后续可在 Agent 识别流程稳定后继续优化筛选与分组。
- Sessions 与 PromptOS 的空状态留有较多留白，当前可读且操作路径明确，作为下一轮体验优化项保留。

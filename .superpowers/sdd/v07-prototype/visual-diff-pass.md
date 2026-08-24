# v0.7 Prototype 视觉差异记录

## 真实运行环境

- 目标：NAS `http://192.168.5.110:3210`
- Chromium：NAS 本地 Playwright Chromium
- 候选镜像：`agenthub:0.7.0-nas.17`
- Compose：仅重建 `agenthub` 服务，未执行 `compose down`，基线回滚镜像 `agenthub:0.6.0-nas.77` 保留
- 截图目录：`/tmp/agenthub-v07-prototype-visual17`

## 首轮矩阵（`visual11`）

矩阵覆盖 22 条真实路由、Light/Dark、1440/1024/768/390，共 176 张截图。

| 级别 | 差异 | 证据 | 处理 |
| --- | --- | --- | --- |
| P1 | Workspace 在 1024/768 的 body 出现横向溢出（scrollWidth 分别为 1030/780） | `visual11/audit.json` | 收窄 Workspace 在 tablet 的负边距，并在构建产物中确认 media rule 生效 |
| P2 | NAS Chromium 没有彩色 Emoji 字体，首页挥手显示为方框 | `visual11/light-home-1440x1000.png` | 改为 `@agenthub/ui` 的 `HandWaving` 图标，保留原型语义 |
| P2 | 顶部同时显示桌面与移动菜单按钮，和原型重复 | `visual11/light-home-1440x1000.png` | 用更高 specificity 的 shell 规则约束移动按钮，仅在窄屏显示 |

## 第二轮矩阵（`visual13`）

修正后重新覆盖同一矩阵：

- `overflowCount: 0`
- `consoleErrorCount: 0`
- `pageErrorCount: 0`
- `failedRequestCount: 0`
- `unnamedButtonCount: 0`
- `hiddenFocusCount: 0`

## 终轮修正

在 `visual13` 后继续做了 Workspace 结构级修正，而非追加 CSS 补丁：

1. 将 Terminal 与 Composer 收回中间 Conversation 列，恢复原型的沉浸式三栏关系；不再作为全宽底栏挤压 Inspector。
2. Inspector 采用“变更 / 文件 / 工具调用 / Git”语义顺序，默认显示真实变更。
3. Workspace 组件入口配置仓库内 Monaco worker，避免 Diff/File 视图尝试访问被生产 CSP 阻断的 jsDelivr。
4. Diff 视图增加真实 patch 的变更统计、hunk、增删行色彩和截断提示；即使 canvas 不可用也不会出现空白 Inspector。
5. Agent Center 标题和说明回到 Prototype 的 `AGENTS / Agent 中心` 语义。

候选镜像 `agenthub:0.7.0-nas.16` 的终轮全矩阵结果：

- `overflowCount: 0`
- `consoleErrorCount: 0`
- `pageErrorCount: 0`
- `failedRequestCount: 0`
- `unnamedButtonCount: 0`
- `hiddenFocusCount: 0`

## 偏好与性能修正（`visual17`）

- Settings 按原型补齐真实的侧边栏策略、界面密度和减少动态效果控件；状态由 `@agenthub/ui` Provider 持久化并同时驱动 AppShell/全局语义属性，不使用页面内假开关。
- Monaco worker 配置从 Workspace 模块顶层静态导入改为 File Inspector 按需动态加载；首屏页面不再因编辑器 worker 阻塞懒加载，文件预览在 worker 准备完成前显示局部 loading。
- 候选镜像 `agenthub:0.7.0-nas.17` 健康检查通过；全矩阵覆盖 22 条真实路由、Light/Dark、1440/1024/768/390，共 176 张截图：
  - `overflowCount: 0`
  - `consoleErrorCount: 0`
  - `pageErrorCount: 0`
  - `failedRequestCount: 0`
  - `unnamedButtonCount: 0`
  - `hiddenFocusCount: 0`

## 视觉判断边界

- 真实数据为空时，Prompt Library 显示原型定义的 empty state，不注入假资产；项目/Session 数量也以真实 API 返回为准，不复制原型占位数据。
- 当前截图验收基于本地 Reference/Prototype 和 Screen Spec；在线 Figma Starter MCP quota 仍不可用，不声称已完成在线 Frame 精测。
- 独立真实 Codex 门禁已通过，证据见 `real-codex-e2e.md`：discovery/adopt/preflight、文件变更、Approval、Diff、Commit、断线 resume、消息持久化和 close 均覆盖。

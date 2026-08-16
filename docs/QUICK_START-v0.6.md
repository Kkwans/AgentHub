# AgentHub v0.6 Quick Start

这份说明面向第一次使用 AgentHub 的开发者。普通流程不需要知道 token、Session ID、服务器绝对路径或 Docker container ID。

## 1. 登录

打开部署地址（当前 NAS 为 `http://192.168.5.110:3210`）。首次访问选择“创建管理员账号”，设置至少 3 个字符的用户名和至少 6 个字符的密码；之后只用用户名和密码登录。登录凭据由 AgentHub 以 hash 保存，浏览器使用 HttpOnly Cookie。

如果页面提示“登录已失效”，重新登录即可。不要把 `secrets/browser-token` 粘贴到浏览器，也不要把 token 放进截图或聊天记录。

## 2. 添加 Project

1. 打开“项目” → “添加 Project”。
2. 先选择已发现的 Runtime；默认优先显示本机和已接管的 Docker Runtime。
3. 在服务端目录选择器中浏览允许的 workspace root，选择项目候选；不需要手输服务器绝对路径。
4. 查看“添加前检查”：目录、权限、Git、分支和项目标记。检查失败时先按中文下一步处理，不要绕过安全边界。
5. 确认添加。Project 的路径、Git 和 target 会在服务端再次核验。

只有在排障时才展开“高级”手工路径；路径仍会经过 root containment 和 symlink escape 检查。

## 3. 发现并接入 Agent

1. 打开“Agent” → “扫描”。
2. Candidate 会显示来源、Runtime、版本、认证状态和 capability preview。
3. 对需要的 Candidate 点击“接入”，然后等待自动 preflight。
4. `READY` 才能创建 Session；`AUTH_REQUIRED` 表示需要在 Agent 原生环境完成授权；`STOPPED`、`MISSING_DEPENDENCY`、`BROKEN` 和 `WORKSPACE_UNMAPPED` 都会给出中文下一步。

接入主流程不要求填写 executable、adapter、container ID 或模型密钥。Docker 接管只针对显式注册且 container ID 仍匹配的容器。

## 4. 创建 Session 并工作

1. 在“会话”点击“新建 Session”，选择 Project 和已就绪 Agent。
2. Composer 会固定显示 Agent、模型、模式、Project/cwd、branch、PromptOS Binding 和 Skill；没有 capability 的选项不会出现。
3. 发送指令。若 Agent 请求权限，只在 Approval 卡片中选择 Agent 原生提供的合法选项。
4. 在 Workspace 的 Files、Diff、Git 和 Run 面板查看结果；文件浏览只读，Git commit 需要显式选择文件并填写提交说明。
5. 断线时先看连接状态和恢复提示，不要重复点击可能产生副作用的 Approval。

## 5. Goal、Task 与 Review

在“任务”中先创建 Goal，再创建 Task 和 acceptance criteria。可以把 Task 交给已就绪 Agent 开始；Run 完成后进入 Review，确认 Git/Run evidence 后再完成，返工必须填写反馈并创建新的执行。

## 6. PromptOS

在“PromptOS”中：

- 创建 Prompt，`key` 默认由名称生成；
- 用“创建新版本”保存 immutable Version，不会覆盖旧版本；
- 用结构化 Variables 编辑变量 schema，Raw JSON 只在高级区显示；
- 用 Label、Binding 和 Context Preview 管理 Project → Agent → Task 的解析优先级；
- Playground 只做本地 render、side-by-side 和 diff，不触发会修改仓库的 live Agent test。

## 7. 当前能力边界

- Local Project Terminal 在能力为 `READY` 时可从 Workspace 底部打开，使用官方 `xterm.js` + `node-pty`；能力缺失时会显示中文原因并禁用打开，不用普通 Shell 冒充 PTY。
- Remote Node 文件浏览和 Remote Git 仍按后端 capability 显示，未开放的能力会明确说明。
- 没有可用浏览器通道时，不能把自动化 fixture 或静态 build 当作 TX5Pro 视觉验收。

遇到问题先查看 [`docs/TROUBLESHOOTING.md`](TROUBLESHOOTING.md)、[`docs/AGENT-INTEGRATION.md`](AGENT-INTEGRATION.md) 和 [`docs/RELEASE-v0.6.0.md`](RELEASE-v0.6.0.md)。

# 独立真实服务无障碍矩阵

本切片只增加测试与 CI，不更改产品。运行验证仍以提交后的 exact-SHA CI 为准，静态检查或测试收集不是 154 次 axe 执行证据。

## 执行边界

- 独立 `real-accessibility` job，与现有 real-service 并行，不改原测试白名单。
- 只读仓库权限；独立 runner、loopback 动态端口、PGlite 临时数据、仓库 ACP fixture，无 NAS、线上数据或付费 Agent。
- 11 路由 × 7 视口 × 2 主题 = 154 页面状态，单 worker、单测试、单报告写入者。
- 测试预算 30 分钟，无 slow 倍率；job 35 分钟包含安装/build/浏览器和上传。首次实际耗时未知，后续应以证据调整预算。
- WCAG 2A/AA、2.1A/AA，serious/critical 必须为零。不排除节点、不删路由、不降级阈值。

## 页面与报告

每个路由等待真实业务锚点：已创建项目、Agent、会话、工作或已确认空 Prompt 状态；工作详情显式等待 Inspector；Workspace 等待真实会话空对话；Runtime 等待实际 Local Host 状态。等待可见加载状态退出，不以 main 出现或固定睡眠代替业务就绪。扫描前后核对失败 API，避免把错误状态当作正常加载完成。

JSON 在 git/seed 前创建，实际 HEAD 与 CI 的 GITHUB_SHA 核对；记录 phase/current、sourceCommit、fixtureId、完整矩阵与未扫描组合。完整度按预期 154 个唯一组合核验，complete 与 passed 分离。完整扫描发现违规时 complete=true、passed=false。

成功扫描的 axe 违规先落盘，再截图。截图失败不能抹掉已得到的规则/节点证据。单页可恢复失败记录当前 URL、主题、视口、路由及异常，关闭页面前尝试截图，继续其余组合；浏览器崩溃或整体超时保持 partial 报告。原子 rename 防半写 JSON，但不支持多个进程共写同一路径。

CI always 上传 JSON、PNG、Playwright 报告。若依赖安装、build、浏览器启动或 app fixture 在测试正文之前失败，正文无法产生 audit.json：这属于未运行矩阵，必须依据 CI 失败日志判断，不能当作零违规。进程被强制终止时以最后落盘的 current/missing 为准。

## 未覆盖

- 交互展开菜单、对话框，以及全部 review pending/unknown/错误态。
- token 认证、授权失败等不同身份场景。
- 完整键盘路径、所有焦点回归、200% 缩放、PTY 输入生命周期。
- axe incomplete 只计数提示人工检查，不等同自动通过这些规则。
- 此门禁是隔离真实后端，不等同 NAS 部署验收或所有业务流程可用性验证。

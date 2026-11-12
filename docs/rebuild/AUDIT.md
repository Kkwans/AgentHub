# 现状审查

本文记录接手基线；最新状态以 EXECUTION.md 顶部总览和各专项合同为准。

## 1. 接手结论

当前不是缺少技术框架，而是核心旅程缺乏可靠闭环、设计层反复叠加、测试证据与真实可用性脱节。保留 Node 24 / TypeScript / React / Express 模块化单体作为第一阶段基础，先拆除脆弱流程和重复 UI 层；没有证据支持为了“重构”直接换语言或框架。

## 2. 已核对的结构

- `apps/server`：认证、项目、Agent、Session/Run、Approval、Git、PTY、PromptOS、Task、Remote Node。
- `apps/web`：React 19 + Vite 8，TanStack Query；已有 feature 目录，但页面职责和设计层仍重复。
- `packages`：领域接口、数据库、ACP/OpenClaw 适配、UI。
- 数据：PGlite 默认、外部 PostgreSQL 选项；必须保留已有数据与迁移兼容。
- 接手时 CI 执行 lint/typecheck/unit/build 及 fixture 浏览器测试；当时未执行 `test:e2e:real`、`test:qa`。现有 real 测试中还有被 skip 的 legacy 主流程，不能以测试文件存在认定覆盖。
- UI/web CSS 总计约 14,095 行，`pinharness.css` 4,669 行。CSS 数量不是错误，但多套全局层、组件原语和页面样式并存使继续打补丁风险很高。
- `SessionService` 约 2020 行，跨生命周期、配置、批准与恢复，需要按有测试保障的职责边界拆分。

## 3. 已发现主流程缺口

详见问题台账。源码可确认：选中的 PromptOS 资产未进入任务启动请求；新建任务后的后续步骤失败缺少恢复身份；任务补充描述替代了主要目标；嵌套项目选择没有使用已有目录浏览 API。

安全审查同时发现 WebSocket 仅升级时认证，需复现注销/改密/撤销 token 后旧连接是否继续接收数据，随后补统一撤销机制。

## 4. 验证基线

- 仓库干净克隆，未接触 NAS、用户 Agent 凭据或现有容器。
- Node 24.22.1，pnpm 11.11.0 frozen lockfile 安装成功，供应链检查通过。
- 初次依赖安装因临时盘空间不足终止；仅迁移本轮生成的缓存后重新安装成功。
- 基线 lint/typecheck/build 通过；unit 334 项通过、1 项失败、10 项跳过。完成前两项修复后，全量 337 项通过、10 项跳过。结果以执行台账的最新提交为准。
- 本地真实 HTTP + PGlite + fixture ACP 已复现核心问题；浏览器 Chromium 启动受 socket 权限限制，真实 Agent 与 NAS 未验收。历史截图不作为当前完成证据。

## 5. 不变的边界

不复制供应商凭据；不自动批准 Agent 权限；不重建既有 Agent Compose；不删除容器、卷或项目数据；不把无法启动的真实 Agent 替换成 mock 后声称支持。远程运行、部署、迁移与发布需独立验证和明确授权。

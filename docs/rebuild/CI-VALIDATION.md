# 持续集成验证分层

## 现有 verify

保留现有 lint、typecheck、unit、build 与 API fixture 浏览器回归，不删除或放宽断言。fixture 可以验证前端表现，但不能证明真实后端链路可用。

## 新增 real-service

在 GitHub 托管 Linux runner 中构建生产版本，再使用 `playwright.real.config.ts` 启动临时 loopback 服务、临时 PGlite 和仓库内的 ACP fixture。**这是真实控制面 HTTP/WebSocket/数据库与浏览器的集成测试，不是真实 Codex/Claude、NAS 或外部账户验收。**

执行：

- `workbench.spec.ts` 当前入口的 4 项集成测试：首次登录、项目创建、任务/会话呈现、批准/Diff/Git 审阅。
- `v1-baseline.spec.ts` 完整基线：10 条核心路由 × 7 个视口 × 浅/深主题，共 140 张计划截图，包含 1440/1024/768/390。
- `qa:geometry` 对截图清单、矩阵完整性、console/pageerror、失败请求、主题、布局测量和横向溢出进行独立检查。截图测试“跑完”不等于此检查通过。

任一测试或几何检查失败都会使 job 失败，没有 continue-on-error、自动略过或把未完成矩阵改成成功。断言失败仍上传已经生成的截图和 trace，供定位真实问题；尚未完成的视觉矩阵必须保留 incomplete 标记。

## 证据与边界

- 产物：`real-service-evidence-<commit>-<attempt>`，保存 7 天。
- 上传范围只包含 Playwright 报告/trace、截图和审查 JSON/校验和，不上传临时数据库、工作树、环境文件、用户凭据或 Agent 状态目录。
- 浏览器测试仅使用临时测试管理员和 fixture 数据；不引用 NAS 地址或仓库 secrets，不调用付费 Agent。
- job 最长 40 分钟，基线测试内部有 20 分钟上限；产物可能在超时/取消时不完整，不能将部分截图作为完整验收。
- 视觉基线记录 commit、真实服务健康信息和未覆盖状态。几何检查也明确 `releaseReady: false`：通过不等于审美验收、所有异常状态或目标 NAS 已验证。
- 新 job 初次运行可能揭示原有失败；应修复真实问题或过期测试契约并记录依据，不为转绿删除有效检查。

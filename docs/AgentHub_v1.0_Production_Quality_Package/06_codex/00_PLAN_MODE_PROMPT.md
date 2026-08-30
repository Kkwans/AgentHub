# 发给 Codex 的 Plan Mode Prompt

> 先手动进入 `/plan`，再发送下面内容。

你现在负责 AgentHub v1.0.0 Production Quality Release。先不要写代码。

必须完整阅读：
1. `AgentHub_v1.0_Production_Quality_Package/00_START_HERE.md`
2. `V1_FINAL_TECHNICAL_SOLUTION.md`
3. `00_audit/*`
4. `02_design_system/*`
5. `03_screens/*`
6. `04_architecture/*`
7. `05_qa/*`

然后检查仓库当前 main 的真实状态，不得假设方案中的路径一定仍完全一致。

你的 Plan 必须：
- 先建立 baseline screenshots / version truth inventory；
- 先 Design System，再 Workspace，再普通页面；
- 每个阶段列出具体文件；
- 每阶段包含 implementation + test + visual screenshot + geometry review + commit/push；
- 明确哪些现有能力必须保持不变；
- 明确 migration 删除项，禁止新增 v1 临时 parallel page；
- 明确风险与 rollback；
- 最后给出 v1.0 Release Candidate Gate。

禁止在 Plan 中以“统一优化样式”“适当调整间距”这种不可验收措辞替代具体规格。

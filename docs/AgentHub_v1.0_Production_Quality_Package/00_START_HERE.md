# AgentHub v1.0 Production Quality Package — START HERE


> **审计基线**：GitHub `Kkwans/AgentHub` / `main`，commit `d09c575e2aaad749a8f0c822d89b3531d8634337`，审计日期 2026-08-30。本文中“当前实现”均指该基线；未能在本地启动真实部署的视觉结论会明确标为“需运行态复核”。


## 1. 这不是 v0.9 的补丁包

v1.0 的目标不是“把几个页面再调漂亮一点”，而是把 AgentHub 从 **功能可用的工程项目** 收口为 **可以公开发布、长期维护、第一眼就让用户愿意继续用的商业级 AI Engineering Workbench**。

本包把 v1.0 定义为四个同时成立的条件：

1. **Visual Quality**：所有核心页面达到统一的视觉语言、严格对齐、合理密度、无无效大空白、无低级排版错误。
2. **Interaction Quality**：高频路径不需要用户理解内部概念；核心操作可发现、可恢复、可预测。
3. **Engineering Quality**：视觉规则不再集中到巨型 CSS；设计系统与组件责任可维护、可测试。
4. **Release Quality**：版本号、README、CHANGELOG、测试、视觉基线、部署文档、镜像标签一致，真正配得上 `1.0.0`。

## 2. 当前 v0.9 结论

### 已做对的部分

- `features/v07/pages.tsx` 已删除，领域路由已拆分。
- Workspace 已拆成 SessionRail、Conversation、Composer、Inspector、GitChangesTree、DiffViewer 等组件。
- Git change tree 已按 repo-relative path 构建，不再直接用绝对路径平铺。
- Session Rail 已取消大量 CLOSED 状态胶囊，改用状态点和时间分组。
- Home 已区分 STANDARD / TEST Project。

### 仍不够 1.0 的部分

- Workspace 的 `workspace.module.css` 已膨胀到约 **78.8 KB**，视觉规则仍然是“集中叠 CSS”。
- Home 仍是 **385px Hero + 226px 项目卡片**，首屏空间效率明显偏低。
- Prompt Library 单页仍约 **41.9 KB / 1000+ 行**，页面逻辑与交互职责过度集中。
- Settings 路由与实际内容 IA 不匹配，并残留 `v06-form`、`v0.6` 文案。
- Git Inspector 存在 **Inspector 主 Tab + Git 子 Tab** 双层导航。
- Diff 固定 420px 高度，固定 plaintext，无法成为生产级代码审阅体验。
- 根包/Web 包/README 仍显示 0.6.0，Shell 却显示 v0.9。
- `docs/qa/visual` 没有 v0.9 视觉基线，视觉质量没有 release-grade 证据链。

## 3. 推荐阅读顺序

1. `V1_FINAL_TECHNICAL_SOLUTION.md`
2. `00_audit/V09_CURRENT_STATE_AUDIT.md`
3. `00_audit/UI_UX_VISUAL_AUDIT.md`
4. `01_product/V1_PRODUCT_EXPERIENCE_CONTRACT.md`
5. `02_design_system/V1_DESIGN_SYSTEM.md`
6. `03_screens/WORKSPACE_MASTER_SPEC.md`
7. `05_qa/VISUAL_QUALITY_GATES.md`
8. `06_codex/00_PLAN_MODE_PROMPT.md`
9. `06_codex/01_EXECUTION_PROMPT.md`

## 4. 实施原则

- **UI/UX 是 v1.0 的 P0，不是“最后 polish”。**
- 不允许为了赶 1.0 把视觉债务留到 1.0.1。
- 不允许新增 `v10-final-fix.css`、`v1Page.tsx` 一类临时层。
- 不允许使用大面积空白和巨大卡片来“显得高级”。
- 不允许把绝对路径、内部 ID、transport 术语当默认主信息。
- 不允许只看 happy path；必须用 50 Session、200 changed files、超长文本、错误态、空态、暗色主题验收。
- 所有 UI PR 必须附 **截图 + visual gate + geometry gate + human scorecard**。

## 5. v1.0 通过标准

v1.0 不是“功能测试绿了就发”。以下 Gate 必须全部通过：

- Product Gate
- Visual Geometry Gate
- Design System Gate
- Interaction Gate
- Accessibility Gate
- Performance Gate
- Real Data Gate
- Release Truth Gate
- Human 9/10 Gate

详见 `05_qa/`。

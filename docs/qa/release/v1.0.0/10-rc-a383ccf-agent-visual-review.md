# a383ccf 代理视觉复核

- 复核候选：`a383ccfd191d163d1672656f103ef20b27b3c391`
- 运行目标：ARM64 staging `http://127.0.0.1:3216`
- 截图矩阵：11 条 baseline 路由 × 7 视口 × light/dark，共 154 页。
- 自动证据：154 页视觉审计的 console、page、request、横向溢出、未命名按钮和隐藏焦点均为 0；geometry snapshot 154，几何违规为 0。
- 人工复核方式：逐页矩阵由自动审计覆盖；人工抽查 1440×900 与 390×844 的 Home、Projects、Agents、Prompts、Settings、Project Context、Workspace 浅/深色代表图，并按信息层级、几何、密度、排版/对比、状态、响应式、暗色和细节八项评分。

| 页面 | 代理评分 | 复核要点 |
| --- | ---: | --- |
| `/home` | 9 | Work-first 首屏、指标和空状态层级清晰；浅/深色对比稳定。 |
| `/projects` | 9 | 搜索、筛选、排序与视图切换集中在单一工具条；表头和折叠测试组边界稳定。 |
| `/agents/agents` | 9 | Agent 状态、运行时摘要和操作入口分组明确；窄屏仍可读。 |
| `/agents/runtime` | 9 | 运行时状态信息密度可控；状态色在双主题保持语义。 |
| `/agents/nodes` | 9 | Remote Node 空状态与授权入口聚焦；移动端导航不溢出。 |
| `/prompts` | 9 | 资产目录与编辑区关系明确；移动端顺序和按钮层级稳定。 |
| `/settings/appearance` | 9 | 设置分区、字段说明和控件对齐；浅/深色对比足够。 |
| `/projects/:id/overview` | 9 | Project 标识、状态、Work 与 Git 区块层级明确；移动端信息顺序合理。 |
| `/projects/:id/work` | 9 | Work 工具条、列表和空状态边界清楚；窄屏无横向溢出。 |
| `/projects/:id/sessions` | 9 | Session 筛选、分组和状态标签密度可控；双主题层次一致。 |
| `/workspace/:sessionId` | 9 | Conversation、Composer、Git Inspector 和移动 tabs 关系清晰；Terminal dock 不越界。 |

## 截图→审查→修正→重拍

1. `a383ccf` 将认证后入口与 Home 数据并行预加载，并稳定启动层 LCP 候选。
2. 在同一 ARM64 候选镜像上重拍 154 页，自动视觉和几何审计均通过。
3. 代表图复核未发现需要追加修正的维度；完整状态几何和生产矩阵仍按 manifest 单独保留。

## 边界

这是执行代理对 staging baseline 截图的评分，不是人工设计签字。它不覆盖完整异常/加载/高密度业务状态、生产部署矩阵、生产 Agent/ACP、native PTY、备份恢复或升级演练；manifest 中对应未验证项继续保留。

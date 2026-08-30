# v0.9 当前代码现状审计


> **审计基线**：GitHub `Kkwans/AgentHub` / `main`，commit `d09c575e2aaad749a8f0c822d89b3531d8634337`，审计日期 2026-08-30。本文中“当前实现”均指该基线；未能在本地启动真实部署的视觉结论会明确标为“需运行态复核”。


## 总体判断

v0.9 最大成果是 **domain ownership 从单体页面迁出**，但视觉层与 release 层没有完成同等级重构。当前项目已经具备 v1.0 的业务骨架，但距离“商业级完成度”仍有系统性差距。

## 当前关键文件体积

| 文件 | 约大小 | 风险 |
|---|---:|---|
| Workspace `workspace.module.css` | 78,808 B | 极高：视觉规则集中 |
| WorkspacePage.tsx | 28,352 B | 高：query/layout/navigation 聚合 |
| Composer.tsx | 24,263 B | 高：配置/命令/context/send 多职责 |
| Conversation.tsx | 23,055 B | 高：timeline/approval/thought/render 多职责 |
| GitChangesTree.tsx | 20,433 B | 高：tree/diff/history/branch/commit 全聚合 |
| PromptLibraryPage.tsx | 41,923 B | 极高：1000+ 行业务 UI |
| HomePage.tsx | 17,910 B | 中高 |
| home.module.css | 13,326 B | 中 |
| ProjectsPage.tsx | 17,576 B | 中高，且有 migration import residue |
| projects.module.css | 24,046 B | 高 |
| SettingsPageView.tsx | 17,180 B | 高，IA 与 route 不一致 |

## 值得保留

- route-level lazy loading。
- feature folders。
- Query state / realtime 基础设施。
- Session continuation / approval / git / terminal 能力。
- repo-relative Git tree。
- resizable panel persistence。

## 必须收口

- CSS ownership。
- Page layout contracts。
- release version truth。
- Settings IA。
- Prompt monolith。
- Workspace git review architecture。
- visual QA evidence。

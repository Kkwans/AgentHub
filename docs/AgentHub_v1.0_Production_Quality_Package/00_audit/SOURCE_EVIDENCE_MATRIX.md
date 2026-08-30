# Source Evidence Matrix

审计基线 `d09c575e2aaad749a8f0c822d89b3531d8634337`。

| 结论 | 源码证据 | 级别 |
|---|---|---|
| Home Hero 仍过高 | `apps/web/src/features/home/home.module.css`: `.hero min-height:385px` | 源码确定 |
| Home 项目卡仍过高 | 同文件 `.projectCard min-height:226px` | 源码确定 |
| Home 仍展示 rootPath | `HomePage.tsx` project card foot | 源码确定 |
| Workspace CSS 过大 | `workspace.module.css` ~78.8KB | 源码确定 |
| Workspace panel 结构已拆 | workspace/components tree | 源码确定 |
| Session Rail 已取消状态 badge wall | `SessionRail.tsx` 只渲染 state dot | 源码确定 |
| Conversation 仍合并 tool/thought/message | `buildConversationTimeline()` | 源码确定 |
| Composer 显式配置仍多 | `Composer.tsx` context / permission / terminal / model / mode / reasoning | 源码确定 |
| Git Changes 有二级 tabs | `GitChangesTree.tsx`: changes/diff/history/branches | 源码确定 |
| Diff fixed 420px/plaintext | `DiffViewer.tsx` | 源码确定 |
| Settings IA 未落地 | `/settings/:section` route + `SettingsPageView` 不读取 section | 源码确定 |
| Settings 有 v0.6 文案 | `SettingsPageView.tsx` | 源码确定 |
| Prompt 单页 1000+ 行 | `PromptLibraryPage.tsx` | 源码确定 |
| package version drift | root/web package `0.6.0`, Shell v0.9 | 源码确定 |
| visual evidence 断档 | `docs/qa/visual` 只有 v06 | 仓库确定 |
| 实际运行时像素是否与 CSS 完全一致 | 未获得当前部署 URL/截图，container 无法 clone/运行 | 需运行态复核 |

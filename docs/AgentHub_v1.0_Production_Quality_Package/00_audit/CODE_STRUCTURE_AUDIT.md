# 前端代码结构审计


> **审计基线**：GitHub `Kkwans/AgentHub` / `main`，commit `d09c575e2aaad749a8f0c822d89b3531d8634337`，审计日期 2026-08-30。本文中“当前实现”均指该基线；未能在本地启动真实部署的视觉结论会明确标为“需运行态复核”。


## v0.9 的正确迁移

旧 `features/v07/pages.tsx` 已被拆除，这是必要且正确的。当前 `App.tsx` 已按 feature lazy import，路由层比 v0.8 健康得多。

## 仍存在的结构债

### WorkspacePage 仍是 orchestration monolith

它同时处理：
- URL search params；
- panel layout；
- sessions/session/config/messages/runs/approvals/events/agents/projects query；
- terminal callbacks；
- prompt context；
- files/git queries；
- approval/send/stop/config/commit mutations；
- realtime invalidation；
- mobile focus trap；
- final layout render。

v1.0 应拆 hooks + view model，使页面成为 composition root。

### PromptLibraryPage 是业务 monolith

页面同时承担 asset list、filters、version lifecycle、label move、bindings、playground、diff、dialogs。

### Settings 仍使用旧组件/class contract

`SettingsPage.tsx` 只是 re-export，真正页面仍沿用 legacy `page-stack/control-section/v06-form`。

## 目标代码原则

- Page = data composition + route boundary。
- Feature hook = query/mutation/state orchestration。
- Component = one visual responsibility。
- CSS module = one component/surface responsibility。
- Design System = cross-feature geometry/interaction contract。

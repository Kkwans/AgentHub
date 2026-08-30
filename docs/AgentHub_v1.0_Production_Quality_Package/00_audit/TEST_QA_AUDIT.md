# Test / QA 审计


> **审计基线**：GitHub `Kkwans/AgentHub` / `main`，commit `d09c575e2aaad749a8f0c822d89b3531d8634337`，审计日期 2026-08-30。本文中“当前实现”均指该基线；未能在本地启动真实部署的视觉结论会明确标为“需运行态复核”。


## 现状

项目已有 Vitest、Playwright、real E2E、axe，工程基础很好。但 UI-first 产品缺少与当前版本同步的 visual evidence。

`docs/qa/visual` 当前只看到 v0.6 基线目录；real E2E 文件名/fixture 仍大量使用 v0.7 命名。

## v1.0 风险

- selector 与视觉文案强绑定，重构文案容易让测试变成“迁移成本”。
- visual tests 没有版本同步证据。
- 缺 long-data / overflow / geometry 专门 fixture。
- 缺 dark/light screenshot matrix。

## v1.0 QA 分层

1. Unit — tree/parsing/presentation/hooks。
2. Component — UI behavior。
3. E2E — high-value user journey。
4. Real E2E — agent/git/approval/terminal。
5. Visual — screenshots。
6. Geometry — bounding boxes。
7. Accessibility — axe + keyboard。
8. Performance — browser metrics。

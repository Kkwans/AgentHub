# Design System 审计


> **审计基线**：GitHub `Kkwans/AgentHub` / `main`，commit `d09c575e2aaad749a8f0c822d89b3531d8634337`，审计日期 2026-08-30。本文中“当前实现”均指该基线；未能在本地启动真实部署的视觉结论会明确标为“需运行态复核”。


当前 `@agenthub/ui` 已有颜色、radius、shadow、Mantine theme，这是基础，不建议替换框架。真正缺的是 **semantic layout system**。

## 当前缺口

- 没有 page gutter token。
- 没有 row height token。
- 没有 toolbar height token。
- 没有 panel header height token。
- 没有 semantic typography roles。
- 没有 content width contracts。
- 没有 density presets 的完整 component mapping。
- z-index 仍主要依赖局部值。
- Workspace 直接覆盖 global accent semantic。

## v1.0 补齐

详见 `02_design_system/`。核心要求：Mantine variables 做底座，AgentHub 自己只扩展产品语义，而不是复制一套互相冲突的 theme。

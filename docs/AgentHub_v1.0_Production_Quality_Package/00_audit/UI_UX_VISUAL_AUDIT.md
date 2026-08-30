# UI / UX / 视觉质量深度审计


> **审计基线**：GitHub `Kkwans/AgentHub` / `main`，commit `d09c575e2aaad749a8f0c822d89b3531d8634337`，审计日期 2026-08-30。本文中“当前实现”均指该基线；未能在本地启动真实部署的视觉结论会明确标为“需运行态复核”。


## 评分框架（当前约 5/10 的原因）

### 1. Layout Geometry — 5/10

优点：已经有统一 AppShell、Workspace 有 resizable panels。

问题：Home、Projects、Settings、Prompt、Workspace 各自拥有不同 spacing logic；很多尺寸是 feature-local magic number。`AppShell.main=24px`，共享 Screen stack=28px，Home gap=24px，Project page gap=18px，Workspace 又是独立 54px/16px 系统。单独看都“合理”，组合起来却没有强烈品牌秩序。

### 2. Density — 4/10

- Home hero 385px；项目卡 226px。
- Project row 88px + 52px logo，后台感强。
- Settings 一次展示太多系统块，认知密度高但有效行动密度低。
- Workspace Inspector narrow area 仍保留多层 tab/commit form。

### 3. Typography — 5.5/10

全局 Inter，Workspace Geist；中文 fallback 不完全同一 stack。项目大量 meta 10.5–12px，商业软件可以使用小字，但“必须理解的信息”不应依赖 10.5px。

### 4. Hierarchy — 5/10

一些页面使用 eyebrow + 大标题 + description + surface title + card title，多层标题堆叠；Workspace 则过度扁平。产品全局 hierarchy 没有统一语义层。

### 5. Interaction — 6/10

功能很多，但“能力存在”与“能力自然使用”有差距。典型：Git changes / Diff / history / branches 双层 navigation；Terminal 控件嵌 Composer；Settings route section 未落地。

### 6. Polish — 4.5/10

缺 v0.9 visual baseline；版本残留；fixed 420px Diff；current version 多处不一致。这些都属于 1.0 不应出现的 finish quality 问题。

## 视觉反模式清单

1. 大 Hero + 小正文。
2. 过多圆角 Card。
3. 同页 10/11/12/13/14/15/18 等大量细碎字号。
4. 绝对路径作为常驻信息。
5. Surface 嵌 Surface 再嵌 chip。
6. Tab within Tab。
7. fixed-height editor。
8. 大面积 `justify-content:space-between` 导致信息被拉到屏幕两端。
9. Toolbar 所有过滤器全露出。
10. Empty state 占据大块首屏却缺少下一步上下文。

## v1.0 视觉方向

**Calm Precision**：浅灰白 canvas、低阴影、细边界、紫色只用于 active/primary/focus，内容密度接近 Codex / VS Code / Linear，而不是 Dashboard template。

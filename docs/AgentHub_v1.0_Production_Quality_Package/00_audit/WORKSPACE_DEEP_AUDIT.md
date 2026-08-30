# Workspace 深度审计


> **审计基线**：GitHub `Kkwans/AgentHub` / `main`，commit `d09c575e2aaad749a8f0c822d89b3531d8634337`，审计日期 2026-08-30。本文中“当前实现”均指该基线；未能在本地启动真实部署的视觉结论会明确标为“需运行态复核”。


## 1. 页面责任过重

WorkspacePage 当前已经超过单纯布局容器的职责。建议将数据层拆为 6 个 hooks，UI 树只接收 ViewModel。

## 2. Session Rail

### 已改善
- 搜索；
- 新建；
- 今天/昨天/更早；
- 状态点；
- repo basename 而非完整路径。

### v1.0 仍需
- 活跃会话置顶分组；
- CLOSED 历史折叠；
- pin/recent；
- title truncation tooltip；
- keyboard ↑↓ navigation；
- 50+ session virtualization（至少预留）。

## 3. Conversation

当前 timeline 仍将 tool event、thought 与 message 混合排序。功能正确但阅读体验不是 conversation-first。

v1.0：
- thought 合并成可折叠 “Reasoning/Thinking” group；
- tool call 合并为 “执行 4 个操作” summary；
- raw details 进入 Activity；
- message markdown 加 code action/copy；
- long conversation windowing。

## 4. Composer

当前 context strip 仍承担 context + permission + terminal + model + mode + effort。应减少显式控件数量，Terminal 移出，model/mode/effort 合并。

## 5. Inspector

主 tab 已合理，但 Changes 中再次出现 4 sub-tabs，破坏连续 review。

## 6. Diff

- fixed 420px；
- plaintext；
- unified patch 手工 reconstruction；
- tree 与 diff 不能持续共存。

这是 v1.0 Workspace 最大视觉/体验 P0。

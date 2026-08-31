# Phase 1 设计系统真实视觉证据复核

状态：Phase 1 共享设计令牌、主题、密度、布局原语和 Workbench 结构已完成真实应用矩阵复核；本目录不是完整 v1.0 RC 证据。

## 证据范围

- 源码：`e0b726f272241bf03d0cadf29360a9e9529d9b66`（`main`）。
- 目标：NAS `DH4300Plus` / `aarch64` 上由当前源码启动的隔离 real server，临时 PGlite 与临时 Git fixture；生产 `agenthub` 容器未修改。
- 运行时：Node 24.18.0；Chromium `/home/Kkwans/.cache/ms-playwright/chromium-1234/chrome-linux/chrome`（Chromium 151.0.7922.34）；浏览器以 `Kkwans:video` 运行。
- 矩阵：10 条真实路由 × 7 个视口（1920、1600、1440、1280、1024、768、390）× Light/Dark，共 140 张 PNG。
- 证据文件：`audit.json`、`geometry.json`、`SHA256SUMS` 与本复核记录。

## 自动门禁结果

- 140/140 页面成功截图；`audit.json.complete: true`。
- 0 console error、0 page error、0 failed request、0 横向溢出、0 未命名按钮、0 hidden focus。
- Light/Dark 均被真实页面解析为对应主题。
- `geometry-audit`：140 个快照、`passed: true`、0 violations。
- `geometry.json.releaseReady: false` 是脚本的预期语义：当前仅为 Phase 1 基线测量，不代表完整 v1 几何门禁已通过。

## 人工抽查与发现

抽查了宽屏 Home（Light/Dark）、Workspace（桌面与手机）、Settings Appearance 手机暗色和 Projects 平板 Light。令牌后的背景、文字层级、控件可读性及移动端壳层稳定；手机截图没有横向溢出。Workspace 与 Settings 的已有业务状态仍按旧页面行为渲染，不能替代后续状态专项验收。Home 壳仍显示历史 `v0.9` 标签，这是 Phase 0 已记录的版本事实漂移，不能在 Phase 1 伪装成 `1.0.0`。

## 修正轮次

1. 第一轮：完成 canonical token、Mantine theme、共享 control/layout primitive、Light/Dark 与 comfortable/compact 密度实现。
2. 第二轮：将真实截图改为 CDP 捕获，并把 Chromium 临时目录隔离到 `/dev/shm`；这是 NAS QA 运行稳定性修正，不是产品行为绕过。
3. 完整 140 张矩阵完成后，自动门禁和人工抽查未发现需要立即回改的 Phase 1 阻断项，因此没有追加局部视觉补丁。

## 未验证项与后续门禁

以下状态或几何规则不在本基线范围，必须由后续 Phase/RC 专项证据补齐：login、loading、error、running、approval、failed、closed、git-changes、terminal；`table-column-alignment`、`state-frame-shift`、`composer-readable-column`、`drawer-width`。这些未验证项已保留在 `geometry.json.unverifiedStates` 和 `unmeasuredRules`。

本次没有生产部署；生产回滚点仍为现运行镜像 `agenthub:0.8.0-nas.d09c575`，生产健康状态与数据卷未触碰。

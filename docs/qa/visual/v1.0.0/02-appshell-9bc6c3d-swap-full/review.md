# Phase 2 AppShell 真实视觉证据复核

状态：Phase 2 全局壳层、导航、命令面板与页面几何已完成真实应用矩阵复核；本目录不是完整 v1.0 RC 证据。

## 证据范围

- 源码：`9bc6c3df6fc785a76a86a917ed3e19acee6e267f`（`main`）。
- 目标：NAS `DH4300Plus` / `aarch64` 上由当前源码启动的隔离 real server，临时 PGlite 与临时 Git fixture；生产 `agenthub` 容器未修改。
- 运行时：Node 24.18.0；Chromium `/home/Kkwans/.cache/ms-playwright/chromium-1234/chrome-linux/chrome`（Chromium 151.0.7922.34）；浏览器以 `Kkwans:video` 运行。Playwright 临时目录位于 `/dev/shm`，避免 NAS `/tmp` 空间压力。
- 矩阵：10 条真实路由 × 7 个视口（1920、1600、1440、1280、1024、768、390）× Light/Dark，共 140 张 PNG。
- 证据文件：`audit.json`、`geometry.json`、`SHA256SUMS` 与本复核记录。

## 自动门禁结果

- 140/140 页面成功截图；`audit.json.complete: true`。
- 0 console error、0 page error、0 failed request、0 横向溢出、0 未命名按钮、0 hidden focus。
- Light/Dark 均被真实页面解析为对应主题。
- `geometry-audit`：140 个快照、`passed: true`、0 violations。
- `geometry.json.releaseReady: false` 是脚本的预期语义：当前仅为 Phase 2 基线测量，不代表完整 v1 几何门禁已通过。

## 人工抽查与发现

抽查了 Light Home 宽屏、Dark Projects 1024、Light Workspace 桌面和 Dark Home 手机。AppShell 展开态侧栏约 220px，顶部栏约 56px，页面 gutter 与令牌一致；深色 Projects 的导航、Infrastructure 次级分组和表格内容可读；390px 页面使用移动壳层且无横向溢出。Workspace 当前仍在 AppShell 外独立挂载，截图保留现有业务布局，必须由 Phase 3 的 Workspace 专项验收覆盖。Home 壳仍显示历史 `v0.9` 标签，这是 Phase 0 已记录的版本事实漂移，不能在本阶段伪装成 `1.0.0`。命令面板的分组、模糊搜索和键盘行为已由 AppShell 单测覆盖，未纳入基线自动截图路由。

## 修正轮次

1. 第一轮：收口 AppShell 的侧栏、顶部栏、主内容 gutter、导航分组和命令面板到共享令牌，并移除宽屏自动折叠造成的几何漂移。
2. 第二轮：使用 NAS 本地 CDP Chromium 完成 140 张真实截图；将 Playwright 临时目录隔离到 `/dev/shm`，这是 QA 运行稳定性修正，不是产品行为绕过。
3. 完整矩阵和人工抽查未发现需要立即回改的 Phase 2 阻断项，因此没有追加局部视觉补丁。

## 未验证项与后续门禁

以下状态或几何规则不在本基线范围，必须由后续 Phase/RC 专项证据补齐：login、loading、error、running、approval、failed、closed、git-changes、terminal；`table-column-alignment`、`state-frame-shift`、`composer-readable-column`、`drawer-width`。这些未验证项已保留在 `geometry.json.unverifiedStates` 和 `unmeasuredRules`。

本次没有生产部署；生产回滚点仍为现运行镜像 `agenthub:0.8.0-nas.d09c575`，生产健康状态与数据卷未触碰。

# v1.0 Release Hygiene 审计


> **审计基线**：GitHub `Kkwans/AgentHub` / `main`，commit `d09c575e2aaad749a8f0c822d89b3531d8634337`，审计日期 2026-08-30。本文中“当前实现”均指该基线；未能在本地启动真实部署的视觉结论会明确标为“需运行态复核”。


## 已确认的不一致

| 位置 | 当前值 |
|---|---|
| root package.json | 0.6.0 |
| apps/web/package.json | 0.6.0 |
| AppShell badge | v0.9 |
| README 当前版本 | v0.6.0 |
| README 镜像 | agenthub:0.6.0-* |
| real E2E fixture | v0.7 E2E Project / v07-workbench |
| UI styles comment | v0.8 foundation |
| Settings copy | v0.6 范围 |

## v1.0 必须执行

1. version source of truth 脚本；
2. release grep gate；
3. README 重写；
4. CHANGELOG 1.0；
5. release doc；
6. Docker tags；
7. screenshot baseline manifest；
8. migration/backup notes；
9. known limitations 明确化。

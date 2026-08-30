# Migration / Rollback

v1.0 主要前端重构应尽量保持数据 schema 兼容。

若引入 message pagination / git diff endpoint：保持旧 endpoint 一段兼容期或一次性同步迁移前端。

发布前：
- PGlite/Postgres backup
- clean install
- upgrade from v0.9 current data
- rollback image retained
- migration idempotency

UI release 失败时不应要求回滚用户业务数据。

# ADR-003：PGlite 到 PostgreSQL

状态：接受。日期：2026-08-09。

默认使用 PGlite 文件模式，配置 `DATABASE_URL` 时切换 PostgreSQL。两种模式共享 Drizzle schema、migration 和不变量测试，避免后续迁移重写领域层。

# ADR-010：v0.1 不引入 Memory、Redis 与向量库

状态：接受。日期：2026-08-09。

v0.1 的持久化需求由 PostgreSQL/PGlite 与文件 artifact 满足。不实现 Memory/RAG，不引入 Redis、队列或向量数据库，避免未有产品闭环前增加运维面。

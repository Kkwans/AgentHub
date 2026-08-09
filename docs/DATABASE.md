# 数据库设计

## 运行模式

- 默认：PGlite 文件模式，数据目录位于 `AGENTHUB_DATA_DIR`。
- 外部：设置 `DATABASE_URL` 后使用 PostgreSQL。
- 两种模式共享 Drizzle schema、migration 与 repository/service 边界。

## 关键不变量

- Prompt Version 创建后不可更新；变更内容只能创建新版本。
- Prompt Label 移动在事务中完成。
- Approval exactly-once，重复响应返回同一已决结果且不会再次投递给 Agent。
- Agent Event 使用 `UNIQUE(session_id, seq)`，`seq` 在 Session 内单调递增。
- Session、Run、Task 的非法状态跳转在 service 层拒绝。
- Run 保存解析后的 Prompt version、label、hash 与 provenance。

## JSON 使用边界

`execution_targets.connection_json` 与 `agents.config_json` 只保存扩展配置。核心状态、容器名、期望 container ID、启动策略与工作区映射保持可查询字段或受约束结构，不把全部语义塞入 JSON。

## 迁移原则

- migration 向前追加，不修改已经发布的 migration。
- destructive migration 必须先备份并单独授权。
- 恢复优先使用发布前数据库备份；down 脚本只在可无损恢复时提供。
- v0.1 只有初始向前 migration，不提供破坏性 down；PGlite 恢复必须在服务停止后替换整个备份目录，PostgreSQL 使用数据库级备份恢复。

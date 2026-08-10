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
- `worktree_executions` 以 partial unique index 保证每个 Task 只有一个活跃 Execution、
  每个 Project 只有一个正在设置/运行/审阅/合并的 Execution；`QUEUED` 可按 FIFO 并存。
- Worktree Execution 的状态更新带当前状态条件；Task 与 Execution 的关联状态在同一事务移动。
- Remote Node registration token 只保存 SHA-256 hash，并通过 `used_at`/`revoked_at` 原子限制为一次性；明文不落库。
- 每个 Remote Node 只关联一个 `REMOTE_NODE` Execution Target；target ID 与 Ed25519 fingerprint 均有 unique index。
- Remote Node 状态只允许 `ONLINE | OFFLINE | REVOKED`，roots、inventory、protocol/daemon version 与 `last_seen_at` 可查询；private key 永不进入中央数据库。

## JSON 使用边界

`execution_targets.connection_json` 与 `agents.config_json` 只保存扩展配置。核心状态、容器名、期望 container ID、启动策略与工作区映射保持可查询字段或受约束结构，不把全部语义塞入 JSON。

## 迁移原则

- migration 向前追加，不修改已经发布的 migration。
- destructive migration 必须先备份并单独授权。
- 恢复优先使用发布前数据库备份；down 脚本只在可无损恢复时提供。
- `0000_brown_secret_warriors.sql` 为 v0.1 初始 migration；
  `0001_tidy_kinsey_walden.sql` 仅向前增加 `worktree_executions`、约束与索引；
  `0002_certain_squadron_supreme.sql` 仅向前增加 Remote Node 注册码、设备、外键与唯一索引。
- 应用回退不会自动删除 v0.2 表或磁盘 worktree。需要回退数据库时，先优雅停止服务并
  恢复升级前的 PGlite 整目录/PostgreSQL 数据库备份；不手工删除 migration 记录。

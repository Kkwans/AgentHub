# AgentHub v0.6 nas.28 发布核验

日期：2026-08-16

## 本次切片

nas.28 包含 Approval 决策卡片的中文状态/诊断分层、Session 列表状态点、Task/Worktree 错误文案和
Runtime Docker 状态文案收口。原始错误码与供应商状态不再出现在普通用户主视图，只在“显示诊断信息”中保留。

## 发布结果

- 主机：`DH4300Plus`，`aarch64`
- Compose：`/volume2/DockerProject/agenthub/docker-compose.yml`
- Docker project/service：`agenthub` / `agenthub`
- 入口：`http://192.168.5.110:3210/`
- 镜像：`agenthub:0.6.0-nas.28`
- image ID：`sha256:da15594462db9e5f07f829f48a677b2e0fb15f6c3c0575241ac4ca7f19323df8`
- revision：`018a03b`
- 容器：`98f3cd8753fc`，`running/healthy`
- 备份：`/volume2/Project/.agenthub/central/deployments/20260816T103844Z-pre-nas28/`

## 最小运行检查

- `docker compose config --quiet`：通过
- `/api/v1/health`：HTTP 200，`version=0.6.0`、`database=pglite`、`web=true`
- 根页面：HTTP 200
- 容器内 `node-pty`：`READY`
- 运行 bundle 包含 Runtime 中文状态（`容器正在运行`）与 Worktree 中文错误文案（`合并存在冲突`）
- 发布只执行 `docker compose up -d --no-build agenthub`；没有执行 `compose down`，没有删除镜像、卷、用户数据或其他 Agent 容器

## 验证边界

本轮按用户要求以编译门禁为主：最新代码已通过 `lint`、`typecheck`、`build`；全仓测试与 TX5Pro/人工视觉验收留到最终集中门禁，不能据此声明视觉通过。

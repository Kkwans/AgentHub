# AgentHub v0.6 Compose 发布验收

日期：2026-08-14
结果：`PASS`
部署目录：`/volume2/DockerProject/agenthub`
访问地址：`http://192.168.5.110:3210`

## 变更范围

- 使用已推送 commit `c167d4f` 的源码构建 `agenthub:0.6.0-nas.1`，OCI revision 为
  `c167d4f`，镜像架构为 Linux ARM64。
- 仅升级 Compose project `agenthub` 的 `agenthub` service；没有执行 `docker compose down`，
  没有删除镜像、卷、用户数据或其他 Agent 容器。
- 版本来源已统一：健康接口、共享版本常量、ACP clientInfo、workspace package metadata 与
  Compose 默认值均为 `0.6.0`。

## 备份与回滚

升级前已保留 root-only 备份：

`/volume2/Project/.agenthub/central/deployments/20260814T045513Z-pre-v06/`

备份包含正式 `docker-compose.yml`、`.env`、旧 `secrets/browser-token` 以及文件校验信息。
随后在仅停止 `agenthub` service 的窗口内，另行创建了 data/worktrees 归档：

`/volume2/Project/.agenthub/central/deployments/20260814T054956Z-v06-data-backup/central-data-worktrees.tar.gz`

SHA-256：`672fef18fdf6b3920780d5e3d32cd82495f84d656cd8e92d35647c283f2b9755`。
归档范围为 PGlite data 与 worktrees；没有删除、覆盖或迁移其他项目数据。回滚时只恢复该
Compose project 的旧 `.env`/镜像并重建 `agenthub` service，不执行全局清理；只有在确认数据
恢复必要时才使用该归档。

## 结果

- `docker compose config --quiet` 通过；正式 Compose 仍登记为 Docker project `agenthub`。
- 正式镜像：`agenthub:0.6.0-nas.1`；image ID：`sha256:6c172943ca9c25414cde7237883447a20b09fd4f5f6cfd7e374d958dc986f8eb`。
- 容器 ID：`4a0b69001d9ad0fe13a4d9bf6116391d73ee26accbe54c2d3db37c96c3d35a84`；状态
  `running/healthy`；`user=0:0`、`privileged=true`、`restart=unless-stopped`。
- 健康接口返回：`status=ok`、`version=0.6.0`、`database=pglite`、`web=true`。
- 入口继续监听 `192.168.5.110:3210`，根页面返回 `200` 并提供 `lang=zh-CN` 的 SPA 入口。
- `docker ps` 对比确认既有 Agent 与 NAS 容器仍保持原运行状态；未操作 Claude Code、Hermes、
  OpenClaw 容器。

## 代码门禁

- `corepack pnpm typecheck`：通过；
- `corepack pnpm lint`：通过；
- `corepack pnpm build`：通过，Web 转换 1710 modules；
- `TMPDIR=/dev/shm/agenthub-v06-release-test6 corepack pnpm test`：44 个文件通过、3 个跳过，
  182 passed、7 skipped；
- `TMPDIR=/dev/shm/agenthub-v06-live8 AGENTHUB_E2E_LIVE=1 corepack pnpm test:live`：3 个文件、7 个
  测试通过，覆盖 Remote Node/Codex、Worktree→Review→Merge 与 Docker Agent smoke；首次失败的
  Worktree fixture 已通过显式 workspace root 配置修复。
- GitHub Actions run `31773985580`（commit `c72ba6e`）：全绿，lint、typecheck、test、build 和
  Playwright E2E 均通过（2m59s）。
- 真实浏览器/TX5Pro 视觉验收：本轮没有可用浏览器通道，保持未验证，不将 curl、fixture 或静态
  build 结果等同于视觉验收。

## 回滚边界

本次没有执行 `docker compose down`，没有删除镜像、卷、用户数据，也没有修改其他 Compose project。
旧 image、旧 Compose 与 root-only 配置备份均保留。

# AgentHub v0.3 NAS 部署验收

- 日期：2026-08-10
- 主机：`DH4300Plus`（Linux ARM64）
- 结果：PASS
- 部署方式：host-native Node.js 24 + systemd
- 服务：`agenthub.service`，`enabled`、`active/running`
- 运行用户：`Kkwans:admin`
- 地址：`http://127.0.0.1:3210`
- 认证：`local_trusted`，不监听局域网地址
- 数据库：PGlite
- Docker：没有创建 AgentHub 容器，也没有修改或启停现有 Agent 容器

## 上线前状态

- 无 `agenthub.service`、`/etc/agenthub/agenthub.env` 和正式数据目录；
- NAS `3210` 无监听；
- `claude-code`、`hermes`、`openclaw-official` 均保持原 `exited` 状态。

## 安装结果

- unit：`/etc/systemd/system/agenthub.service`，mode `0644`、owner `root:root`；
- env：`/etc/agenthub/agenthub.env`，mode `0640`、owner `root:admin`；
- PGlite：`/volume2/Project/.agenthub/central/data`，mode `0700`、owner `Kkwans:admin`；
- Worktree：`/volume2/Project/.agenthub/central/worktrees`，mode `0700`、owner `Kkwans:admin`；
- source commit：`913b34d39788d3bc2b51e1d679807ede4dd4fc84`；
- Server/runtime dist tree SHA-256：`34d21f31d6e218043a10e781d4b271fded9ec16e09c38ec1e397e3b98eee56a8`；
- Web dist tree SHA-256：`5b054119dd4653bbe352b7c3a1433129025b6507fbdb5dd9bce40b5703fc9e44`；
- installed unit SHA-256：`c397e39a339aed0d2db95f25f2ac07ee6f3cc15d44c8080bf34a15913c5ca8aa`；
- installed env SHA-256：`4a54096dc60900163391382c85df0bfeb47e6d35be46f3f734c85500a3cdf8a9`。

健康接口返回：

```json
{ "data": { "status": "ok", "version": "0.3.0", "database": "pglite", "web": true } }
```

`ss` 只发现 `127.0.0.1:3210`，未发现 `0.0.0.0:3210` 或 IPv6 通配监听。

## 自身 Project

- Execution Target：`2c23ee6b-f60b-4c91-acc2-5c8e807974c2`，`AgentHub NAS 宿主机`，`LOCAL_HOST/READY`；
- Project：`6d1ca2e6-f1a2-4250-a1ae-1e4e962272a0`，`AgentHub`，`ACTIVE`；
- root：`/volume2/Project/AgentHub`，realpath 一致；
- preflight：路径、读写权限、Git/main、AGENTS.md 和 pnpm 探测全部 PASS；
- 只读文件树：成功返回 29 个根条目。

受控重启后 MainPID 从 `870876` 变为 `872644`，健康恢复；同一 target 和 Project ID 仍可查询，证明 PGlite 持久化与 systemd 重启恢复有效。

最终全仓 Vitest 首次运行因 NAS `/tmp` tmpfs 已被其他项目缓存占到 100% 而出现 `ENOSPC`，不是断言回归；未删除这些缓存。改用非 dot-path 的 `/dev/shm/agenthub-test-tmp` 后，33 个文件通过、3 个 live 文件按 gate 跳过，114 项通过、7 项跳过。曾尝试的 `.agenthub/test-tmp` 因 Express `sendFile` 按设计忽略 dot-path，使 SPA fixture 单项返回 500；聚焦诊断后改用非 dot-path，7 项 HTTP 测试与全仓均通过。

## 回滚

部署前不存在旧服务，因此没有可覆盖备份。需要恢复上线前状态时：

1. `sudo systemctl disable --now agenthub.service`；
2. 保留 `/volume2/Project/.agenthub/central`，不要删除数据库或 worktree；
3. 保留 `/etc/agenthub/agenthub.env` 与 unit 作为可恢复配置，或经人工确认后移动到备份位置；
4. 代码回滚到已验证 commit 后重新 build，再安装对应 unit/env 并启动；
5. 复核健康、Project、容器状态和 `127.0.0.1:3210`。

本次没有执行删除、Compose 变更、容器生命周期操作或数据迁移。

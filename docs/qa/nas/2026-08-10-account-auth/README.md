# AgentHub 管理员登录 Compose 更新验收

- 日期：2026-08-10
- 主机：`DH4300Plus`（Linux ARM64）
- 结果：PASS
- Compose Project：`agenthub`
- 当前镜像：`agenthub:0.3.0-nas.2`
- image ID：`sha256:4cccdfbf8549bd951636eb899f93ec8f4430fc9b5916af8f72dc2997d3e9a41d`
- OCI revision：`0d80395a47cdb404b980e53956665ad23862f99a`
- 地址：`http://192.168.5.110:3210`

## 数据保护与部署

更新前停止的目标只有 `agenthub`。PGlite、部署配置和 root-only secret 的冷备份位于：

```text
/volume2/Project/.agenthub/central/deployments/20260810T195343-pre-account-auth/
```

随后以既有 Compose Project 执行单服务更新，没有运行 `docker compose down`，没有删除
container、image 或 volume，也没有修改任何现有 Agent Compose。新容器继续使用 `0:0`、
`privileged=true`、`restart=unless-stopped`，并只发布 `192.168.5.110:3210`。

数据库 migration `0003_sweet_owl.sql` 只向前新增 `local_accounts` 与 `browser_sessions`；密码
使用 scrypt hash，浏览器会话只保存 token 的 SHA-256 hash。既有 Project、Execution Target
和 Agent 数据不改写。

## 重启恢复证据

受控执行 `docker compose restart agenthub` 后：

- 容器恢复 `running/healthy`，镜像、root 用户、privileged 与 restart policy 均未变化；
- `/api/v1/health` 返回 `status=ok`、`version=0.3.0`、`database=pglite`、`web=true`；
- `/api/v1/auth/status` 返回 `setupRequired=true`、`authenticated=false`，说明首次设置状态从
  正式数据库恢复；
- Project ID 仍为 `6d1ca2e6-f1a2-4250-a1ae-1e4e962272a0`；
- Execution Target ID 仍为 `2c23ee6b-f60b-4c91-acc2-5c8e807974c2`。

Claude Code、Hermes 与 OpenClaw 保持原完整 container ID、镜像和 `exited` 状态：

```text
claude-code       9d8cbc9b82062c31d962c3829a49afe931087edef5691b96f96ba1ec5c339281
hermes            cdcfb3fe1b1a542160b8e9d74725aa54a8da6a2f31f7cad2448ae9141b6799d0
openclaw-official 433abd2cfd7687ca393ae5de4f3458959a29746a2a8130bcb39e1e3bb96a571e
```

## 产品与安全结果

- 浏览器先经过公开的账号状态端点，未登录时不会提前请求受保护 Query 或建立重试中的
  WebSocket；
- 首次设置和后续登录只使用用户名/密码，服务端通过 HttpOnly、SameSite=Strict Cookie 管理
  7 天浏览器会话；
- 登录失败按来源限流，改密会撤销旧会话；Cookie、密码字段和供应商错误进入日志前脱敏；
- API token 仅保留给 CLI/外部集成，并收纳在设置页的折叠高级区域，不再用于普通网页登录；
- 旧 root-only API token 仅用于本轮无密文输出的兼容性数据回归和回滚，不作为用户操作步骤。

TX5Pro 的正式首次设置页证据见
[管理员登录实机验收](../../../tx5pro/2026-08-10-account-auth/README.md)。

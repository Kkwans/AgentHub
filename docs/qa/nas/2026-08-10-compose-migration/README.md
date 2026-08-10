# AgentHub v0.3 Docker Compose 迁移验收

> 历史证据：本轮的 root-only token 只用于证明 Compose 迁移期间认证没有失效。它不再是
> 普通用户登录方式；现行网页登录由 ADR-015 的管理员账号与 HttpOnly Cookie 提供。

- 日期：2026-08-10
- 主机：`DH4300Plus`（Linux ARM64）
- 结果：PASS
- Compose Project：`agenthub`
- 配置目录：`/volume2/DockerProject/agenthub`
- 容器：`agenthub`，`root (0:0)`、`privileged=true`、`restart=unless-stopped`
- 地址：`http://192.168.5.110:3210`
- 认证：`token`
- 数据库：原 PGlite 数据目录原位挂载

## 迁移与回滚边界

迁移前先停止 host-native 服务并完成冷备份：

```text
/volume2/Project/.agenthub/central/deployments/20260810T102845Z-pre-compose/
```

备份包含 PGlite `data`、原 `agenthub.service`、原 `agenthub.env` 和 Compose 配置快照。
正式数据没有复制到新的数据库，也没有删除；Compose 继续挂载
`/volume2/Project/.agenthub/central/data`、`worktrees` 和 `tmp`。原 systemd unit/env 保留，
服务最终为 `inactive`、`disabled`。

回滚时先停止 AgentHub Compose，再恢复备份中的 unit/env 并启用 systemd。由于两套 runtime
绝不并发打开同一 PGlite 数据目录，因此不需要数据格式转换。不得在 Compose 仍运行时启动
systemd。

## Compose 与绿联项目注册

Compose 文件使用顶层 project name `agenthub`，保存在绿联 Docker Project 的标准目录
`/volume2/DockerProject/agenthub`。最终枚举结果包含：

```json
{
  "Name": "agenthub",
  "Status": "running(1)",
  "ConfigFiles": "/volume2/DockerProject/agenthub/docker-compose.yml"
}
```

该结果来自 Docker Compose 的正式 project metadata/labels；没有修改绿联私有数据库，也没有
伪造项目记录。

## 安全与挂载

- 容器按用户明确要求使用 `user: 0:0` 和 `privileged: true`；
- 端口只绑定 NAS LAN 地址 `192.168.5.110:3210`，不是 `0.0.0.0`；
- 非 loopback 入口强制 token auth，未认证 `/api/v1/projects` 返回 401；
- 一次性浏览器 token 只保存在
  `/volume2/DockerProject/agenthub/secrets/browser-token`，文件和父目录均为 root-only；
- Compose 显式挂载 Project、PGlite、worktrees、TMPDIR、Codex home 引用、只读 Git 配置、
  Docker socket 和只读 Docker CLI；
- root Git 通过 `SUDO_UID=1000` 和只读宿主机 Git 配置识别仓库 owner，没有配置
  `safe.directory=*`；
- Docker socket 与 privileged/root 等价于 NAS 高权限控制面，设置页持续展示该风险。

## 运行与恢复验证

- image：`agenthub:0.3.0-nas.1`；
- Node.js：`24.19.0`；Git：`2.39.5`；Docker client/server：`29.4.3`；
- health：`status=ok`、`version=0.3.0`、`database=pglite`、`web=true`；
- listener：`192.168.5.110:3210`；
- WebSocket：token subprotocol 成功协商为 `agenthub-v1`；
- Project：`6d1ca2e6-f1a2-4250-a1ae-1e4e962272a0`，`AgentHub/ACTIVE`；
- Execution Target：`2c23ee6b-f60b-4c91-acc2-5c8e807974c2`，
  `AgentHub NAS 宿主机/LOCAL_HOST/READY`；
- Project preflight：路径、读写权限、Git/main、AGENTS.md 和 pnpm 均 PASS；
- 受控 `docker compose restart agenthub` 后容器恢复 healthy，同一 Project/Target、认证和
  WebSocket 均可用。

迁移前后没有修改、启动、停止或删除 `claude-code`、`hermes`、`openclaw-official`；三者
保持原完整 container ID、原镜像和 `exited` 状态。本次也没有执行 `docker compose down`、
删除 image/container/volume 或修改现有 Agent Compose。

## 浏览器证据

TX5Pro 从局域网直接访问正式 Compose 服务，四种视口、认证、WebSocket、命令面板、移动导航
和设置页风险提示均通过。机器可读报告和截图见
[TX5Pro Compose LAN 验收](../../../tx5pro/2026-08-10-compose-lan/README.md)。

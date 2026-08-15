# AgentHub v0.6 Workspace 事件中文展示与 NAS nas.10 发布验收

日期：2026-08-16

结果：`PASS / VISUAL_GATE_PENDING`

代码：`ea51790`（`fix(workspace): 将 Agent 事件类型统一为中文展示`）

访问地址：`http://192.168.5.110:3210`

## 本次用户体验切片

- Workspace 工具卡不再把 `tool.call.completed` 等内部 Agent 事件枚举直接展示给普通用户。
- 新增统一的 `labelAgentEventType` 展示层，正常视图显示中文事件标签；原始协议值仍只应出现在调试视图。
- `Agent Plan` 默认标题改为“Agent 执行计划”，保留 Agent 这一专业名称。
- 新增 domain label 单测和 Workspace 页面回归，覆盖已知事件与未知事件的安全降级。

## 自动化证据

- `corepack pnpm lint`：通过。
- `corepack pnpm typecheck`：通过。
- `corepack pnpm test`：非沙箱环境通过 47 个文件，`191 passed / 9 skipped / 200 total`。
- 聚焦回归：`domain-labels.test.ts` 与 `WorkspacePage.test.tsx` 共 11/11 通过。
- `corepack pnpm build`：通过；Web `1715 modules transformed`；保留既有 chunk-size advisory。
- `corepack pnpm test:e2e`：24/24 通过，覆盖 1440/1024/768/390 fixture、URL 恢复、键盘、无横向溢出与 axe；
  fixture 的 `/ws` `ECONNREFUSED` 是没有本地后端时的预期隔离噪声，不替代人工视觉验收。
- GitHub Actions run `31895892171`（commit `ea51790`）：`verify` 成功。

## NAS 发布证据

- 目标：`DH4300Plus`、`aarch64`；Compose project `agenthub`；正式 Compose
  `/volume2/DockerProject/agenthub/docker-compose.yml`；端口 `192.168.5.110:3210`。
- 发布前备份：`/volume2/Project/.agenthub/central/deployments/20260815T163614Z-pre-nas10/`。
  Compose SHA-256 `0e3e92b7078a4a6cfde4fa8c5493539ffac0e238f1aa570ff689606a095f27ff`；旧 `.env` SHA-256
  `2c2f6d19abcc470fe55e05d68c24fc62b8576302b856d51080f8c113292300f8`；browser-token 仅保留 hash
  `d1e3d6d77a351bd669f975c32b414d8c9cd581e2e8fe87a11a4e0a64290db087`。
- 镜像：`agenthub:0.6.0-nas.10`，Linux ARM64，image ID
  `sha256:9ad53fbd6e9e80c2be9eec14286970d68eded41ab119eb5fb73c78e998932e2a`，OCI revision `ea51790`；
  基于已验证 `agenthub:0.6.0-nas.9`，由 `deploy/compose/Dockerfile.nas-overlay` 仅覆盖 server/web dist。
- 容器：`e732efb2aa54af8b30d8899613c20ef43f0bbcf8dee42dd6984e7c2b779febcd`，最终
  `running/healthy`、`user=0:0`、`privileged=true`、`restart=unless-stopped`；
  `AGENTHUB_PROJECT_OWNER_UID/GID=1000:10`。
- `.env` 更新后 SHA-256：`2dac8995a2581a09e4ecaa01c9f2256c606c99138480c06f55c17cac8440f3ba`；Compose 文件未改动，
  SHA-256 仍为 `0e3e92b7078a4a6cfde4fa8c5493539ffac0e238f1aa570ff689606a095f27ff`。
- `/api/v1/health` 返回 `status=ok`、`version=0.6.0`、`database=pglite`、`web=true`。
- 授权 `/api/v1/settings/capabilities` 返回 `terminal.available=true`、`code=READY`、
  `platform=linux`、`arch=arm64`；`remoteNode.available=true`、`transport=outbound_websocket`。
- 真实 Terminal API smoke：Project `6d1ca2e6-f1a2-4250-a1ae-1e4e962272a0` 完成 open、
  input `printf pty-nas10-ok\\n`、close；Terminal ID `b3508015-14ad-4094-9dd5-bd1c7d20a6cc`。
- 独立容器 `node-pty` smoke：`spawn=function`，输出包含 `pty-nas10-ok`。
- 以完整 container ID 对比发布前后，除 `agenthub` 外其他容器名称和 ID 未变化；`claude-code`、`hermes`、
  `openclaw-official` 保持 stopped，`openclaw-custom` 保持 running。

## 安全边界与回滚

- 只执行 `docker compose up -d --no-build agenthub`；没有执行 `docker compose down`。
- 没有删除镜像、卷、用户数据或其他 Compose project/Agent 容器；nas.9 保留作为回滚点。
- `.tmp-v05` 不存在，因此没有删除。
- 回滚：恢复备份目录中的 `.env`，使 `AGENTHUB_IMAGE=agenthub:0.6.0-nas.9`、
  `AGENTHUB_REVISION=06e4c2b`，然后执行：

  ```bash
  sudo -n docker compose -p agenthub -f /volume2/DockerProject/agenthub/docker-compose.yml up -d --no-build agenthub
  ```

  不执行 `compose down`，不清理镜像、卷或数据。

## 未验证项

当前没有可用浏览器/Computer Use/TX5Pro 通道，因此 1440、1024、768、390 的人工视觉与人工可用性
checklist 仍为 `PENDING_BROWSER_CHANNEL`。Playwright、curl、Terminal API smoke、静态构建和服务器
健康均不替代该人工 gate。

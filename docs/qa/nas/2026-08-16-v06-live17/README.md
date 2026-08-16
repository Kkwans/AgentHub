# AgentHub v0.6 nas.17 发布验收

日期：2026-08-16

## 范围

- 变更提交：`cdb7d5b`（Remote Node Project 目录选择、候选扫描与目标感知预检）。
- 目标主机：DH4300Plus，`aarch64`。
- Compose：`/volume2/DockerProject/agenthub/docker-compose.yml`，Docker project `agenthub`。
- 绑定地址：`192.168.5.110:3210`。
- 备份：`/volume2/Project/.agenthub/central/deployments/20260816T062241Z-pre-nas17/`。

## 构建与运行

- 镜像：`agenthub:0.6.0-nas.17`。
- Image ID：`sha256:2e984c0be37cb3efc31aeacbbbf8771045058c30957f4bd1039d0a261dc1c6c2`。
- Container ID：`40f977973aef15382bf593b5df3c76dfed426fe72ed652c4af00da39ebe3c07e`。
- 状态：`running / healthy`，容器用户 `0:0`，保留原 `privileged=true` 与 `restart=unless-stopped`。
- OCI revision：`cdb7d5b`，version：`0.6.0`。
- `node-pty` native binding：容器内 `typeof require('node-pty').spawn` 返回 `function`。

升级前只复制并保留了 Compose、`.env` 和 `browser-token`；凭据内容未输出，备份目录另记录对应 SHA-256。
更新使用 `docker compose config --quiet` 后执行 `docker compose up -d --no-build agenthub`，未执行
`docker compose down`，未删除镜像、卷、用户数据或其他服务。

## 验证结果

| 检查             | 结果                                                               |
| ---------------- | ------------------------------------------------------------------ |
| `/api/v1/health` | `status=ok`、`version=0.6.0`、`database=pglite`、`web=true`        |
| 根页面           | HTTP `200`，返回 `lang=zh-CN` SPA 与 `/favicon.svg`                |
| 授权 capability  | `terminal=READY`（linux/arm64）、`remoteNode=outbound_websocket`   |
| Compose SHA-256  | `0e3e92b7078a4a6cfde4fa8c5493539ffac0e238f1aa570ff689606a095f27ff` |
| `.env` SHA-256   | `4e3f1f608e54d3428ab6d9a64c02a0f9dfe66ac16ec6e249de4474fee63a3a8a` |
| `.tmp-v05`       | 不存在                                                             |

仓库侧 Remote Node 闭环测试已包含 `POST /projects/preflight`，并验证授权目录、相对路径转发、遍历拒绝和
候选 Project 扫描；NAS 本次没有伪造或提升离线 Remote Node 状态。

## 受保护容器

升级前后 Claude Code、Hermes、OpenClaw 的 name、完整 container ID、image 和原运行状态保持不变：

- `claude-code`：`9d8cbc9b82062c31d962c3829a49afe931087edef5691b96f96ba1ec5c339281`，`Exited (137)`。
- `hermes`：`cdcfb3fe1b1a542160b8e9d74725aa54a8da6a2f31f7cad2448ae9141b6799d0`，`Exited (137)`。
- `openclaw-official`：`433abd2cfd7687ca393ae5de4f3458959a29746a2a8130bcb39e1e3bb96a571e`，`Exited (143)`。
- `openclaw-custom`：`633495c2f6aa29bc704d558d3ed147667b447cb4451b78aee51679dc84981566`，`Up (healthy)`。

## 未验证项

当前执行环境没有 TX5Pro/授权浏览器通道；本记录不把 NAS `curl`、fixture 或 Playwright 结果等同于人工视觉
验收。1440、1024、768、390 的真实浏览器页面、键盘和视觉检查仍保持 `VISUAL_GATE_PENDING`。

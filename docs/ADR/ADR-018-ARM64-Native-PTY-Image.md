# ADR-018：ARM64 NAS 使用 native image 交付 node-pty

状态：已接受

日期：2026-08-15

## 背景

v0.6 的 Local Project Terminal 依赖 `node-pty`。正式 NAS 是 Linux ARM64；基础镜像中的
`node-pty@1.1.0` 只有 JavaScript/TypeScript 文件，没有可加载的 `build/Release/pty.node`，
而 NAS 主机和基础镜像均没有编译工具。继续把能力标记为 READY 会伪造功能，以普通子进程管道
代替 PTY 又会破坏终端语义和安全边界。

## 决策

保留通用镜像的 capability gate，并新增两个互补的 NAS ARM64 可回滚构建路径：

- `deploy/compose/Dockerfile.nas-native`：基础镜像没有 native binding 时使用临时 builder 编译；
- `deploy/compose/Dockerfile.nas-overlay`：基础镜像已经通过 native smoke 时，仅覆盖新的 server/web
  dist，避免每次前端发布依赖 NAS 外部 apt/npm 网络。

`Dockerfile.nas-native` 的构建步骤为：

1. 以已经验证的 `agenthub:0.6.0-nas.4` 为 base，使用临时 builder stage 安装
   `build-essential` 与 `python3`，从仓库锁定的 `node-pty@1.1.0` 源码构建 native binding。
2. builder 的 Debian 源固定替换为已验证的 USTC ARM64 mirror；代理只通过 build args 进入
   builder，最终 runtime stage 不继承代理环境或编译工具。
3. 最终镜像只复制 `node-pty` 的 `lib`、`typings` 与 `build/Release/pty.node`，并在构建时执行
   `require('node-pty')` 检查；server/web dist 与镜像 revision 同步写入最终层。
4. 运行时继续使用 allow-list shell、环境白名单、root containment、Project owner UID/GID drop、
   topic 生命周期事件和能力门禁。Docker/Remote Terminal 不因此进入 v0.6。

`Dockerfile.nas-overlay` 复用已验证 base 的 native binding，并在 overlay 完成后再次执行同一
`require('node-pty')` 检查；如果 base 缺少 binding，构建直接失败而不会产出假 READY 镜像。

## 验收与证据

- 发布镜像：`agenthub:0.6.0-nas.7`，Linux `arm64`，image ID
  `sha256:df5e1c3a5e120e2604f8677cd4bd43a371c24d68b9135ccd82bee37cb3b4ecb9`。
- 容器内 `require('node-pty').spawn` 返回函数；`GET /api/v1/settings/capabilities` 返回
  `terminal.available=true`、`code=READY`、`platform=linux`、`arch=arm64`。
- 使用正式 Project 的真实 API 完成 Terminal open → input (`printf live-pty-ok`) → close；
  证据见 `docs/qa/nas/2026-08-15-v06-live7/`。
- 当前发布 `agenthub:0.6.0-nas.8`（Linux `arm64`，image ID
  `sha256:0da6c9e92d12fc0f1ccf39aef7837e7020543e32c68343362f30a9fab8f47174`）复用 nas.7 native base，
  通过 `Dockerfile.nas-overlay` 覆盖共享表单修复后的 server/web dist；独立 spawn smoke 与真实
  Terminal open/input/close 通过，证据见 `docs/qa/nas/2026-08-15-v06-live8/`。native 重编译因
  NAS `127.0.0.1:7890` 代理不可用而未继续，未影响现有服务。

## 回滚与边界

nas.7 升级前备份位于 `/volume2/Project/.agenthub/central/deployments/20260815T144927Z-pre-nas7/`；
nas.8 升级前备份位于 `/volume2/Project/.agenthub/central/deployments/20260815T153002Z-pre-nas8/`。
仅更新 Compose project `agenthub` 的 `agenthub` service，使用 `up -d --no-build`；没有执行
`docker compose down`，没有删除镜像、卷、用户数据或其他 Agent 容器。回滚时恢复备份的
`.env`/Compose，重新指向旧 image 并再次 `up -d --no-build agenthub`。native image 和旧镜像
都保留，便于诊断和回退。

# AgentHub v0.6.0 发布说明

日期：2026-08-16
状态：`NAS_DEPLOYED / AUTOMATED_AND_LIVE_PASS / TERMINAL_UI_DELIVERED / VISUAL_GATE_PENDING`

## 发布内容

- 以普通用户旅程重构 Project、Runtime、Agent、Session、Task、PromptOS 和 Workspace。
- Project 使用 server-side PathPicker 与 candidate discovery；Agent 使用 Runtime/Agent discovery、adopt 和自动 preflight。
- 删除 `ControlPages.tsx`，建立 feature boundaries 与统一 Radix/Form/Dialog/Field/Picker/State 组件。
- 共享 `Field` 将说明/错误绑定到真实表单控件，文本字段默认提供稳定 `name` 与 `autocomplete="off"`，
  认证字段继续使用标准 username/password autocomplete。
- Discovery 的重新扫描、Runtime/Agent 接入、启动/停止和默认设置失败时统一显示中文、可访问的操作反馈；
  adapter 只通过 presentation label 展示，不把原始枚举直接交给普通用户。
- Workspace 工具卡通过 `labelAgentEventType` 展示中文事件标签，正常对话视图隐藏 `tool.call.*` 等原始
  协议枚举，未知事件统一显示“执行事件”。
- 共享 `FormDialog` 现在会把焦点送到首个错误控件，关闭后恢复到触发按钮；关闭图标使用真实
  `button`，避免键盘和读屏用户遇到不可操作的 SVG 控件。
- PromptOS 支持中文 Kind/Type、结构化 Variables、immutable Version、Label、Binding 和 Context Preview。
- Docker discovery 保留 container ID pinning；路径、mount、symlink、Terminal env 和权限边界继续由后端强制执行。
- Workspace 已提供 Local Project Terminal dock：能力可用时通过官方 `xterm.js` 连接既有安全 Terminal API
  与 `terminal:<id>` topic；能力缺失时显示中文原因并禁用操作，不使用普通 Shell 模拟 PTY。正式 ARM64
  NAS 镜像已内置 `node-pty` native binding 并通过真实 open/input/close 烟测；Docker/Remote Terminal
  不在 v0.6 范围。
- 健康接口和 workspace package metadata 统一返回 `0.6.0`。

## 证据

| 层级                     | 结果                                                                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vitest                   | 53 个文件通过，4 个 live 文件跳过；203 passed、9 skipped（本地以单 worker 串行取得稳定结果）                                                                                                |
| typecheck / lint / build | 通过；Web 1715 modules transformed                                                                                                                                                          |
| Playwright E2E           | 24/24 通过，覆盖 1440/1024/768/390、URL 恢复、键盘与 axe                                                                                                                                    |
| real live gate           | 4 个文件、9 个测试通过，包含真实 Codex discovery/adopt/preflight/session/run/message/close、文件变更/Diff/commit、Remote Node、Worktree Review/Merge 与 Docker Agent smoke                  |
| GitHub Actions           | run `31924583891`，commit `2fbc3dc`，`verify` 成功；Node.js 20 action deprecation 仅为 annotation                                                                                           |
| NAS Compose              | `agenthub:0.6.0-nas.13`，ARM64，revision `2fbc3dc1`，`running/healthy`，`192.168.5.110:3210`；Terminal capability `READY`，真实 open/WS input/output/close smoke 通过                       |
| 数据备份                 | `/volume2/Project/.agenthub/central/deployments/20260814T054956Z-v06-data-backup/central-data-worktrees.tar.gz`，SHA-256 `672fef18fdf6b3920780d5e3d32cd82495f84d656cd8e92d35647c283f2b9755` |

完整 NAS 记录见 [`docs/qa/nas/2026-08-16-v06-live13/README.md`](qa/nas/2026-08-16-v06-live13/README.md)。

## 升级与回滚

- 正式 Compose：`/volume2/DockerProject/agenthub/docker-compose.yml`。
- 发布前 Compose/.env/token 备份：`/volume2/Project/.agenthub/central/deployments/20260814T045513Z-pre-v06/`。
- 数据/worktrees 备份：`/volume2/Project/.agenthub/central/deployments/20260814T054956Z-v06-data-backup/`。
- UI 修复升级前 Compose/.env/token 备份：`/volume2/Project/.agenthub/central/deployments/20260814T064756Z-pre-nas2/`。
- ACP/live nas.3 升级前 Compose/.env/token 备份：`/volume2/Project/.agenthub/central/deployments/20260815T122000Z-pre-nas3/`。
- discovery/live nas.4 升级前 Compose/.env/token 备份：`/volume2/Project/.agenthub/central/deployments/20260815T130846Z-pre-nas4/`。
- Terminal UI nas.5 升级前 Compose/.env/token 备份：`/volume2/Project/.agenthub/central/deployments/20260815T141727Z-pre-nas5/`；Compose
  SHA-256 `2404f8b90d5b305dd53a7c0799c4b68dc9f135f682debe10fa3c54b1095376f3`，`.env` SHA-256
  `cc3cabd97520b598888066af8d2921bc56fcaf042eb64c81b23128ef21154181`，browser-token 仅保留 hash
  `d1e3d6d77a351bd669f975c32b414d8c9cd581e2e8fe87a11a4e0a64290db087`。
- nas.5 image digest：`sha256:0c30d4eb70b396febf273c86b9a7d8373a054cb4bb9aea9baff88cd15fd7ec09`；容器 ID
  `c519db777442eb0276cec5f5971b681f939558408688edaeeaf5e82b293264eb`，`user=0:0`、`privileged=true`、
  `restart=unless-stopped`，owner UID/GID 环境为 `1000:10`。基于已验证 nas.4 仅 overlay server/web dist，
  registry frontend 未访问；旧 nas.4 镜像保留作为回滚点。
- ARM64 native PTY nas.7 升级前 Compose/.env/token 备份：`/volume2/Project/.agenthub/central/deployments/20260815T144927Z-pre-nas7/`；`.env`
  SHA-256 `603ab5803ee99f7d675f6f4b8da58748db2e8f71702c6d03a82efa553f566e70`，browser-token 仅保留 hash
  `d1e3d6d77a351bd669f975c32b414d8c9cd581e2e8fe87a11a4e0a64290db087`。镜像 `agenthub:0.6.0-nas.7` image ID
  `sha256:df5e1c3a5e120e2604f8677cd4bd43a371c24d68b9135ccd82bee37cb3b4ecb9`；容器 ID
  `cc11ab51e1e31a7bdd4b30f31dcff89efa2d39ff8dd50550d2a563a7f7c2b528`，`user=0:0`、`privileged=true`、
  `restart=unless-stopped`，owner UID/GID `1000:10`。基于 nas.4 通过 `deploy/compose/Dockerfile.nas-native`
  构建 `node-pty@1.1.0` native binding；旧镜像、nas.6 与测试镜像均保留。
- 共享表单修复 nas.8 升级前 Compose/.env/token 备份：`/volume2/Project/.agenthub/central/deployments/20260815T153002Z-pre-nas8/`；
  Compose SHA-256 `0e3e92b7078a4a6cfde4fa8c5493539ffac0e238f1aa570ff689606a095f27ff`，旧 `.env` SHA-256
  `f092ed656024860ebf8ad24e26e002cf37fd63e74e7a2d7b15db3eef4519f803`，browser-token 仅保留 hash
  `d1e3d6d77a351bd669f975c32b414d8c9cd581e2e8fe87a11a4e0a64290db087`。镜像 `agenthub:0.6.0-nas.8` image ID
  `sha256:0da6c9e92d12fc0f1ccf39aef7837e7020543e32c68343362f30a9fab8f47174`；容器 ID
  `9a8171965f9ac462ef71853ccd5820f578faeb21b7670eda841dd5fce799b169`，`user=0:0`、`privileged=true`、
  `restart=unless-stopped`，owner UID/GID `1000:10`。native binding 复用 nas.7，使用
  `deploy/compose/Dockerfile.nas-overlay` 仅覆盖 server/web dist；旧镜像与 nas.7 保留。
- Discovery 操作反馈 nas.9 升级前 Compose/.env/token 备份：`/volume2/Project/.agenthub/central/deployments/20260815T160630Z-pre-nas9/`；
  Compose SHA-256 `0e3e92b7078a4a6cfde4fa8c5493539ffac0e238f1aa570ff689606a095f27ff`，旧 `.env` SHA-256
  `d39bfd82c4235f28c748075630df5fc0fea29819e4ee87c6564319f5f2d5ce49`，browser-token 仅保留 hash
  `d1e3d6d77a351bd669f975c32b414d8c9cd581e2e8fe87a11a4e0a64290db087`。镜像 `agenthub:0.6.0-nas.9` image ID
  `sha256:4e95f0d4aa88faea791f0c4a146a9fbe0b6fab03750acad5bec062150c42f77b`；容器 ID
  `db19526cecd4c70ea0c3db4cad80d599b5d35cf5a434dd56ce3122a90cc58b25`，`user=0:0`、`privileged=true`、
  `restart=unless-stopped`，owner UID/GID `1000:10`。基于 nas.8 通过 `deploy/compose/Dockerfile.nas-overlay`
  仅覆盖 server/web dist，构建时与运行时 node-pty smoke 均通过；nas.8 保留作为回滚点。
- Workspace 事件中文展示 nas.10 升级前 Compose/.env/token 备份：`/volume2/Project/.agenthub/central/deployments/20260815T163614Z-pre-nas10/`；
  Compose SHA-256 `0e3e92b7078a4a6cfde4fa8c5493539ffac0e238f1aa570ff689606a095f27ff`，旧 `.env` SHA-256
  `2c2f6d19abcc470fe55e05d68c24fc62b8576302b856d51080f8c113292300f8`，browser-token 仅保留 hash
  `d1e3d6d77a351bd669f975c32b414d8c9cd581e2e8fe87a11a4e0a64290db087`。镜像 `agenthub:0.6.0-nas.10` image ID
  `sha256:9ad53fbd6e9e80c2be9eec14286970d68eded41ab119eb5fb73c78e998932e2a`；容器 ID
  `e732efb2aa54af8b30d8899613c20ef43f0bbcf8dee42dd6984e7c2b779febcd`，`user=0:0`、`privileged=true`、
  `restart=unless-stopped`，owner UID/GID `1000:10`。基于 nas.9 通过 `deploy/compose/Dockerfile.nas-overlay`
  仅覆盖 server/web dist，构建时与运行时 node-pty smoke 均通过；nas.9 保留作为回滚点。
- Dialog 焦点修复 nas.11 升级前 Compose/.env/token 备份：`/volume2/Project/.agenthub/central/deployments/20260815T171733Z-pre-nas11/`；
  Compose SHA-256 `0e3e92b7078a4a6cfde4fa8c5493539ffac0e238f1aa570ff689606a095f27ff`，旧 `.env` SHA-256
  `2dac8995a2581a09e4ecaa01c9f2256c606c99138480c06f55c17cac8440f3ba`，browser-token 仅保留 hash
  `d1e3d6d77a351bd669f975c32b414d8c9cd581e2e8fe87a11a4e0a64290db087`。镜像 `agenthub:0.6.0-nas.11` image ID
  `sha256:013e01d5d93b1f32131795bedde4a7b46f02ba46b819747b379ab74969d664a1`；容器 ID
  `0db954ef887a897203eb5a6d86a16bc16f8bd36e54c340461633fa102ac0cc7e`，`user=0:0`、`privileged=true`、
  `restart=unless-stopped`，owner UID/GID `1000:10`。基于 nas.10 通过 `deploy/compose/Dockerfile.nas-overlay`
  仅覆盖 server/web dist；构建与运行时 node-pty smoke、真实 Terminal API/WS smoke 均通过；nas.10 保留作为回滚点。
- Discovery 边界修复 nas.12 升级前 Compose/.env/token 备份：`/volume2/Project/.agenthub/central/deployments/20260816T030407Z-pre-nas12/`；
  Compose SHA-256 `0e3e92b7078a4a6cfde4fa8c5493539ffac0e238f1aa570ff689606a095f27ff`，旧 `.env` SHA-256
  `3bb6d6f8d6bf7f8a0b44d096a7dc4b7e0da7b3e9b528f7da98d05c39ade00397`，新 `.env` SHA-256
  `f56fad7d044ae1f5efaed0314616bf8728dcd8f02fd66eefc4af50f9d8fdf648`，browser-token 仅保留 hash
  `d1e3d6d77a351bd669f975c32b414d8c9cd581e2e8fe87a11a4e0a64290db087`。镜像 `agenthub:0.6.0-nas.12` image ID
  `sha256:2c51ef8148565bd6390c5f8938d4deeecd5c77234294d68976ab65f8db3db3d3`；容器 ID
  `7181e640ac0aff13a5863c8f5698d481710e67ead1f06aa8d3403f47fe11cb6f`，`user=0:0`、`privileged=true`、
  `restart=unless-stopped`。基于 nas.11 通过 `deploy/compose/Dockerfile.nas-overlay` 仅覆盖 server/web dist，
  node-pty build/runtime smoke 均通过；nas.11 保留作为回滚点。发布快照观察到其他项目容器存在外部漂移，
  但 Claude Code、Hermes、OpenClaw 容器的 name/ID/image 在本次发布前后保持一致。
- Remote inventory nas.13 升级前 Compose/.env/token 备份：`/volume2/Project/.agenthub/central/deployments/20260816T034029Z-pre-nas13/`；
  Compose SHA-256 `0e3e92b7078a4a6cfde4fa8c5493539ffac0e238f1aa570ff689606a095f27ff`，旧 `.env` SHA-256
  `f56fad7d044ae1f5efaed0314616bf8728dcd8f02fd66eefc4af50f9d8fdf648`，browser-token 仅保留 hash
  `d1e3d6d77a351bd669f975c32b414d8c9cd581e2e8fe87a11a4e0a64290db087`。镜像 `agenthub:0.6.0-nas.13` image ID
  `sha256:44c4049fc919957c6e3a45356ba433d7650468d1ed9a032e13835bbcd4b4442f`；容器 ID
  `cda2a499d7770e3db8aaa0f11e476a0b71b1ddb863d1c2cd1053ef75de339ee0`，`user=0:0`、`privileged=true`、
  `restart=unless-stopped`，owner UID/GID `1000:10`。基于已验证 nas.12 通过
  `deploy/compose/Dockerfile.nas-overlay` 仅覆盖 server/web dist，构建与运行时 node-pty smoke、真实
  Terminal API/WS smoke 均通过；nas.12 保留作为回滚点。
- nas.4 image digest：`sha256:d5a7745b70667521ac86243984013c6a3b37b8adb88efd33bd0a0680eb9b2cca`；容器 ID
  `3d9ba293780758b66497987855240ab494bed68e8efe92f7645ef9c4b19ac7ec`，运行时 server/ACP dist
  与主机构建产物 SHA-256 一致。由于 NAS registry mirror 对 Dockerfile frontend 仍返回 429，本次
  以 nas.3 为基底只 overlay server dist；临时构建文件与 staging context 已清理，nas.3 镜像保留。
- nas.3 image digest：`sha256:36c54094d81b9c43ed2302593ad25464105f11fb7cc7e437ef1a87ca3cd2ce9c`；旧 `nas.2`
  镜像仍保留。由于 NAS registry mirror 对 Dockerfile frontend 返回 429，本次使用旧已验证镜像作为
  基底，仅叠加当前 commit 生成并逐字节核验的 `apps/server/dist` 与 `packages/adapter-acp/dist`；
  临时 overlay 构建文件已删除，运行时 hash 与主机产物一致。
- v0.5 → v0.6 没有新增数据库 migration；健康、Project、Agent、Session、PromptOS 数据在重启后保持可用。
- 升级只重建 `agenthub` service，没有执行 `docker compose down`，没有删除镜像、卷、用户数据或其他 Agent 容器。
- 回滚保留旧 `agenthub:0.5.0-nas.1` image；先停止单个 `agenthub` service，再恢复备份 `.env`/Compose，使用 `up -d --no-build agenthub`，必要时才恢复 data/worktrees 归档。

## 未验证项与明确边界

- 当前环境没有可用浏览器/Computer Use 通道，因此 1440、1024、768、390 四视口人工视觉验收和人工可用性 checklist 尚未完成；不能声明 TX5Pro v0.6 视觉通过。
- NAS 当前 `linux/arm64` 的正式 nas.13 镜像已具备可加载的 `node-pty` native binding，
  `GET /api/v1/settings/capabilities` 返回 `terminal.available=true`、`code=READY`；如果其他平台或镜像
  缺少 native binding，Workspace 仍会显示中文原因并禁用 Terminal 操作，不伪称 PTY 已可用。
- Claude Code、Hermes、OpenClaw 的正式容器接入状态以 Agent discovery/preflight 的实时结果为准；本次 live gate 的真实 Codex 与隔离 Worktree 证据不代表所有供应商均 READY。

本次 UI/可访问性修复的历史 NAS 记录见 [`docs/qa/nas/2026-08-14-v06-ui2/`](qa/nas/2026-08-14-v06-ui2/)；
ACP/live nas.3 的历史记录见 [`docs/qa/nas/2026-08-15-v06-live3/`](qa/nas/2026-08-15-v06-live3/)；
当前 discovery/live nas.4 记录见 [`docs/qa/nas/2026-08-15-v06-live4/`](qa/nas/2026-08-15-v06-live4/)；Terminal UI nas.5
记录见 [`docs/qa/nas/2026-08-15-v06-live5/`](qa/nas/2026-08-15-v06-live5/)；ARM64 native PTY nas.7 记录见
[`docs/qa/nas/2026-08-15-v06-live7/`](qa/nas/2026-08-15-v06-live7/)；当前 nas.8 记录见
[`docs/qa/nas/2026-08-15-v06-live8/`](qa/nas/2026-08-15-v06-live8/)；nas.9 记录见
[`docs/qa/nas/2026-08-15-v06-live9/`](qa/nas/2026-08-15-v06-live9/)；当前 nas.10 记录见
[`docs/qa/nas/2026-08-16-v06-live10/`](qa/nas/2026-08-16-v06-live10/)；当前 nas.11 记录见
[`docs/qa/nas/2026-08-16-v06-live11/`](qa/nas/2026-08-16-v06-live11/)。

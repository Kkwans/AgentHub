# ADR-014：绿联 NAS privileged Compose 部署

状态：接受。日期：2026-08-10。

## 背景

v0.3.0 最初以 `Kkwans` 用户的 systemd 服务部署在 `127.0.0.1:3210`。该方式健康，
但不会出现在绿联 Docker 项目列表，且不能直接通过 NAS 局域网地址访问。用户明确要求
改为 Docker Compose，并授权容器使用 root 和 privileged。

## 决策

- 当前 NAS Central Server 使用项目名 `agenthub` 的 Docker Compose 常驻部署；配置安装到
  `/volume2/DockerProject/agenthub/docker-compose.yml`，由 Compose project label 进入绿联
  Docker 项目列表。
- 容器固定为 ARM64 Node.js 24、`user: 0:0`、`privileged: true`，并挂载 host Docker socket
  与匹配 Engine 版本的 `/usr/bin/docker`。这是等同 NAS root 的高权限边界，不把它描述为
  容器安全隔离。
- Project、PGlite、worktree、专用 TMPDIR 和 Codex HOME 使用显式 bind mount，并在容器内
  保持原绝对路径；不复制 Agent 原生凭据。
- root Git 进程通过 `SUDO_UID=1000` 识别 `Kkwans` 拥有的 Project，并只读引用原
  `.gitconfig` 保留 commit identity；不使用 `safe.directory=*`，不增加 push API。
- Server 在容器内监听 `0.0.0.0:3210`，host 只发布 `192.168.5.110:3210`；强制认证。
  首次迁移使用的 API token 明文只保存在 root-only 部署文件，后续网页登录方式由 ADR-015
  修订为本机管理员账号和 HttpOnly Cookie。
- 既有 systemd unit/env 保留但停用。切换前优雅停止服务并冷备份 PGlite；失败时停止
  AgentHub 容器并恢复 systemd，不执行 `compose down`，不删除镜像、容器、volume 或数据。
- Claude Code、Hermes、OpenClaw 的 Compose、容器、镜像和数据继续受 ADR-011 保护，
  本决策不授权修改它们。

## 构建取舍

NAS 当前容器内 DNS 无法稳定访问 npm 与 Alpine 仓库。首个 NAS 镜像因此使用固定 digest 的
官方 Node 24 Bookworm 基础镜像，复制已通过 lockfile、lint、typecheck、test 和 build 验证的
workspace 安装结果与 production dist。这样发布不依赖构建时外网，但镜像较大；后续可在
有可靠 registry mirror 后改为 production dependency closure，多阶段构建不得改变运行契约。

## 后果

- 优点：局域网地址可达、受登录保护、绿联可见、重启策略与健康检查统一由 Compose 管理。
- 风险：privileged、Docker socket、Project rw 和 Codex HOME rw 的组合可获得宿主机高权限；
  只应部署可信 AgentHub 代码并限制 NAS/LAN 访问。
- 当前 LAN 入口为 HTTP，登录密码、Cookie 或 API token 可能被不可信网络观察；跨不可信网络
  必须在前置代理终止 TLS。

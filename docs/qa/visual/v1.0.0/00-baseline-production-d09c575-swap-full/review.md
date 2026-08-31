# Phase 0 生产只读基线复核

状态：已完成生产核心路由只读截图；这是运行镜像的基线记录，不是 v1.0 RC。

- 矩阵：Light/Dark × 7 viewport × 11 条生产核心路由，共 154 张 PNG；另有单独未认证入口快照。
- 证据：`audit.json`、`geometry.json`、`SHA256SUMS`。
- 自动结果：0 console error、0 page error、0 failed request、0 被阻断写请求；几何基线检查通过。
- 生产认证只复用既有受保护 token 文件；没有创建 Project、Session、Prompt、Run 或 Git 变更。
- `geometry.json.releaseReady` 保持 `false`；该命令明确只表示基线测量，不代表完整 v1 几何门禁。
- 登录、loading/error/offline 和 Workspace 特殊状态尚未在生产目录形成完整矩阵；后续 RC 必须补齐并复核。

# ADR-011：显式接管既有 Docker Agent

状态：接受。日期：2026-08-09。

AgentHub 可接管用户显式注册的既有 Agent 容器，仅提供 inspect、start、stop 和固定 Agent 命令 exec。注册时固定 container ID，操作前重验；不修改 Compose、不重建或删除容器、不操作镜像和数据卷。

默认启动策略为 `MANUAL`，Profile 可选 `ON_DEMAND`。AgentHub 永不自动停止容器；停止有活动 Session 的目标前必须先取消并关闭相关 Run。工作目录按最长 host/container mapping 前缀换算并每次重验。

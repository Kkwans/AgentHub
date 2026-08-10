# ADR-009：Host-native MVP

状态：被 ADR-014 针对当前 NAS 部署取代。日期：2026-08-09；取代日期：2026-08-10。

AgentHub 自身在宿主机运行，以直接访问本地 Project、Git 和受控进程。Docker 仅作为显式注册的 Agent Execution Target，不把 AgentHub 封装为新容器。

该决策仍说明 v0.1 的初始实现约束，但用户已明确要求当前 NAS 改为绿联 Docker Compose、
root/privileged 常驻部署。领域边界和既有 Agent 容器的显式接管规则不变。

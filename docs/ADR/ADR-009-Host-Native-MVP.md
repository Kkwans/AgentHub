# ADR-009：Host-native MVP

状态：接受。日期：2026-08-09。

AgentHub 自身在宿主机运行，以直接访问本地 Project、Git 和受控进程。Docker 仅作为显式注册的 Agent Execution Target，不把 AgentHub 封装为新容器。

# ADR-006：Agent 原生认证归属

状态：接受。日期：2026-08-09。

Codex、Claude Code、Hermes、OpenClaw 等原生凭据归各自运行时所有。AgentHub 只记录 auth 状态和凭据引用，不复制 token、cookie 或登录文件。

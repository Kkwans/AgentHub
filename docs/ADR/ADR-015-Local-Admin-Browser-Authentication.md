# ADR-015：本机管理员网页登录

状态：接受。日期：2026-08-10。

## 背景

Compose 初次迁移复用了 API Bearer token 作为浏览器认证。该机制要求用户从 NAS root-only
secret 文件复制明文并理解 token、Session 和命令行，不符合普通用户产品的登录心智模型。
平台登录错误还与 Agent 供应商原生授权共用了 `AUTH_REQUIRED` 文案，导致用户误判故障来源。

MVP 已明确不实现 RBAC、SSO 或多租户，因此本次不引入伪多用户模型。

## 决策

- token auth 部署在数据库没有账号时开放首次设置页；用户在页面创建唯一的本机 `ADMIN`。
  `local_accounts.singleton_key` 的唯一约束和 check constraint 保证最多一个管理员，并在首次
  创建后关闭 setup 路径。
- 用户名做 NFKC 规范化和大小写无关匹配。密码长度为 12..128，使用 Node.js `scrypt`
  加随机 salt 派生；数据库不保存密码明文或可逆密文。
- 登录签发 256-bit 随机浏览器会话，数据库只保存 SHA-256 hash。Cookie 为 HttpOnly、
  SameSite=Strict、7 天有效；启用 TLS transport 时同时设置 Secure。
- HTTP API 和 `/ws` 从同源 Cookie 认证，前端 JavaScript 不读取或持久化会话 token。退出登录
  会撤销当前会话；修改密码会撤销该账号全部旧会话并签发一个新会话。
- 连续 5 次错误登录对同一客户端冷却 15 分钟。日志脱敏 Cookie、Authorization、password、
  currentPassword 和 newPassword。
- Bearer API token 与 WebSocket subprotocol credential 保持向后兼容，仅供 CLI、自动化、
  外部服务和已验证回滚路径。Web 设置页将其收纳到默认折叠的“高级功能 → 外部集成”；不再
  提供“用于当前浏览器”或粘贴部署 secret 的操作。
- `AGENTHUB_AUTH_MODE=token` 暂时保留为部署兼容名称，含义扩展为“非 loopback 强制认证”，
  不把这个内部名称展示为普通用户登录方式。

## 后果

- 普通用户只需要在首次使用时创建账号，之后输入用户名和密码，不接触 NAS 命令或 secret。
- 现有 API/CLI 集成和 systemd/Compose 回滚不被破坏；root-only bootstrap secret 暂不删除。
- 当前仍是单管理员本机产品。找回密码、邀请用户、RBAC、SSO、MFA 和跨设备 Session 管理不在
  v0.3 范围内；未来引入时需要新的身份与恢复语义，不能在本表上假装多用户扩展。
- HTTP LAN 能防止未授权操作，但不能防旁路窃听；跨不可信网络仍必须使用 TLS。

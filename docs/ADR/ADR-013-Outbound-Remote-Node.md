# ADR-013：Remote Node 使用出站 WebSocket 与设备签名

## 状态

已接受，2026-08-10。

## 背景

中央 AgentHub 需要管理 PC/Mac/Linux 主机上的本地 Agent CLI、repository 与凭据，同时不能
要求目标主机开放 SSH/入站端口，也不能把 provider credential 复制到 NAS。

## 决策

- 每个 AgentHub Node daemon 对应一个 `REMOTE_NODE` Execution Target，并主动连接中央
  `/node/ws`。
- 首次注册使用由已认证用户创建的单次 registration token；中央只保存 SHA-256 hash，明文
  仅返回一次，默认 15 分钟过期。
- Node 首次启动生成 Ed25519 key pair；private key 以 `0600` 留在 Node 数据目录，中央只保存
  SPKI public key 与 SHA-256 fingerprint。
- 每次连接由中央发送随机 challenge；Node 签名固定 domain-separated payload。注册成功后的
  连接不再传 registration token。
- 生产连接必须是 `wss://`；仅允许 Node 在 loopback 地址使用明文 `ws://` 进行开发与测试。
- registration token 固化目标名称与允许的 repository roots。Node 也在本地执行相同 root
  containment，中央登记值不能扩大 Node 本地授权。
- 设备只上报 OS/arch/version、root、Agent inventory/capability 与健康状态；provider secret、
  原生 auth 文件和环境变量值不得上报。
- 中央只发送 versioned allow-list RPC，不提供通用 shell、任意 executable 或任意文件路径接口。
- 同一 Node 只允许一条已认证连接。断开时 Target 标记 `OFFLINE`，活动远程 Run 进入
  `DISCONNECTED`，不自动重放可能产生副作用的命令。

## 影响

- 中央无需访问远程主机的 HOME、SSH key、provider token 或 Docker socket。
- Node 必须持久化设备身份；丢失 private key 时由用户显式 revoke 后重新注册。
- 网络断开后的 Session 恢复需要显式能力协商；v0.2 不承诺透明续跑。
- TLS 由中央 AgentHub 前置反向代理或应用部署层终止，Node 会校验证书。

## 回滚

- 停止 Node daemon 即可停止远程能力，不影响本地 Agent CLI、repository 或凭据。
- 中央 revoke 只禁用设备身份，不删除 Target、Project、Session、Run 或审计历史。
- 数据库 migration 向前保留；代码回退时恢复升级前备份，不手工删除设备表。

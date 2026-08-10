# AgentHub Compose LAN TX5Pro 实机验收

> 历史证据：本轮验证的是 Compose 初次迁移时的 API token 入口。该浏览器方案已被用户否决，
> 并由 ADR-015 的管理员账号与 HttpOnly Cookie 登录取代；截图不代表现行产品设计。

- 日期：2026-08-10
- 结果：PASS
- TX5Pro：Windows 10 build 26200、Node.js 24.0.0、Google Chrome 150.0.7871.182
- 地址：`http://192.168.5.110:3210`
- 访问方式：真实 LAN 直连正式 Compose 服务，不使用 SSH tunnel
- 认证：root-only secret 通过标准输入临时传给验收进程；报告、截图、命令行和远端文件均
  不保存明文 token

## 最终检查

- NAS LAN health 返回 `v0.3.0/PGlite/Web` 可用；
- 1440、1024、768、390 四种视口的 token WebSocket 均显示已连接；
- 四种视口均无根页面横向溢出；
- 1440 命令面板可聚焦、筛选并关闭；
- 正式 `AgentHub` Project 与 `/volume2/Project/AgentHub` 路径可见；
- 设置页展示 token auth、正在使用的 `NAS LAN 浏览器` token 和 Docker 高权限边界；
- 390 移动导航可打开和关闭；
- 0 request failure、console error、page error、HTTP 4xx/5xx 和外部请求。

共 16 项检查，全部通过。机器可读结果见 [report.json](report.json)。

## 验收中发现并修复

首次 LAN 浏览器运行发现页面 HTML 能返回，但 Helmet 默认 CSP 包含
`upgrade-insecure-requests`，Chrome 将 HTTP JS/CSS 请求升级为 HTTPS，最终出现
`ERR_SSL_PROTOCOL_ERROR`。部署支持新增显式 `AGENTHUB_SECURE_TRANSPORT=false`：HTTP LAN
入口移除该 CSP directive 和只适用于可信安全上下文的 COOP header，同时保留其余 CSP、
`nosniff`、token auth 与路径边界。Server 回归测试覆盖 HTTP/HTTPS 两种配置。

修复镜像重新部署后，同一 TX5Pro、同一 LAN URL 的完整脚本通过。当时的脚本版本只从
stdin 读取 token，不创建或修改正式业务记录；现行
`scripts/qa/tx5pro-compose-acceptance.cjs` 已改为首次设置页或用户名/密码登录验收。

## 证据

本目录保存四种视口的概览截图、桌面命令面板/设置和移动导航/设置截图。所有截图均来自最后
一次 PASS 的正式 Compose build。

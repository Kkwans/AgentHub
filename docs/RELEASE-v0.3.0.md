# AgentHub v0.3.0 发布说明

v0.3.0 聚焦 UI/UX 和 NAS 可用部署。后续 NAS 登录体验更新增加向前兼容的认证接口与
`0003_sweet_owl.sql`，不改写既有领域数据。

## 主要变化

- `packages/ui` 落地官方 `@radix-ui/themes@3.3.0` 与 `@phosphor-icons/react@2.1.10`，Web 不再依赖 Lucide；
- 中文 App Shell、Dashboard、Task、Agent/Remote Node、Workspace、PromptOS 与设置统一为石墨中性色高密度工具界面；
- 新增真实 `Ctrl/Cmd+K` 命令面板、Radix Dialog/AlertDialog/Tabs/Badge/Button/Callout/Skeleton，并补齐键盘、焦点和移动 drawer；
- 删除无行为的 Session 筛选；未支持的 Terminal 新建操作明确 disabled 并说明 native PTY 限制；
- Dashboard、Agent 和设置页从卡片墙重构为连续控制面，Task/Run 使用“运行脊柱”表达真实状态；
- TX5Pro Chrome 完成 1440/1024/768/390、真实 Codex Run 与 Task 人工确认，20 项检查全部通过；
- NAS 首次发布使用 host-native systemd；随后按部署决策迁移为 root/privileged Docker
  Compose，只发布 `192.168.5.110:3210` 并强制认证；网页使用管理员账号登录，API token 仅供外部集成；
- 正式 PGlite 中已注册 `AgentHub NAS 宿主机` target 和 AgentHub 自身 Project。

## 验证

- `pnpm format:check`、`pnpm lint`、`pnpm typecheck`、production build：通过；
- Web 单元测试：10 项通过；版本/健康/App 聚焦回归：19 项通过；
- 全仓非沙箱 Vitest：33 个文件通过、3 个 live 文件按 gate 跳过，119 项通过、7 项跳过；
- TX5Pro：原 v0.3 UI 20 项通过；现行首次管理员设置页在 1440/390 通过，0 request
  failure、console/page error、HTTP 4xx/5xx 和外部请求；
- Compose：Project `agenthub` 可由 `docker compose ls` 枚举；容器为 healthy，受控重启后
  首次设置状态、自身 Project 与 Execution Target 均持久恢复；原 systemd 已
  `disabled/inactive` 并保留为回滚路径。
- GitHub Actions：main run [`31374423006`](https://github.com/Kkwans/AgentHub/actions/runs/31374423006) 完整通过 install、lint、typecheck、test、build 与 Playwright E2E。
- NAS 全局 `/tmp` 已满；正式服务通过 `TMPDIR=/volume2/Project/.agenthub/central/tmp` 隔离，运行中进程已验证继承该值，不删除其他项目缓存。

## 已知限制

- Web production bundle 仍是单入口：JS 约 623 kB、CSS 约 769 kB，Vite 报告大于 500 kB 的 chunk warning；不影响本次真实浏览器验收，后续应做路由级拆包和旧 CSS 清理；
- 当前 NAS 无 `node-pty` ARM64 native binding，Terminal capability 仍为 false；
- Claude Code 容器缺固定 `claude-agent-acp`，Hermes 缺 Project workspace 映射，OpenClaw Gateway 仍需批准 scope upgrade，OpenCode 未安装。

## 部署与回滚

首次 systemd 部署见 [NAS v0.3 部署验收](qa/nas/2026-08-10-v03-deployment/README.md)，
现行 Compose 部署、冷备份和回滚见
[NAS Compose 迁移验收](qa/nas/2026-08-10-compose-migration/README.md)。UI 重构实机证据见
[TX5Pro v0.3 UI 验收](qa/tx5pro/2026-08-10-v03-ui/README.md)，LAN token 入口历史证据见
[TX5Pro Compose LAN 验收](qa/tx5pro/2026-08-10-compose-lan/README.md)，现行网页登录证据见
[管理员登录 TX5Pro 验收](qa/tx5pro/2026-08-10-account-auth/README.md)。

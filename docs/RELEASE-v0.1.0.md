# AgentHub v0.1.0

## 范围

v0.1.0 交付 host-native AI Coding Agent 控制平面，覆盖 Project、五类 Agent preflight、Session/Run/Approval、只读文件、Git、Terminal capability、PromptOS、Goal/Task、Dashboard、安全认证和 Docker 显式接管。

## 已验证

- Node.js 24 / pnpm 11 / Linux ARM64 构建、类型、lint 与测试。
- 确定性核心闭环：Project → PromptOS → Task → Agent → Approval → Git → 人工审阅。
- Playwright Chromium：1440、1024、768、390 四种视口共 12 项。
- Codex：真实 ACP preflight、Session、流式响应和 cancel notification。
- Claude Code：CLI 可用；容器缺固定 ACP adapter，明确为 `BROKEN`。
- Hermes：ACP 可用；Project mount 不足，明确为 `WORKSPACE_UNMAPPED`。
- OpenClaw：Gateway-backed ACP 命令可用；Gateway scope 尚需原生批准，明确为 `AUTH_REQUIRED`。
- OpenCode：宿主机未安装，明确 `SKIP: MISSING`；fixture 覆盖通过。
- live smoke 后三个原本 stopped 的 Agent 容器均恢复 `exited`，完整 ID 未变化。

## 已知限制

- 不包含 swarm、Workflow Designer、Remote Node、自动 worktree、Marketplace、Memory/RAG、Prompt Eval、RBAC/SSO 或完整 Git 客户端。
- 当前 NAS ARM64 没有可用 `node-pty` native binding，Terminal capability=false。
- 浏览器验证在 NAS 本地 Playwright Chromium 完成，尚未在 TX5Pro 实机执行。
- OpenClaw `agent exec` 回退未在当前版本确认，不能声明可用。

## 发布门禁

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
AGENTHUB_E2E_LIVE=1 pnpm test:live
```

部署、升级和回滚见 [DEPLOYMENT.md](DEPLOYMENT.md)，故障状态见 [TROUBLESHOOTING.md](TROUBLESHOOTING.md)。

# AgentHub v0.1 — Codex 实施主提示词

> 使用方式：把本文件与 `AgentHub_PromptOS_MVP_技术方案.md` 一起提供给 Codex。**用户先手动切换到 Plan Mode，再发送本提示词。**  
> 目标：先让 Codex 在 Plan Mode 完成仓库审计与实施计划；计划收敛后由 Codex 自行设置 durable Goal，再按阶段实现、测试、提交，并持续推进到 v0.1 MVP Definition of Done。  
> 技术方案是产品/架构合同；本文件是执行合同。MVP 默认不使用 OpenSpec。

---

# 1. 你的角色

你是 AgentHub 项目的：

- Principal Engineer；
- Staff-level full-stack engineer；
- Agent runtime integration engineer；
- Open-source maintainer；
- QA owner。

你负责把 `AgentHub_PromptOS_MVP_技术方案.md` 实现为一个真实可运行的 v0.1 MVP。

你不是来：

- 快速生成一堆页面；
- 搭 skeleton 后声明完成；
- 用 mock 冒充 Agent 集成；
- 随意重写需求；
- 把未来功能塞进 MVP；
- 自己发明 UI。

---

# 2. 首要输入

开始任何修改前，完整阅读：

```text
AgentHub_PromptOS_MVP_技术方案.md
```

如果仓库已有：

```text
AGENTS.md
docs/
README.md
package.json
pnpm-workspace.yaml
```

也必须先读。

如果当前仓库不是空仓库：

**先理解现有代码，再决定如何渐进实现，禁止无理由推倒重写。**

---

# 3. 启动前提：用户先切换 Plan Mode

这是一个复杂、长周期、需要先审计再实现的项目。

**Plan Mode 是客户端/会话模式，由用户切换。你不能假装自己执行了 `/plan`。**

用户在发送本提示词前，应先通过：

```text
/plan
```

或客户端提供的等价快捷键（例如 `Shift + Tab`）进入 Plan Mode。

因此，当你收到本提示词时：

1. 先确认当前处于 Plan Mode；
2. 完整阅读技术方案和仓库；
3. 进行 Phase 0 审计、官方资料复核、架构校验；
4. 形成可执行的最终 Plan；
5. **Plan 收敛前不要开始业务实现。**

Plan Mode 阶段允许：

- 读取仓库、配置、文档；
- 执行只读/诊断命令；
- 查看 Git 状态和历史；
- 检查本地 Agent binary/version/help/preflight；
- 查阅当前官方文档与高质量参考实现；
- 识别风险、依赖、冲突和未知项；
- 设计模块、数据、接口、测试和提交切片。

Plan Mode 阶段不要：

- 开始实现 Feature；
- 大规模修改代码；
- 安装与方案无关的依赖；
- 执行 destructive Git；
- commit/push；
- 为了“流程完整”初始化 OpenSpec。

如果收到本提示词时并未处于 Plan Mode：

- 不要声称已经切换；
- 明确告诉用户需要先手动进入 Plan Mode；
- 不要在普通执行模式下跳过规划直接开工。

---

# 4. Plan 收敛后：由 Codex 设置 Goal，再进入实施

Plan 的职责是确定**如何实现**；Goal 的职责是持续追踪**何时算完成**。

因此本项目采用：

```text
User enters Plan Mode
        ↓
Repository / reference / architecture audit
        ↓
Final implementation Plan
        ↓
Codex sets durable Goal
        ↓
Implementation → verification → commit → next slice
        ↓
v0.1 Definition of Done
```

## 4.1 Plan 必须产出的内容

最终 Plan 至少要明确：

```text
Milestone → Slice → Files/Modules → Acceptance → Tests → Commit
```

并覆盖：

- MVP scope / non-goals；
- 技术栈与目录结构；
- Project / Agent / Session / Run / Approval / Workspace / Git / Terminal / PromptOS；
- 五类 Agent 的接入策略和 capability 差异；
- 数据库 schema 与 migration；
- REST / WebSocket 契约；
- UI 页面与关键交互；
- 安全边界；
- 测试策略；
- commit 切片；
- release gate；
- 风险和 fallback。

Plan 不能只是待办清单；必须足以让后续 Goal 在没有反复重新设计的情况下持续执行。

## 4.2 Goal 必须在 Plan 之后设置

不要在仓库和当前 Agent 能力尚未审计时先设置一个宽泛 Goal。

Plan 收敛后，基于：

- `AgentHub_PromptOS_MVP_技术方案.md`；
- 实际仓库状态；
- 当前官方 API / 协议；
- 最终实施 Plan；

由你生成并**直接设置**一个精炼、可验证的 durable Goal。

如果当前 Codex 客户端暴露 agent-side Goal 能力，就由你自己设置 Goal，**不要要求用户重复输入 `/goal` 或手工复制 Goal 文本。**

只有当前客户端确实不允许你直接设置 Goal 时，才明确说明这一能力限制，并把已经收敛好的 Goal 文本交给用户触发；不要假装已经设置成功。

Goal 的含义必须等价于：

> 实现 `AgentHub_PromptOS_MVP_技术方案.md` 与最终实施 Plan 定义的 AgentHub v0.1 MVP：完成本地项目、五类 Agent 的真实 preflight 与接入架构、ACP runtime、OpenClaw Gateway/exec、Session/Run/Approval、Codeg 参考的 Workspace、Git/Terminal、PromptOS immutable version/label/diff/binding、Goal/Task、安全与测试闭环；严格遵守 MVP non-goals；所有功能以真实后端状态和自动化测试验证；完成后达到方案中的 Definition of Done。

Goal 必须包含：

- Outcome；
- Verification surface；
- Constraints；
- Boundaries；
- Iteration policy；
- Blocked stop condition。

Goal 不要塞入整份技术方案。详细约束引用技术方案和实施 Plan。

## 4.3 Goal 启动后的第一批持久化文件

正式进入实施后，在开始 Feature 编码前建立/更新：

```text
docs/implementation/PLAN.md
docs/implementation/PROGRESS.md
docs/implementation/DECISIONS.md
AGENTS.md
```

要求：

- `PLAN.md`：保存最终实施计划和 Milestone/Slice；
- `PROGRESS.md`：持续记录 done / doing / next / blocker / tech debt；
- `DECISIONS.md`：记录会影响架构或兼容性的决策；
- `AGENTS.md`：保存稳定的仓库级工程规则。

如果客户端在 Plan Mode 内允许安全写入纯文档，也可以提前保存 Plan；否则在 Goal 启动后的第一步落盘。**不要为了落盘 Plan 而提前开始业务实现。**

---

# 5. Phase 0 审计

## 5.1 Git

检查：

```bash
git status
git branch --show-current
git log --oneline -20
git remote -v
```

记录：

- 当前 branch；
- dirty files；
- 未提交工作；
- 是否安全修改。

**不得覆盖用户已有未提交修改。**

## 5.2 Runtime

检查：

```bash
node --version
npm --version
pnpm --version
git --version
```

目标：

```text
Node 24 LTS
```

如果 pnpm 不存在，先根据项目环境决定如何通过官方/已有方式启用，不要偷偷污染全局环境。

## 5.3 Agent 环境

只读探测，不安装：

```text
codex
claude
opencode
hermes
openclaw
```

对存在 binary：

- absolute path；
- version；
- help/capability；
- auth/preflight；
- config home hints。

**command exists != agent ready。**

## 5.4 官方资料复核

Agent/协议变化快，实施前再次读当前官方资料。

### ACP

确认：

- stable v1；
- TS SDK；
- initialize/capabilities；
- session/new；
- load/resume/close；
- permission；
- terminal；
- MCP；
- protocol version。

### Codex

OpenAI 相关只以 OpenAI 官方资料确认：

- Codex App Server；
- current CLI；
- Goal/Plan；
- AGENTS.md；
- auth；
- transport；
- approval/safety。

然后核对 `agentclientprotocol/codex-acp` 当前版本。

### Claude

核对 Anthropic 官方 Agent SDK，以及 `agentclientprotocol/claude-agent-acp`。

### OpenCode

核对：

```text
opencode acp
opencode serve
@opencode-ai/sdk
```

### Hermes

核对：

```text
hermes acp
hermes acp --check
```

### OpenClaw

核对：

- Gateway protocol/client；
- `openclaw agent exec`；
- 当前版本是否明确支持作为 ACP server。

如果外部 API 与方案快照已变化：

1. 不硬按旧接口；
2. 记录 `DECISIONS.md`；
3. 保持架构意图；
4. 采用当前官方兼容方式；
5. 增加适配测试。

---

# 6. 规范管理策略：MVP 默认不用 OpenSpec

AgentHub v0.1 **默认不使用 OpenSpec**。

原因：

- `AgentHub_PromptOS_MVP_技术方案.md` 已经承担主 Spec / architecture contract；
- Plan Mode + durable Goal 已承担实施规划与持续执行职责；
- `AGENTS.md`、`PLAN.md`、`PROGRESS.md`、`DECISIONS.md` 足以形成 MVP 的轻量工程控制闭环；
- 再把同一内容复制成 proposal/design/spec/tasks 会增加上下文重复、维护成本和 Token 消耗；
- v0.1 当前最重要的是实现、验证真实 Agent 接入和打磨产品，而不是增加流程层。

因此：

```text
不要运行 openspec init
不要运行 openspec validate
不要为了本项目安装 OpenSpec
不要为每个 Feature 创建 proposal/spec/tasks
```

如果仓库已经存在历史 `openspec/`：

- 不删除；
- 不主动扩展；
- 只有当前变更确实依赖已有 Spec 时才读取；
- MVP 的 source of truth 仍以当前技术方案和实施 Plan 为准，除非用户另行指定。

只有满足以下任一条件，才可以**建议**未来引入 OpenSpec；未经用户明确同意不要自行启用：

- 已发布版本上的大型跨模块兼容性变更；
- 多 Agent 并行修改同一产品能力，需要正式 change contract；
- 多开发者/团队协同；
- 涉及复杂 migration、backward compatibility、API deprecation；
- 一个 change 跨越多个独立子系统且需要长期 review/审计；
- 用户明确要求使用 OpenSpec。

普通 Feature、Bugfix、UI 调整、重构不得为了流程完整而强制创建 OpenSpec。

MVP 的工程控制链固定为：

```text
技术方案（Source of Truth）
        ↓
Plan Mode
        ↓
PLAN.md
        ↓
Durable Goal
        ↓
AGENTS.md + DECISIONS.md + PROGRESS.md
        ↓
Implementation / Test / Review / Commit
```

---

# 7. AGENTS.md

建立/更新一个短而强的 `AGENTS.md`。

至少写：

## Product

- AgentHub 是 AI Software Engineering Control Plane；
- PromptOS 是内部模块；
- v0.1 contract 指向技术方案。

## Architecture

- TypeScript-first；
- modular monolith；
- ACP primary；
- OpenClaw special adapter；
- PGlite/PostgreSQL；
- no Redis/vector/microservices。

## Safety

- native agent permission first；
- no global auto approve；
- no plaintext vendor credential；
- safe spawn；
- realpath guard。

## Quality

每个 slice 按影响范围执行：

```bash
pnpm lint
pnpm typecheck
pnpm test
```

## Git

- feature slice 完成后 commit；
- Conventional Commits；
- subject 中文；
- body 说明改动/验证；
- 默认不 push，除非用户明确要求；
- 不提交 secret/state/db/log。

不要把整份技术方案复制进 `AGENTS.md`。

---

# 8. 技术栈是约束

MVP：

```text
Node.js 24 LTS
TypeScript
pnpm workspace

Express 5
React 19 + Vite
Tailwind + shadcn/ui/Radix
TanStack Query

Drizzle ORM
PGlite default
PostgreSQL via DATABASE_URL

WebSocket
@agentclientprotocol/sdk
```

除非当前生态发生不可兼容变化并已记录 ADR，不要换成：

```text
Next.js / NestJS / Spring Boot / FastAPI
Redis / MongoDB / Prisma / Kafka / microservices
```

package：

- 选择当前 compatible version；
- lockfile 固定；
- 外部协议适配 package pin；
- breaking change 记录 decision。

---

# 9. 目标代码结构

```text
apps/
  server/
  web/
  cli/

packages/
  shared/
  db/
  agent-core/
  adapter-acp/
  adapter-openclaw/
  ui/
```

后端：

```text
apps/server/src/modules/
  projects/
  agents/
  sessions/
  runs/
  approvals/
  promptos/
  skills/
  tasks/
  git/
  terminal/
  auth/
  settings/
```

不要每个 domain 都独立 package。

---

# 10. 实现顺序

按依赖推进，禁止先画全部 UI。

## Milestone 1 — Foundation

- monorepo；
- lint/typecheck/test/build；
- config；
- logging；
- common error；
- request ID。

验证并 commit。

## Milestone 2 — DB

实现技术方案 MVP tables：

- Drizzle schema/migration；
- PGlite；
- `DATABASE_URL` external PG；
- migration test；
- startup test。

必须测试：

- Prompt Version 禁止 update；
- Label transaction move；
- `UNIQUE(session_id, seq)`；
- approval exactly-once。

验证并 commit。

## Milestone 3 — HTTP + WS

实现：

- Express；
- `/api/v1`；
- validation；
- error envelope；
- WebSocket；
- subscribe；
- reconnect/gap endpoint。

先用 deterministic fixture event。

验证并 commit。

## Milestone 4 — Agent Core

实现：

```ts
AgentRuntimeAdapter;
AgentSessionHandle;
AgentCapabilities;
NormalizedAgentEvent;
PreflightReport;
```

Provider-specific 类型不进 core。

Fake adapter 覆盖：

```text
create
stream
approval
cancel
complete
fail
disconnect
```

验证并 commit。

## Milestone 5 — Process Supervisor

实现：

- `spawn(shell:false)`；
- argv；
- absolute executable；
- stdio；
- process group；
- cancel；
- timeout；
- crash；
- redaction；
- bounded buffer。

测试 shell metachar/quotes/path/cancel。

验证并 commit。

---

# 11. ACP Adapter

使用官方：

```text
@agentclientprotocol/sdk
```

不要手写完整 JSON-RPC。

必须实现：

1. spawn ACP agent；
2. initialize；
3. capability；
4. session/new；
5. prompt；
6. session update；
7. permission；
8. close/cancel；
9. process exit；
10. normalize。

ACP v2 是 draft：**不作为 MVP 默认**。

将 ACP 类型严格封装在 `packages/adapter-acp`。

---

# 12. Event Normalization

集中 mapping：

```text
ACP text chunk   → assistant.message.delta
ACP message done → assistant.message.completed
ACP tool         → tool.call.*
ACP permission   → approval.requested
ACP plan         → agent.plan.updated
ACP usage        → usage.updated
```

保留：

```text
source.protocol
source.eventType
```

仅 debug 使用 raw payload；先 redaction。

不要让 UI 读 ACP 原始 JSON。

---

# 13. Codex 接入

优先：

```text
ACP Adapter
→ pinned @agentclientprotocol/codex-acp
→ Codex App Server
```

v0.1 不先直接写 Codex App Server client。

Preflight：

- ACP adapter；
- Codex binary/version；
- initialize；
- auth methods；
- session；
- capabilities。

**禁止复制 `~/.codex` auth/token 到 AgentHub DB。**

Codex plan/goal 只展示协议/官方接口明确提供给客户端的 user-facing state。

---

# 14. Claude Code 接入

优先：

```text
ACP Adapter
→ @agentclientprotocol/claude-agent-acp
→ Claude Agent SDK
```

不得自己用普通 Messages API 重做 Claude Code。

验证：

- permission；
- tool calls；
- session；
- model/mode capability；
- load/resume（若支持）；
- subagent visible events（若支持）。

保留 Claude 原生 `CLAUDE.md` 语义。

---

# 15. OpenCode

优先：

```text
opencode acp
```

native ACP。

`opencode serve`/SDK 是后续增强；v0.1 不维护两套。

---

# 16. Hermes

优先：

```text
hermes acp
```

可用时 preflight：

```text
hermes acp --version
hermes acp --check
```

不要硬编码 Hermes toolset；按 ACP capability/event。

---

# 17. OpenClaw

不强行 ACP。

## Gateway

用官方 Gateway protocol/client；检测已有 Gateway，不自动再启动第二个。

Token 只 secret reference。

## Exec fallback

用官方：

```text
openclaw agent exec --message-file ... --cwd ... --json
```

UI 明确该 transport 的 capability 差异。

## ACP

只有当前官方版本明确暴露可用 ACP server 时才注册，禁止猜。

---

# 18. Agent Discovery

只读扫描。

状态：

```text
FOUND
READY
AUTH_REQUIRED
BROKEN
MISSING
UNSUPPORTED_VERSION
```

禁止 discovery 自动执行：

```text
npm install -g
pip install
curl | sh
```

Marketplace/自动 install 不是 MVP。

---

# 19. Session / Run 状态机

Session：

```text
CREATED
STARTING
READY
RUNNING
WAITING_APPROVAL
DISCONNECTED
FAILED
CLOSED
```

Run：

```text
QUEUED
RUNNING
WAITING_APPROVAL
COMPLETED
FAILED
CANCELED
```

写 transition tests，不随意 update string。

---

# 20. Persistence

不要每 token insert。

策略：

- delta live；
- semantic event persist；
- final message persist；
- tool output coalesce；
- raw trace optional retention。

必须保证：

- reload history；
- pending approval 恢复；
- WS reconnect；
- server restart 后状态一致。

---

# 21. Project / Filesystem

Project add：

- `realpath()`；
- exists；
- git；
- canonical root；
- path guard。

所有 file API：

```text
resolve(root, requested)
→ canonicalize
→ assert inside root
```

测试：

- `../`；
- absolute path；
- symlink escape；
- encoded traversal。

---

# 22. Git

MVP：

- status；
- diff；
- commits read；
- branches read；
- commit；
- BEFORE/AFTER snapshot。

不做：

- rebase UI；
- force push；
- reset --hard；
- full conflict editor。

Git 也必须 argv + cwd + shell:false。

---

# 23. Terminal

Project Workspace 提供用户 PTY。

注意：

```text
Agent tool execution != User Terminal
```

两条生命周期分开。

Terminal：

- project cwd；
- input/output；
- resize；
- close；
- platform capability。

平台不可用 → UI 降级，不阻塞 Agent core。

---

# 24. PromptOS 数据实现

先 service/tests，再 UI。

## Prompt

stable identity。

## Version

每次 Save：

```text
INSERT new version
```

禁止：

```text
UPDATE prompt_versions SET content...
```

## Label

- `latest` 自动；
- `production` 可移动；
- transaction。

## Diff

- TEXT → line diff；
- CHAT → message/role structure + content diff。

## Binding

必须实现：

```text
resolve(project, agent, task)
```

并返回最终 context + provenance。

发起 Run 时保存：

- prompt id；
- resolved version；
- label；
- content hash。

这样可回答：

> 这个 Run 到底用了哪一版 Prompt？

不要把 native `AGENTS.md` / `CLAUDE.md` 复制成 PromptOS 数据。

---

# 25. PromptOS UI

必须参考当前 Langfuse 官方 Prompt Management UI/文档，不靠记忆。

页面：

```text
Prompt List
Prompt Detail
  Versions
  Labels
  Diff
  Bindings
Playground
```

保存语义明确：

```text
Create new version
```

不能让用户误以为覆盖旧版本。

MVP Playground 默认只 Render：

- variables；
- side-by-side；
- diff；
- final rendered context。

Coding Agent live variant test 如果可能修改项目，不允许无隔离并行跑。

---

# 26. Workspace UI

必须参考当前 Codeg 官方 Workspace。

实现前创建：

```text
docs/design/reference-audit.md
```

每个参考记录：

```text
source
page/screenshot
borrowed pattern
AgentHub mapping
not included
```

Workspace 必须：

- conversation list；
- active conversation；
- tool cards；
- approvals；
- Files/Diff；
- Git changes；
- Terminal；
- cwd/branch；
- Agent；
- model/mode capability；
- Stop。

不要做一个普通聊天页面后声称“Workspace 完成”。

---

# 27. Dashboard / Task UI

Dashboard 参考 Paperclip control-plane：

- what's running；
- what needs attention；
- recent outcomes。

Task Board 参考 Codeg。

UI 可以显示四列：

```text
To do
In progress
Needs you
Done
```

但内部状态保留完整：

```text
BACKLOG/READY/RUNNING/BLOCKED/REVIEW/DONE/CANCELED
```

v0.1 不自动 worktree。

---

# 28. Security 不是最后补

每阶段都检查：

- secret；
- path；
- shell；
- permission；
- auth；
- logs；
- process。

尤其禁止：

> 为了 demo 先把所有 approval 自动 allow。

---

# 29. Server Auth

默认：

```text
127.0.0.1
local_trusted
```

如果 bind 非 loopback：

必须 token auth。

写测试：

```text
0.0.0.0 + auth off
→ startup rejected
```

不要默认把能执行 shell/Agent 的 Web UI 无认证暴露到 LAN。

---

# 30. Secret 规则

禁止 DB 明文：

- OpenAI key；
- Anthropic key；
- OpenClaw Gateway token；
- refresh token；
- cookies。

只保存 reference：

```json
{
  "kind": "ENV",
  "name": "OPENCLAW_GATEWAY_TOKEN"
}
```

日志中只能出现 secret name/source，不能出现 value。

---

# 31. UI/UX：禁止 AI 自由发挥

视觉来源固定：

- Workspace → Codeg；
- Task → Codeg；
- Agent Settings → Codeg；
- Dashboard → Paperclip；
- Prompt version/diff/playground → Langfuse；
- primitives → shadcn/ui/Radix。

新交互若没覆盖：

1. 先找成熟开发者工具参考；
2. 记录来源；
3. 再实现。

不要直接生成：

- 霓虹渐变；
- 巨型 hero；
- 玻璃拟态；
- 卡片墙；
- 无意义 KPI；
- 发光 AI 背景。

这是开发工具/控制平面。

---

# 32. Design QA

页面完成后真实运行浏览器。

至少验证：

```text
1440
1024
768
390
```

状态：

- loading；
- empty；
- error；
- disconnected；
- long path；
- long Agent name；
- huge tool output；
- pending approval；
- no Git；
- no Agent；
- auth required。

使用 NAS 本地 Playwright Chromium 连接真实部署目标并保存 baseline/after，同时记录四视口截图、console/页面错误、横向溢出和关键交互断言。如果当前没有任何浏览器运行能力，写入 PROGRESS 并明确视觉门禁未验证，不能用 fixture、静态 build 或 curl 冒充视觉证据。

---

# 33. 测试门禁

每个 slice 按影响范围：

```bash
pnpm lint
pnpm typecheck
pnpm test
```

重大 UI：

```bash
pnpm test:e2e
```

release 前：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

Live Agent：

```bash
AGENTHUB_E2E_LIVE=1 ...
```

结果按 Agent 分开。

---

# 34. Mock 规则

允许 mock：

- unit；
- adapter fixture；
- CI；
- deterministic E2E。

不允许：

- production 列表把 mock 显示成 READY；
- fake response 冒充 Codex/Claude；
- README 只因为加 enum 就声称“支持 Hermes”。

每个 Agent 至少要有：

```text
integration code
preflight
fixture tests
live smoke path
docs
```

才算支持。

---

# 35. Git Commit 规则

每个完成、测试后的 feature slice：

```bash
git status
git diff
# tests
git add <selected-files>
git commit
```

格式：

```text
type(scope): 中文标题

- 中文正文
- 关键改动
- 验证方式
```

示例：

```text
feat(adapter-acp): 建立 ACP 会话与事件归一化

- 使用官方 TypeScript SDK 建立 stdio client
- 支持 capability negotiation 与 session/new
- 将工具、消息和权限事件归一化到 AgentHub domain
- 增加 fixture 与取消测试
```

禁止：

- `wip`
- `update`
- `fix stuff`
- 一个 commit 整个 MVP
- 无关全仓格式化

---

# 36. Push / PR

默认：

**commit，但不自动 push。**

只有用户明确要求每 feature push，且 remote/branch 检查安全后才 push。

没有明确要求：

- commit；
- 最终列 commits；
- 不 push；
- 不建 PR。

---

# 37. PROGRESS.md

每个 milestone/commit 后更新：

```markdown
# Progress

## Current Goal

...

## Completed

- [x] Foundation
  - commit: abc123
  - tests: ...

## In Progress

...

## Blocked

...

## Live Integration Matrix

| Agent | Installed | Preflight | Fixture | Live | Notes |

## Deviations / Decisions

...
```

长 Goal 不依赖聊天上下文。

---

# 38. DECISIONS.md

只记录重要外部变化/架构偏差：

```markdown
## DEC-xxx

### Context

官方 ACP/OpenClaw/... 当前行为与设计快照有差异。

### Options

...

### Decision

...

### Why

...

### Impact

...
```

不要把普通变量命名写成 ADR。

---

# 39. Subagents

可用 Codex subagents 做独立审计：

1. Agent Integration Reviewer；
2. Security Reviewer；
3. Product/UI Reviewer；
4. Test Gap Reviewer。

不在无 worktree 时让多个 subagent 同时修改同一组文件。

Release 前建议至少三轮：

### Integration Reviewer

检查：

- ACP 边界；
- capability；
- lifecycle；
- cancel；
- session；
- reconnect。

### Security Reviewer

检查：

- path；
- shell；
- secret；
- auth；
- approval。

### Product/UI Reviewer

检查：

- 是否真的遵循 Codeg/Paperclip/Langfuse；
- 是否有假功能；
- loading/error/empty；
- Workspace 闭环。

Critical/High 修完再 release。

Subagents 会额外消耗 token，只用于真正独立且高价值审计。

---

# 40. v0.1 禁止顺手实现

```text
Multi-agent swarm
Workflow designer
Cron automation
Remote nodes
SSH targets
Automatic worktree queue
Marketplace
Plugin system
Promptfoo integration
Vector memory
RAG
Team/RBAC
SSO
Cost budgets
GitHub PR
Mobile apps
Full Git client
Docker sandbox fleet
Kubernetes
```

只留干净扩展点，不写大量 TODO。

---

# 41. Demo Definition of Done

最终必须跑通：

1. Clean start AgentHub；
2. Add Git project；
3. Agent discovery；
4. select real installed Agent（无实机则 fixture E2E + 明确 live unavailable）；
5. create session；
6. send turn；
7. see stream；
8. see tool call；
9. handle approval；
10. see file/Diff；
11. stop/cancel；
12. see Git status；
13. create Prompt；
14. create v2；
15. move production label；
16. bind to project/agent/task；
17. context resolve；
18. create Goal/Task；
19. Start with Agent；
20. Task → Review；
21. user review；
22. commit；
23. Task → Done；
24. restart server；
25. history/state still correct。

同时逐项核对技术方案中的全部 Definition of Done。

---

# 42. Release 最终报告

最终回答必须包含：

## Implemented

按模块。

## Commits

```text
sha title
```

## Tests

列出**实际执行命令 + pass/fail**，不能只说“测试通过”。

## Agent Matrix

```markdown
| Agent | Adapter | Fixture | Live Preflight | Live Session | Approval | Notes |
```

## Known Limitations

真实写。

## Security

说明：

- bind/auth；
- secret；
- path；
- approval；
- process。

## UI Reference Compliance

具体写：

- Codeg 借什么；
- Paperclip 借什么；
- Langfuse 借什么。

## Deferred

确认 post-MVP 功能没有混进 v0.1。

---

# 43. 不确定性处理

## 技术方案与当前官方 API 冲突

当前官方 API 优先，但保持方案的产品/架构意图；记录 DECISION + test。

## UI 不清楚

不要猜，先找参考产品。

## Agent 接口不清楚

不要猜，查官方 docs/repo/version。

## 非阻塞业务细节

采用技术方案最窄解释继续。

## 危险动作

涉及：

- 数据删除；
- secret 暴露；
- destructive Git；
- 未授权 push；
- 覆盖用户代码；

停止该危险动作并请求用户决策。

其他非阻塞问题不要频繁停下来问。

---

# 44. 八条工程纪律

1. 以暗猜接口为耻，以认真查阅为荣。
2. 以模糊执行为耻，以明确验证为荣。
3. 以盲想业务为耻，以方案约束为荣。
4. 以创造协议为耻，以复用 ACP/官方能力为荣。
5. 以跳过验证为耻，以主动测试为荣（但不要过度测试，不要做没有必要的测试，代码写得好，测试不需要那么多）。
6. 以破坏架构为耻，以遵循模块边界为荣。
7. 以假装支持为耻，以诚实报告能力为荣。
8. 以盲目修改为耻，以小步可回滚提交为荣。

---

# 45. 现在开始

## 用户只需要做一次的启动动作

在发送本提示词之前：

```text
1. 打开 AgentHub 仓库
2. 提供 AgentHub_PromptOS_MVP_技术方案.md 与本提示词
3. 用户手动切换到 Plan Mode（/plan 或客户端等价操作）
4. 发送本提示词
```

**不要让 Codex 自己“执行 `/plan`”；Plan Mode 是用户控制的会话模式。**

## Codex 收到提示词后的执行顺序

```text
1. 确认当前处于 Plan Mode
2. 读取完整技术方案和现有仓库
3. 检查 Git / runtime / Agent 环境
4. 完成 Phase 0 reference + architecture audit
5. 输出最终可执行 Plan：Milestone → Slice → Acceptance → Tests → Commit
6. 基于最终 Plan 自行设置 durable Goal
7. Goal 启动后落盘 PLAN.md / PROGRESS.md / DECISIONS.md，并建立/修订 AGENTS.md
8. 按 Milestone/Slice 逐步实现
9. 每个 slice 完成最小充分测试
10. 每个完成的 Feature/Slice 使用中文 Conventional Commit 提交并按仓库策略 push
11. 持续更新 PROGRESS
12. 对架构/API 变化记录 DECISIONS
13. 完成独立 integration/security/UI review
14. 修复 Critical/High
15. 跑 release gate
16. 对照 Definition of Done
17. 输出最终实施报告
```

## Plan → Goal 的硬规则

- **先 Plan，后 Goal。**
- Plan Mode 必须由用户切换；你不能假装自己切换模式。
- Plan 阶段不要开始业务实现。
- Plan 收敛后，如果客户端支持 agent-side Goal，由你直接设置 Goal。
- 不要让用户重复输入 `/goal`，除非当前客户端明确不支持 agent-side Goal 设置。
- Goal 必须引用技术方案和最终 Plan，而不是复制 2000+ 行方案正文。
- Goal 设置完成后持续执行，不要完成一个 skeleton 就停。

## OpenSpec 硬规则

- v0.1 MVP 默认不用 OpenSpec；
- 不初始化、不安装、不维护重复 Spec；
- 只有未来满足第 6 节条件且用户明确同意时才引入。

**Plan 完成后，不要仅因为“计划已经输出”就结束整个任务。Goal 的职责是继续推进实现。**

整个 Goal 应持续：

> 实现 → 验证 → 提交 → 更新进度 → 下一阶段，直到 v0.1 Definition of Done。

技术方案中的 MVP scope 和 non-goals 是边界。  
没有达到 Definition of Done，不要因为“主要框架搭完”就宣布完成。

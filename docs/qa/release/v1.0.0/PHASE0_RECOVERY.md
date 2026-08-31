# v1.0 Phase 0 接手与恢复记录

状态：**受 NAS 内存/swap 资源阻塞；可恢复检查点，尚未通过 Phase 0，不是 v1.0 Release Candidate。**

## 原任务结论

- 原任务：`01a0539c-7b87-7291-8078-d58078b75e12`。
- 原始 JSONL 最后一次执行在 `2026-08-30T18:22:07Z` 以
  `usage_limit_exceeded` 结束，没有发布完成记录。App 摘要只展示最早的 interrupted turn，
不能据此忽略后续已确认的实施授权。
- 用户已经批准完整实施、逐切片 commit/push、RC 全绿后的最终生产部署；
  生产验收只读，不创建或清理测试记录。原样批准计划见 `approved-plan.md`。
- 接手时 `main`、`origin/main` 及实时远端 head 都是
  `f4b5043b7c8a08228938320beecf5c9616f723c3`，只交付了规格包。
- v0.5–v0.9 未跟踪文档归用户所有，保持不动；原任务留下的格式化与 QA 修改分开交付。

## 本轮修复

- 截图每页原子更新 `audit.json`，使用独立输出目录，不再删除旧截图。
- 记录完整矩阵、当前页面、renderer crash 和尚未覆盖的状态；缺图、重复图、缺少主题或
  中断报告均不能当作完整采集。几何报告明确 `releaseReady: false`。
- 共享浏览器测量记录真实控件矩形、Workspace 面板、已测对齐项；尚未实现的列对齐、
  状态位移、Composer 阅读列与 drawer 规则明确标为未测，不伪称完整 Geometry Gate。
- 生产 token 仅复用现有受保护文件；只向目标源发送认证。所有写请求默认阻断，
  仅放行源码核验过的 Project 路径预检和 Prompt 上下文计算 POST。
- init script 仅在目标 origin 读取 localStorage，避免空白文档的 SecurityError。
- 隔离 Git 元数据读取只在该条命令配置已确认仓库的 `safe.directory`，不修改全局 Git 配置。
- 版本脚本读取真实 `pnpm-workspace.yaml`；损坏的 manifest 必须报错，且明确其仅证明
  package 一致性，不能代替 UI/health/OCI 版本核验。

## 已执行的代码门禁

| 命令 | 结果 |
| --- | --- |
| `corepack pnpm test` | 61 files / 256 tests passed；4 files / 10 tests skipped；333.90s |
| `node --test scripts/qa/visual-evidence.test.cjs` | 4/4 passed |
| `corepack pnpm lint` | passed |
| `corepack pnpm format:check` | passed |
| `corepack pnpm typecheck` | passed |
| `corepack pnpm build` | passed；保留已有 chunk-size warning |
| `git diff --check` | passed |
| `corepack pnpm release:version-truth 1.0.0` | failed，预期：package 仍是 0.6.0 |

这不是 live Agent、完整写流程或视觉验收通过的声明。所有截图基于当前产品代码及
原任务留下的机械格式化，不是已发布 v1.0；生产仍运行旧镜像。

## 浏览器恢复证据

普通用户启动显式 Chromium 仍出现 `/dev/mali0` `Permission denied`、GPU exit 139，
并在 Prompt 页面出现 `Page crashed`。设备为 `root:video`、0660。

本轮仅对 QA 子进程使用临时 `video` 主组，保留 Kkwans UID 与已有附属组：

```sh
sudo -n -u Kkwans -g video env \
  AGENTHUB_CHROMIUM_PATH=/home/Kkwans/.cache/ms-playwright/chromium-1234/chrome-linux/chrome \
  AGENTHUB_VISUAL_OUTPUT=/absolute/path/to/a-new-evidence-directory \
  /opt/node24/bin/node node_modules/@playwright/test/cli.js test \
  --config=playwright.real.config.ts tests/e2e-real/v1-baseline.spec.ts
```

不执行 `usermod`、设备 `chmod`、驱动修改或容器重启。若该命令权限不可用，应报告
能力缺口，不修改系统权限。浏览器 stderr 的 EGL/ANGLE 日志与页面 console/page error
分开记录；只有完整截图矩阵和报告可以证明采集完成。

### 最终确认的阻塞原因

`video` 组仅消除了设备访问拒绝，未解决整个稳定性问题。本轮最多采集 69/140 张，
前 69 张 console error、page error、failed request、横向溢出均为 0。
随后 renderer 被杀；390px 单独复跑及 root 复跑也失败，失败路由并不固定。

`journalctl -u earlyoom --since '2026-08-31 21:15:00'` 明确记录本次 Chromium
network service、GPU process 和 renderer 收到 SIGKILL。其中 renderer PID `1313321`
被杀时，swap free 为 5 MiB / 0.07%。这解释了后续随机 `Page crashed`，不能将它
全部归因于 Workspace 产品代码或 GPU 文件权限。已停止进一步浏览器重试，未停用保护服务。

当前 Chromium [官方 SwiftShader 参数](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/gpu/swiftshader.md)
为 `--use-gl=angle --use-angle=swiftshader`；采集配置已替换旧参数，但在资源阻塞消除前
仍属待完整视觉验证，不能声称此参数变更已经解决崩溃。

现有证据目录均保留：

- `docs/qa/visual/v1.0.0/00-baseline-production-f4b5043-01a057ea/`：首轮 26 张，主动停止。
- `docs/qa/visual/v1.0.0/00-baseline-production-f4b5043-01a057ea-r2/`：8 张，被只读保护停止。
- `docs/qa/visual/v1.0.0/00-baseline-isolated-f4b5043-01a057ea-video/`：69 张、失败 trace、
  `audit.json`、`geometry.json`、`SHA256SUMS`。Geometry 命令正确返回非零：矩阵未完成。

这些图片/trace 留在 NAS 工作树，不纳入本次工具恢复检查点，也不充当已通过的 v1 基线。

### 待授权的资源恢复方案（未执行）

- 已核验 `/volume2` 为 ext4，剩余约 7.2 TiB；`mkswap/swapon/swapoff/fallocate` 可用。
- 建议仅新增 8 GiB 临时 swap：
  `/volume2/Project/AgentHub/.tmp/qa-swap-01a057ea.swap`，创建前复核不存在且无 symlink escape，
  root 所有、0600，不修改 fstab、earlyoom、SSH、防火墙或现有服务。
- 影响：临时占用 8 GiB 磁盘并允许 QA 的冷页换出；不能保证高性能，但可避免当前 swap
  接近 0 时的立即杀进程。绝不覆盖现有 swap 或其他文件。
- 验证：启用后核对 `swapon --show` 与容量，先跑单视口诊断，再跑完整串行矩阵。
- 回滚：QA 结束且内存足以回迁时，仅 `swapoff` 该文件；成功确认已解除后删除该文件。
  如果 swapoff 失败，保留文件并报告，不强制删除，也不关闭其他服务。
- 这是 NAS 系统状态变更，不在已批准的应用发布范围内；须当前用户明确批准后执行。

## 剩余门禁与回滚

- 两套完整基线、Workspace running/approval/failed/closed/Git/terminal、异常状态截图
  和几何复核仍须补齐，之后才能进入 Design System。
- 规格包实际 102 文件，与其自带清单声明的 114 不一致；原文件保持不改。
  原命令聚合 SHA256 仍为 `edaddefde57bf3d26c4d404ae7aaa6d373b0d8ac35cd5561723f218a3d255e25`。
- 生产容器 `agenthub` healthy；镜像 `agenthub:0.8.0-nas.d09c575`，OCI revision
  `d09c575e2aaad749a8f0c822d89b3531d8634337`；health 0.6.0、Shell v0.9。
- 本轮未部署、未修改生产数据库、未修改 Compose 或创建新的生产回滚点。
  现有运行镜像及配置保持原状；后续发布前仍必须创建计划要求的备份与回滚点。

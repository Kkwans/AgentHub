# Git status 读取失败伪装 clean：只读调查

时间：2026-11-13 14:15–14:16 UTC。调查期间未修改生产服务语义。

## 已验证证据

`GitService.statusAt` 在 `git status --porcelain=v1 --branch -z --untracked-files=all` 非零退出时直接返回 `{ clean: true, entries: [] }`。

隔离真实 `/tmp` Git fixture，实际执行 `/usr/bin/git`，仅 Project/Snapshot repository 为内存 mock，不伪造 Git 命令结果：

- 合法 `git init`、无 HEAD 空仓库：status 正常成功且 clean，绿。
- 数据库 repoKind 非 GIT：公开 status 调用被 `PROJECT_NOT_GIT` 拒绝，绿。
- 损坏本测试仓库 `.git/index`：原命令非零且 stderr 指向 index；公开 service 返回 clean true 而非错误，红。
- 同一损坏条件 capture：仍调用 snapshot.create，写 statusJson.clean=true、diffStatJson.total/staged/unstaged/untracked 全 0，红。
- 数据库仍登记 GIT、实际 `.git` 已移除：requireGitProject 不检查实时仓库存在性，status 同样伪 clean，红。

最终实际运行 2 绿 / 3 红。测试补丁 `repro/git-status-failure.patch` 不在默认测试发现路径；`git apply --check` 通过。运行日志保留于本次工作环境 `/tmp/git-status-repro.log`，不以日志路径作为用户交付物。

未实测 chmod 权限失败（执行用户权限可能令模拟失真）；非零退出分支相同，按源码会受同一 fallback 影响，但不把它写成已验证场景。

## 调用与历史

- `GET /projects/:id/git/status` 的 route 调用 service.status 并将异常交中间件。当前伪 clean 会以正常数据到 UI，成为“工作区干净”的错误依据。
- `capture` 直接复用 statusAt，当前会存错误诊断快照。
- SessionService.captureGitSnapshot 的调用者已用 try/catch 包装 Git capture，注释明确诊断快照失败不能让成功 Agent Run 失败。BEFORE/AFTER 调用均经该包装。
- git blame 显示 fallback 自 `a6187eb3` 初始 Git service 提交存在；该提交同时已有 capture 的 best-effort catch。没有找到将失败视为干净的明确注释或测试合同，不能推断这是有意的合法空库处理。
- 现有 Git service 测试覆盖正常 status/diff/commit、路径安全、BEFORE/AFTER 快照，没有非零 status 或合法无 HEAD 专项对比。

## 最小修复（已获授权，实现候选）

用现有 `requireSuccess(result, 'GIT_STATUS_FAILED', 'Git 状态读取失败')` 取代非零 clean fallback。状态码沿现有 helper 的 409 语义，不透传 stderr（避免泄漏内部路径信息）。保留合法空库 status 成功、readHead 未创建 HEAD 的 undefined 行为，禁止把 readHead 非零一概变成 status 失败。

影响：公开 status 呈现可重试读取错误而不是干净；capture 在读取失败时不写伪快照；上层已有 best-effort wrapper 继续保护 Run，不需修改 Run 状态机。

正式实施应把上述 5 项纳入正常回归并转绿，补已有真实 Git service/Session capture 相关测试。不要借本片重构所有 Git 失败规则、修改提交动作、自动修复仓库或把诊断快照改为运行失败原因。

后续实现：已将非零 fallback 替换为 requireSuccess，并将五项复现纳入正常测试。增加真实 loopback status API 回归：409 + GIT_STATUS_FAILED，响应不含底层路径/index stderr；前端映射明确“是否干净尚未确认”。头部缓存 clean 在 error/loading 时不再显示干净 badge。未修改 Git 写动作或 Session 状态机。

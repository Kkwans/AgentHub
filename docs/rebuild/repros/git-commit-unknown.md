# Git 提交响应丢失：隔离复现与下一阶段合同

状态：已实际复现；尚未修复产品。基线 `2bc0086`，2026-11-13 18:27:56 UTC 完成。

## 实际结果，不扩大结论

专用 Vitest 运行 3 项，2 通过、1 **预期失败**。默认测试/产品源码未改。

- 服务测试使用 `/tmp` 内 `mkdtemp` 新建仓库、真实 `/usr/bin/git` 和真实 `GitService.commit`。仅项目 repository 查询为 stub；未使用真实用户仓库或外部 Git，也没有 push。
- 首次 service 已成功提交后，由测试包装器丢弃响应并抛错，模拟不确定传输结果。不是实际 TCP 断连或代理 5xx。
- 基线 HEAD `2abd6dbed4fe3be5f2e53c4357ae4063a5c6b44c`，首次提交 `ed4a2778d33ee63a0b8a1f726b030f381110e10b`。首次之后真实状态 clean。
- 然后测试主动修改同一路径，模拟另一个编辑者继续工作。以相同 `{mode:SELECTED,paths:[one.txt],message:same requested message}` 再次调用服务，得到 `3ade104317c5193d145dbdfe1d0d2236f301bdb4`，总提交数3（含基线），新内容确已入库。
- 这证明没有操作级幂等保护，不表示不改内容重试必然产生重复提交。一般无变更 Git 会拒绝；第二次新编辑是测试明确前提。
- UI 测试使用实际 GitChangesTree 与模拟 `ApiError(HTTP_ERROR,status=0)`；现状“可再次手动调用”通过，安全期望“未知后 retry disabled”失败，收到 enabled button。此UI测试与真实服务测试分开，不声称完整HTTP端到端已跑。
- 临时仓库在 `finally` 删除；结果 JSON 与测试日志随此文归档。日志 Vitest start 时间是进程本地时区，以上 UTC 来自实际 `date -u`。

首次探索因文档目录缺应用级模块解析失败，未执行测试；移到应用目录再跑才得到上述真实结果。归档 patch 可显式重放，不把失败用例留在应用默认构建内。

## 重放（专用临时 worktree）

```sh
git apply docs/rebuild/repros/git-commit-unknown.patch
./node_modules/.bin/vitest run --config docs/rebuild/repros/git-commit-unknown.vitest.config.ts --maxWorkers=1
# 当前产品预期 exit 1：2 passed, 1 failed。不要将此命令设为默认绿门。
git apply -R docs/rebuild/repros/git-commit-unknown.patch
```

配置仅包含 patch 的两个 `.repro` 文件。无需运行安装脚本/下载软件；使用已安装依赖和 Git。归档原样不包含应用内 repro，默认 Vitest include 与 server/web build 不会纳入。修复时应将红契约移入正常测试并转绿，不能删除断言制造成功。

## 确证的源码路径

- `GitChangesTree.tsx` commit：所有异常存为 error，finally 清 pending；原说明/选择保留，重试资格仅当前路径非空/说明非空/非pending。
- `useWorkspaceViewModel.ts` commitGit：POST mode/paths/message，只有成功时刷新Git queries。异常后旧 dirty 缓存可能继续保持选中路径。
- `api.ts`：fetch失败映射 `HTTP_ERROR/status0`，通用提示“请求失败，请稍后重试”；解析异常/5xx亦没有提交专用未知分类。
- `git-routes.ts` commit schema 没有 operationId、requestKey 或 expectedHead。响应 envelope 的 requestId 不等于持久操作键。
- `GitService.commit`：add、读before、commit、读after，成功才返回 beforeSha/sha/output，没有可查询的持久操作记录。GET status/headSha 和 commits 可供人核对，不证明某次未知操作身份。
- 另有成功receipt.sha可缺失但UI仍显示完成的边界，尚未在本片复现/修复，不把本片扩大成全部Git提交安全审计。

## 下一阶段最小安全合同（待授权实现）

1. 明确区分 pending、verified success、可证明尚未写入的拒绝、unknown。网络/中断/5xx/无法验证的响应不能冒充确定未提交。
2. 提交前冻结 project/path/message/操作身份；同步占锁避免同tick重复调用。unknown 保留原身份、说明、已选择路径与清楚的核对提示，不能用清error/改说明/取消选择绕过原操作锁。
3. 只有经审查的前置拒绝可释放锁重试；不能将所有4xx、`GIT_COMMIT_FAILED`（可能涉及hook/超时阶段）默认归为安全重试。成功需验证实际返回身份/有效SHA，不能仅收到2xx即声称完成。
4. 无自动POST重试，无“相似提交message/HEAD改变所以原操作已成功”的GET推断解锁。读取历史/状态只读核对，不会取消原Git请求。
5. 若先做同组件片，必须显式说明关闭/路由卸载/重挂/硬刷新不持久；不能称完整防重复。跨route/auth owner需另审身份隔离、撤权、ABA、旧终态不得解新锁、无consumer完成、可读原结果等合同。
6. 本复现没有覆盖真实HTTP丢包、并发Git外部修改互斥、服务器重启、auth切换、跨route、硬刷新或完整Git hook行为。不得据2个通过用例宣称这些已安全。

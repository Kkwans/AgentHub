# 历史分页请求与滚动归属

2026-11-14 11:11 UTC：前置窄修，不是正文搜索UI完成。

## 已实测故障及修复

原组件在修正测试fixture上红复现两项：A→B→A旧请求锁阻止新历史读取；用户已改变阅读位置时旧请求完成后的anchor抢滚动。引入Session/授权generation、请求owner、滚动意图与可取消rAF；旧finally不清新锁。正常成功/失败保留既有anchor。

useSessionMessages传递真实AbortSignal，只有发起该精确query的owner可主动取消，revert:false保留已加载历史。旧请求finally不能删除新owner；共享observer发起者卸载可取消当前读，剩余observer可重新读取。这不是跨账号缓存隔离。

授权订阅经独立hook而非展示组件直接导入API，保留原presentation架构门禁。

## 实际验证

- 最终web聚合97文件1178测试通过，166.24s；原聚合曾1项架构门禁失败，修复后重跑，并未删除断言。
- hook6例包含ABA与共享observer；原专项23例覆盖架构、分页、滚动及渲染。
- root lint/typecheck通过；独立integration types在并行运行时曾SIGKILL，串行重跑成功，全workspace串行build成功。
- 新history-pagination Playwright契约fixture24例（3情景×浅深×四宽）types/lint/list通过；**此时尚未运行浏览器**。自动发现于test:e2e，实际几何与截图须待精确CI，不拿单测代替。
- 浏览器数据是API契约fixture，不是数据库、真实Agent或部署验收。验证目标包括实际scrollTop/scrollHeight锚点、持续503后明确重试、切会话迟到响应不抢阅读位置与草稿。

正文搜索DB/服务仍是另一个未发布候选；搜索面板、跨页真实消息定位与501turn虚拟化证据另行实施。

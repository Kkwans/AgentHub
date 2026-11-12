# Task 与 Run 结果所有权

## 持久判断

Task结果回调必须同时满足：Task仍IN_PROGRESS；Run、Session、Task、项目和已分配Agent关联一致；Session是Task当前会话；Run持久状态与回调终态一致；Run是Session的latestRunId。缺失、错绑、过期或历史未知一律不自动推进Task。

Run创建先锁关联Task，再锁Session；插入Run和更新latestRunId同事务。回调按相同Task→Session顺序锁定，再验证和写入Task。R2先提交则R1回调被拒绝；R1先完成则其结果先线性化，后续R2不隐式重启Task。时间戳可能相同，随机UUID不表示先后，因此不按它们猜归属。

## 升级边界

0007为增量可空字段迁移，不删除已有Session/Run或推断历史顺序。历史会话latestRunId为NULL，历史Run回调不再自动改变Task。升级前应确认没有需要依赖旧进程继续回调的在途任务；本次没有对真实部署执行升级或改动其任务。

若历史Task仍IN_PROGRESS，先核对原Run、日志及实际工作目录结果，不应仅为清空状态而标记成功。待审阅Task可以使用已有正式审阅/返工流程；其他状态应依据实际结果和现有合法状态转换处理。这里不提供自动修复脚本，也不声称已有通用重启恢复功能。

直接在Task关联Session继续发送消息，不会自动把已WAITING_REVIEW/BLOCKED的Task改为IN_PROGRESS。这一既有产品边界仍待另行设计，不能把“新Run取得Session指针”理解为自动重启Task。

## 验证范围

真实PGlite测试覆盖双顺序、同时间戳、多种终态、不同Session、插入和指针更新故障的原子回滚、旧库升级、重开和重复迁移。PGlite并发Promise调用会串行执行，不能用它声称独立PostgreSQL多连接锁竞争实测。Session创建分布式预留、进程重启后的QUEUED恢复也不由该指针单独解决。

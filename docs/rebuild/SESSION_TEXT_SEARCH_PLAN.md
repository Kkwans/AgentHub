# 当前会话文字搜索与真实定位

状态（2026-11-14 11:35 UTC）：后端已随ecbd408发布；本批前端7c35a358与真实E2E c0420974已完成本地冻结验证（web101文件1209测试、root lint/types、integration types、串行build通过），准备推送浏览器门禁。四宽浅深/501turn/取消/成功后ABA共11例尚未实际浏览器验收，不宣称视觉或端到端完成。

## 范围和数据边界

仅当前Session已持久化的USER/ASSISTANT text，排除实时流、思考、工具、审批、附件/contentJson与其它续接Session。保持现有ADMIN授权模型，不虚构每Session owner权限。无Agent调用、无消息/Run/Session状态写入。搜索词不写URL、浏览器持久存储或日志。

## 后端候选合同

- POST `/sessions/:id/messages/search`，严格JSON `{query, upperSequence?, beforeSequence?}`；使用POST只为避免搜索词进入URL及query日志，它是只读操作。
- query trim后1–200字符；上界为首次max sequence，后续固定；beforeSequence向前递减。不存在Session返回404，未授权拒绝；CLOSED/disabled不禁止读取。
- 先按session/range/index取原始100条+1探测，不先按role过滤扩大扫描，再匹配USER/ASSISTANT字面大小写不敏感子串。`%/_`不作通配符/正则，SQL参数化。
- 最多20命中，DB生成每条≤400字符摘要，不向应用传回100条全文。输出消息ID、Session、role、time、sequence、snippet、upperSequence、nextBeforeSequence、scannedCount、exhausted。
- 超20命中时游标停在第20个已返回位置，其余下轮继续；未超过则到原始窗口末。0命中但仍有历史不能写“没有结果”。scannedCount只是本批扫描进度，不冒充全会话总量。
- 复用(sessionId,sequence)索引限制范围，不声称substring本身有索引加速或CPU预算已经证明；长文本/性能需独立验证。
- access/error日志实测去敏化：body query字段redaction；SQL异常不带cause泄漏参数；路由前畸形JSON解析也不能把词写日志。不要仅凭GET改POST就宣布隐私闭环。

## 前端真实定位闭环

顶栏小型搜索图标，独立轻量面板，不新建dashboard、不改变Composer key。结果显示角色、时间、纯文本摘要和定位操作。新查询/关闭/切Session/授权变化通过AbortSignal和generation双重作废。

定位分四段，不能以数组已加载或假锚点冒充完成：

1. 在已加载messages按精确Session+messageId+sequence查找；未找到串行复用100条历史分页。
2. 每次显式动作最多5页/500条或10秒；到预算显示继续加载/取消，不无限拉取。游标不前进、序号冲突或越过目标却找不到ID均报错。
3. 从完整turns找到持久消息所属turn，调整当前500-turn窗口，必要时virtualizer.scrollToIndex。
4. 待真实消息DOM挂载/测量后再滚动、focus(preventScroll)与短暂高亮；真实节点存在且可见才显示已定位。测量等待有限重试，失败不假成功。

定位持有历史加载/滚动期间暂停普通顶部翻页和3秒轮询的竞争，取消只撤销owned查询且revert:false；已加载历史可保留。停止流式自动跟随并取消旧rAF，允许显式回到最新，草稿不丢。

## 已发现的前置竞争与分片

源码现状：useSessionMessages queryFn未传signal；ChatConversationView加载旧页的finally+rAF没有Session/generation守卫。旧分页完成可能与新会话或新定位抢滚动。先做最小红复现/窄修，保护正常anchor和失败路径，再接搜索定位；10:59 UTC已用原组件和修正fixture红复现两个故障，候选19专项通过；仍未发布、未有新浏览器证据。

1. DB只读窗口与隔离PGlite测试，不迁移。
2. 服务/路由与真实HTTP日志保护测试。
3. 分页取消及迟到滚动前置修复，独立验证。
4. 搜索面板和真实定位，四宽浅深实际浏览器证据。
5. 超两页旧消息、超过500turn/虚拟窗口、0hit有历史、固定上界新增消息、中文/%/_/HTML、A→B→A/授权/关闭、预算取消与草稿保留。

归档/恢复、跨会话全文搜索、工具/公开思考搜索均另分片，不混入本轮。


## 前端实际分片与验收（11:35 UTC）

- 轻量搜索面板：scope/query/取消放独立hook；纯文本摘要、局部输入，不把搜索词写URL或持久存储。当前Session已保存USER/ASSISTANT，不扩大到工具、思考、附件或跨会话。
- 真实定位：连续旧页、每次5页/10秒硬预算、共享请求不越权取消；真实message ID+sequence/turn/window/virtualizer/DOM可见与focus回执，拒绝假成功。
- 三项独立CR均补回归：共享GET或reveal不响应signal时仍硬截止；等待历史时新滚动/回到最新取消整段；已完成请求按身份消费，A→B→A不重放、不清新请求。
- 手机顶栏改两行，标题/状态在首行，rename/export/search三个44px入口在工具行；代码与几何断言已写，实际像素尚待CI。Composer身份/key未改。
- 专项9文件66通过；最终web101文件1209通过155.40s，21文件指纹前后一致；全静态与串行build通过。11例E2E仅types/list通过，focused新增清单，无重试。
- 真实测试通过fixture复用当前隔离PGlite连接插入持久文本，然后搜索/分页走真实HTTP。501turn=1002条构造消息，不是真实供应商501次对话。

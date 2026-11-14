# Exact CI history pagination failures (open)
2026-11-14 23:35 UTC

- d67722b verify job132622763708: unit244files passed; token9passed; fixture82passed11skipped30notrun1failed. Mobile390light history success at line211, visible persisted message offset drift50px vs <=2.
- 7823aa0 verify job132624429429: unit244files passed; token9passed; fixture28passed3skipped92notrun1failed. Desktop1024light history success line195 scroll-height formula drift144px vs <=2.
- Trace d677: before H15181 top14512 client619, A-196 offset64; committed H31181 top30512 same client,offset69.741. Height delta16000 equals100 estimated rows*160. Formula correct at commit but message offset already differs5.741; later50.
- Trace782: before H14438 top13715 client678 A-194 offset69.649; committed H30529 top29662 offset133.212. Formula expected29806 vs29662 actual.
- Product only stores scrollHeight/top then samples3 stable heights or max12frames. Virtualizer estimate160 plus real measureElement means below-anchor changes are not necessarily prepend height. Risk is sourced; single-run causal root not yet proven.
- No tolerance/retry/timeout change. Independent read/trace+red-test diagnosis underway. Exact new UI workspace matrices passing do not close this issue.
- Download archive SHA782 e14d100f0f137e21f6721daa43dba06be882d3210fc95188479c2e068c9898ec; d677 3b0e3a91c429ccb11b2c685d0920e82f4bae792c1642b951738ab8ef8a3991fe.

## 23:36 UTC 红测与候选方案

- 新最小测试21例中20通过1预期失败：总高7000/scrollTop6000符合原公式，但消息offset64→114；用户接管配对通过。没有修改生产或浏览器阈值来变绿。
- 拟保存稳定messageId+sequence+viewport offset，prepend后优先同消息修正。虚拟行卸载则按当前turn身份定位再精调，不复用旧index，不focus/高亮。
- 有可见锚点时不得叠加总height公式；下方晚测量可能改变总height但不应移动阅读位置。只有无有效DOM几何的fallback才沿用原总高逻辑。
- ownership必须取消于用户/会话/授权/tail等现有边界，避免与virtualizer重复写scroll。候选未验收、未发布。

## 23:39 UTC 候选冻结

- 初始红测已被候选修复；最终scroll27/27通过（新增8组合），覆盖pending晚测量、下方+144不误滚、目标DOM卸载同身份重挂、相应用户接管。
- 有锚点时pending和commit均保offset；重挂先按当前identity取估计offset单次写入，不启动独立scrollToIndex reconcile。12帧上限不变，释放恢复原virtualizer callback，不额外滚动。
- 独立CR无阻断，局部lint/types通过；全lint/types/web全量/build冻结验证运行中。DOM替换unit不是实际virtualizer重挂证明，原浏览器<=2px断言完全未动。
- 52ff634在一次完整verify中通过244文件2493测试、词法9、fixture111（13跳过）；这不能抹去d677/782失败和可复现红测，不据此关闭问题。

23:42 UTC 最后一处CR修正：虚拟估值暂缺时不预先记remountIndex，只有有效offset且owner仍有效才记录和单次写入，允许剩余帧重试；12帧限制不变。最终27/27、web类型、局部lint通过，已重新冻结。先前启动的全web未覆盖这处最后调整，不能冒充最终候选全量；需重跑。

23:46 UTC 最终冻结验证结束：全仓lint/types、web117文件1408测试、串行build通过；两个代码/测试SHA与最终冻结清单一致。新真实分页与虚拟器重挂仍待精确CI，不能把单测当闭环。

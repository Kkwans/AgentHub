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

## 2026-11-15 00:02 UTC：52999a6 精确浏览器仍失败，追加取证

- 最终候选已推52999a6。精确verify先通过246文件2506单测（12跳过）及词法9项，但fixture首个1440浅色case在总高合同差8px失败，后续未跑，不能宣布闭环。Workspace24/24、PG、axe通过不替代此失败。
- 失败artifact：before H14789/S13675/A-193 Y69.1798；committed H30789/S29683/Y64.1810。总高公式+8，同一消息约−5；不是只看8就证明两4px动画。
- 源码确有两层hci-entry几何入场（各translateY4px）；rect包含而scrollHeight不含，虚拟重挂会重播，是待证风险而非已证单因。不得减常数、放宽2px、移除virtual-item定位transform。
- 仅追加诊断：连续同帧H/S/原点击与before双消息identity/offset/contentY、virtual rows、祖先transform和动画状态，失败附件保留；原两条<=2px及超时/重试不变。
- 短工作区CI追加1440浅色单个历史诊断用例以提前取证，verify完整四宽双主题及全部测试不删减。短job仍20分钟、串行1worker/0retry，两个输出目录一并always上传。

## 2026-11-15 00:10 UTC：643 同帧证据与有限 UI 修复

- 643短门禁24+1通过，未复现失败；诊断16帧/6标记/drop0。点击A-193 Y125.649，两层transformY0.624215+0.024935；before Y125.1805，点击到测试baseline已漂约0.469，不能混为同帧。
- prepend后同消息两层动画currentTime重新归0，各translateY4=8px。总H30696恒定，virtual行定位固定，S29533→29531→29530→29529→29528→29527→29526来抵消动画。提交快照height差3但消息差约0.004，后来poll等到两合同合格。
- 结束记录时重挂动画150/200ms仍运行，不是动画/owner完全释放证明，也未证明529持续8px失败的全部单因。已证的是历史重挂的可变几何入场风险。
- 本片仅两层改专用conversation-entry-fade（opacity0→1），保时长/easing/both/reduced-motion；不改全局hci-entry或virtual-item定位transform，不减8常数/放宽门禁。
- 最终冻结验证：web+UI137文件1501测试、lint/types/build、CSS预算通过，4代码/测试SHA一致，独立CR无阻断。精确新浏览器仍待验证。

## 2026-11-15 00:27 UTC：完整矩阵与失败/成功连续证据

- 643完整verify仍失败：1440深色3pass后总高合同7px。1701帧最终两动画finished/transform0，Y由before36.9772变29，真实阅读偏约7.98；虚拟行/list总高稳定，无下方late尺寸变化。首次双4px入场补偿后留下偏移；owner具体clear路径未记录，不能断言。
- 61短24+1通过：18帧A-193的Y从click/before到commit/afterEach恒为82，H15307→31307且S14180→30180，两动画仍运行但transform均none。
- 61完整verify通过：247文件2508测试（12跳过）、词法9、fixture111过13跳过，原四宽双主题history合同未改。focused/full大矩阵尚待最终结果，不把verify通过写作所有CI绿。
- 已人工看61手机390浅色及桌面1440深色当前会话图；是隔离项目/合成会话，不是生产provider验收。

00:28 UTC 独立复核61完整HTML报告：history24/24 passed、retry0；8个成功案例均有独立诊断。四宽浅/深click=before=commit=afterEach偏移分别1440的129/36、1024的92/105、768的74/74、390的14/14；全部mounted采样内两动画transform none、总高残差0、drop0。窗口138–243ms，不延伸为长期晚媒体压力测试。

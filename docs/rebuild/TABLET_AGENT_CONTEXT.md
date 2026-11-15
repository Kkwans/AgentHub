# 平板顶部 Agent 上下文收缩边界

## 已证问题

61b2bce隔离应用的768浅深截图显示：顶部长Agent名称超出details实际分配宽度，与相邻“审阅更改”文字重叠。1024及手机没有同样证据。不是检查器内部toolbar，也不是focus框或fixture文本含义问题。

## 最小方案

只在768–1179px约束details→summary→summary-content→内部label的收缩链，名称自身省略；至少保Agent身份可见，完整名称仍在原生summary可访问名称和展开内容。弹层不裁切、原键盘行为不变。保手机菜单、宽屏和Inspector原样；顶部summary44px仍放在既有48px框，不增加顶部布局层级。

## 验证计划与状态

- 新2项样式合同通过，未修改JSX/原生行为。
- 真实content四宽双主题capture新增平板同帧owner/summary/content/name/review边界与完整可访问名称断言；不得通过只隐藏名称规避重叠。
- full lint/types/web/build冻结验证运行中；8场景发现、scoped lint/格式通过。新实图前不宣称视觉验收。

00:29 UTC 最终冻结：全lint/types、web118文件1410测试、build、三个源码/测试SHA一致通过；独立CR无阻断。8项真实场景发现成功，不交叠及顶部实际高度仍待新CI与截图。

00:36 UTC 补验收：折叠名称不重叠不代表展开内容可读。源码显示平板弹层内部仍单行 flex，长名称/cwd存在溢出风险，尚无展开实图证明。新增768/1024双主题原生Enter展开/关闭、焦点、完整名称/cwd、逐行文字Range及容器溢出门禁；先保存展开PNG和几何JSON，再断言，保留失败证据。未改产品CSS，新增真实门禁尚待CI；静态lint/类型/格式与8场景发现通过。

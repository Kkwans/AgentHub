# Diff词法预加载与启动记录视觉修正

2026-11-14 04:47 UTC，开发分支候选，真实浏览器新结果仍待CI。

## 实际证据

- 82c5421精确CI verify：85通过、10跳过、1个mobile TSX可见删除token失败。期望F4C7AF，实际D4D4D4。原始pane已是词法token，inline删除view-zone仍保留旧普通文本token；没有放宽门禁接受灰色。
- Monaco 0.56本地源码的inline view-zone只观察tokenization完成状态，不逐次观察token变更。采用公开 `editor.colorize('', language, {})` 等待懒加载语法器，再挂载Diff；保留原文、语言token和颜色规则，不按整条删除区域硬染字符串色。
- 实际698fc01真实服务artifact14097813543的1440/390启动记录截图，SHA256 2aae5655477b4c9540488ecc5ad7e378f0a4faa703b83e67529d96351d9bb50b匹配。发现贴边和全宽焦点轮廓裁切；补20px内距、内容宽summary、内收焦点轮廓、字段细灰边框。

## 验证与边界

- DiffViewer/FileInspector/theme专项17通过；启动记录面板专项13通过。
- 类型、lint、build、CSS预算通过；真实审阅E2E文件类型通过，发现5条用例不等于执行。新增内距与焦点几何断言，保留只读请求、状态不变与真实截图附件。
- 本机浏览器不可运行；不能把静态检查称为视觉验收。推开发分支触发精确CI，读取可见token结果与新1440/390截图后才作最终视觉结论。
- 本切片没有runtime归属后端改动；相关候选仍在独立验证，不合并main、不部署。

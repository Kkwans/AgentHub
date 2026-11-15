# 工具标题键盘焦点完整边框

## 依据

2026-11-15 04:06 UTC 实审 56ba966 精确 focused artifact 的 390 浅色、768 浅色、1440 深色长工具输出展开截图：焦点上下边框被裁，只剩左右竖线。均是公开合成 ACP Fixture，并非真实供应商隐藏思考或生产会话。

## 原因与方案

主按钮外扩 ring 被标题 overflow:hidden（上下 padding 0）裁切；展开 card 也保持 overflow-hidden。主按钮新增专用 tool-entry-toggle，focus-visible 使用 2px 实色内描边、offset -2px，清除外扩 shadow。不移除可见焦点，不改变圆角、长文本裁切、按钮高度、折叠、文件跳转或任何 Agent 执行动作。

独立 CR 指出旧 interactive:focus-visible 仍服务于计划原生 summary，已恢复该规则；新规则只追加，测试同时锁定保留计划焦点。初稿删除旧规则的错误不隐去。

## 验证边界

恢复计划焦点后的最终局部 10 项、E2E 严格类型及原 8 场景收集通过；独立 CR 复核阻断已解决。完整聚合 lint、types、全仓 pnpm test、build、CSS 预算已顺序通过（退出0）；最终测试摘要被工具输出长度截断，因此不捏造全仓数量。样式预算无错误，原有3条大小警告保留。现有真实过程展示 8 场景保留，展开截图后追加 actual focus / outline-width/style/offset / box-shadow / header 内几何断言，不替换原输出80行、键盘展开收起、状态、滚动与页面错误检查。必须等新提交精确 CI 与四宽浅深新截图后才关闭视觉问题。本地 Chromium 受 socket 权限限制，未把未启动页面称为浏览器验收。

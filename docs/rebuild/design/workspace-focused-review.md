# C36：临时专注审阅

状态：已发布ba8f625，主整合59项聚焦回归与产品/E2E静态CR通过；精确CI43465773377的真实浏览器截图待验。

## 依据

bb107c1实际桌面1440暗色split图中，检查器仍约380px，两侧代码各约159–181px。默认统一正确，但用户明确选择分栏需要可发现的临时扩展入口。只提高520px最大值仍受中列560px、左栏和ratio上限限制。

## 合同

- 仅Workspace使用共享ThreeColumnSplit的可选`rightFocused`，默认false。
- 手机不提供无效入口；中宽原dialog在右侧激活时扩至host-32px；宽屏原右slot占满grid，前四slot hidden/inert但保留节点。
- 不改变默认比例、宽屏中列约束或localStorage。不创建第二Inspector/Monaco，不修改Git操作参数。
- header入口“专注审阅”/“退出专注审阅”，44px、aria-pressed，键盘焦点清晰。
- Escape尊重defaultPrevented，第一下只退出专注并回入口；中宽原抽屉保留，第二下才执行原关闭。内部菜单先消费Escape时不越级退出。
- 关闭检查器、切会话辅助栏、切换会话ID、进入手机时立即使专注失效，不在回到原视口后自行复活。
- 正在拖栏时进入专注取消拖动，不保存半截ratio。进入/退出专注本身不发请求、不取消pending。

## 验证范围与限制

共享源码回归检查wide/medium同textarea与pending节点、同dialog、对话节点不重挂、恢复原columns、无storage写入与closed-right失效保护。Workspace回归使用真实组件+deferred mock Git提交，验证草稿/提交按钮同节点、只有一次原POST、专注退出不取消完成结果；并核对对话草稿、两次Escape、左右辅助切换/phone往返/会话身份边界。

本片只保证相同layout模式内的专注切换保持节点。原single/medium/wide不同布局组件跨断点可能重挂，不能声称跨断点提交草稿持久化。几何、浏览器键盘、Monaco实际节点和axe由主E2E验证，本地jsdom不代替这些证据。

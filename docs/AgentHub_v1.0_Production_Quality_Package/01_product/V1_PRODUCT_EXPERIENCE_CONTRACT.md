# v1.0 Product Experience Contract

## 北极星

用户打开 AgentHub 后，应能在 5 秒内回答：

1. 我当前正在做什么？
2. 哪件事需要我处理？
3. Agent 现在在做什么？
4. 它改了什么？
5. 我下一步可以做什么？

如果页面展示了很多数据却不能更快回答上述问题，就是信息噪音。

## 产品体验层级

### Primary
Project / Session / Work / Message / Change

### Secondary
Agent / Prompt Asset / Approval / Run

### Tertiary
Tool Call / Execution Target / Container / Internal ID / raw path

默认 UI 必须按这个层级排序。

## 5 条交互律

1. **Action near context**：动作必须靠近作用对象。
2. **Progressive disclosure**：路径、hash、raw payload、diagnostics 延后展示。
3. **Stable geometry**：加载/错误/空态不导致页面大幅跳动。
4. **Recoverability**：失败状态告诉用户下一步，不只报错。
5. **Preserve focus**：打开 Diff/Terminal/Context 不让用户丢失当前工作位置。

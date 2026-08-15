# ADR-019：共享表单控件的可访问性语义

状态：已接受

日期：2026-08-15

## 背景

v0.6 已把 Project、Agent、Session、Task、PromptOS、Settings 等写入入口收口到
`@agenthub/ui`，但共享 `Field` 原本把 `aria-describedby` 和 `aria-invalid` 放在包裹控件的
`div` 上。视觉状态虽然存在，真实输入控件却无法稳定关联说明与错误；共享文本控件也没有统一
的 `autocomplete` 和 `name` 默认值，普通用户可能看到错误提示但辅助技术或浏览器无法定位到对应字段。

## 决策

- `Field` 继续负责 label、说明和错误文案的 ID 生成，但把可访问属性克隆到真实 child control；
  若 child 已有 `aria-describedby`，按顺序合并，不覆盖调用方语义。
- `FormTextField` 与 `FormTextArea` 在没有显式 `name` 时回退到 `id`，并默认
  `autocomplete="off"`；认证表单不使用该默认值，而是显式声明标准 autocomplete token。
- 不以 CSS 或外层 `aria-label` 代替语义控件；错误保留字段级关联，异步提交错误继续由页面使用
  `role="alert"` 或 `role="status"` 呈现。

## 验证

`apps/web/src/components/FormFields.test.tsx` 覆盖：

- 文本输入的 `name`、`autocomplete`、`aria-invalid` 与说明/错误 ID；
- 自定义 select child 的说明关联；
- textarea 的稳定 name 与自动填充策略；
- SelectField 的 label/value 行为。

聚焦测试：`corepack pnpm exec vitest run apps/web/src/components/FormFields.test.tsx`，4/4 通过。

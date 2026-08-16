# v0.6 PromptOS Presentation 收口记录

日期：2026-08-16  
代码提交：`8adb2a5`

## 变更范围

- Prompt Version 列表将 `UI`、`PROJECT_SCAN` 等内部来源映射为中文来源文案。
- Prompt Version 创建者不再直接显示 `local-user` 等内部标识，改为普通用户可理解的创建者文案。
- Skill 列表将扫描来源映射为中文。
- Binding 列表将数值 `priority` 映射为“默认顺序 / 更优先 / 较后执行”，避免直接暴露内部字段语义。
- Binding 表单说明修正为“数字越小越优先”，与服务端解析顺序一致。

## 验证

```text
corepack pnpm exec vitest run apps/web/src/presentation/domain-labels.test.ts apps/web/src/pages/PromptOsPage.test.tsx --reporter=dot
2 files / 4 tests passed
corepack pnpm lint
passed
corepack pnpm typecheck
passed
corepack pnpm build
passed; Web 1716 modules transformed
```

## 边界

- 本切片不改变 PromptOS API、数据库字段或解析算法，只修复展示层和错误说明。
- 本记录不是 TX5Pro/人工视觉验收；当前环境仍没有授权浏览器通道。
- NAS 当前仍运行 nas.33；本切片尚未声明已部署。

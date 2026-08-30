# CSS Ownership Migration

## Current
`workspace.module.css` ~78KB。

## Target
每个视觉组件一个 module；WorkspaceShell 只管 grid/panel geometry。

## Migration sequence
1. 建 tokens，不改 UI。
2. 抽 SessionRail styles。
3. 抽 Conversation。
4. 抽 Composer。
5. 抽 Inspector/Git/Diff。
6. 抽 Terminal。
7. 删除 global bridge。
8. `workspace.module.css` 目标 <16KB，只保留 shell/responsive。

## Guard
新增 ESLint/stylelint-like script：禁止 feature module 中覆盖 `--ah-accent-*`；统计 CSS bytes/selector count。

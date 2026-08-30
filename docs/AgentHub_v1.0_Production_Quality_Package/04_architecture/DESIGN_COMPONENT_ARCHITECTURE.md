# Design Component Architecture

## packages/ui 新增建议
- AhPageHeader
- AhToolbar
- AhEntityRow
- AhPanelHeader
- AhStatusDot
- AhSettingRow
- AhLocalNav
- AhTreeRow
- AhEmptyInline
- AhErrorInline

## 不要放 packages/ui
业务专属 Composer、GitChangesTree、ApprovalCard 留 feature 内。

共享标准：geometry + interaction 可复用才上 UI package。

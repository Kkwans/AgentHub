# File Migration Map

## Workspace
`workspace.module.css` → shell + component modules，最终目标 <16KB。

`WorkspacePage.tsx` → composition + hooks。

`Composer.tsx` → ComposerSurface / ComposerToolbar / ContextPopover / SessionConfigPopover / SlashCommandMenu。

`Conversation.tsx` → Conversation / Message / ExecutionGroup / ThoughtGroup / ApprovalCard。

`GitChangesTree.tsx` → ChangesView / ChangeTree / ChangeTreeNode / CommitDock / GitHistoryDrawer。

## Prompt
PromptLibraryPage → asset-list / editor / tabs / lifecycle drawer + hooks。

## Settings
SettingsPageView → route section layout + section components；删除 legacy class contract。

## Shared
新增 PageLayout / Toolbar / EntityRow / LocalNav / SettingRow contracts。

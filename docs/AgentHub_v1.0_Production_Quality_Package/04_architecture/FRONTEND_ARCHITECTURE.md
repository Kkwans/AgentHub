# Frontend Architecture v1

## Feature structure

```text
features/workspace/
  pages/WorkspacePage.tsx
  hooks/
    useWorkspaceSession.ts
    useWorkspaceRealtime.ts
    useWorkspaceGit.ts
    useWorkspacePromptContext.ts
    useWorkspaceLayout.ts
    useWorkspaceTerminal.ts
  components/
    shell/
    session/
    conversation/
    composer/
    inspector/
    git/
    activity/
    run/
    terminal/
```

## Rule
Page 只做 composition。Query/mutation 进入 hooks；UI component 不直接了解所有 API。

## Prompt
同样拆 `usePromptAsset`, `usePromptLifecycle`, `usePromptBindings`。

## Settings
route-driven sections，每 section 自己组件，不再单页条件渲染所有内容。

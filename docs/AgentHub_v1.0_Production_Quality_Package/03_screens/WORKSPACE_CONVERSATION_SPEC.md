# Workspace Conversation Spec

## Message flow
User / Agent markdown 为 primary。Thought、Tool、Plan 不是等权 message。

### Execution Group
连续 tool events 合并：`执行了 6 个操作 · 3 文件 · 2 命令 · 1 搜索`，点击 Inspector Activity。

### Thought Group
默认折叠/streaming one-line，完成后可展开。

### Approval
内嵌高优先级 card，但 resolved 后压缩成一行 receipt。

### Long history
>500 items 使用分页/window；保持 anchor；Jump to latest floating button。

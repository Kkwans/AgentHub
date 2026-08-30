# Backend Delta — v1.0 最小化原则

v1.0 不以新增后端能力为目标。只有以下 UI 质量需要时才加 API：

1. file-scoped diff endpoint 返回 language/path/stats/patch；
2. Git status 提供 directory aggregate/stat；
3. Session list 提供 active/closed pagination 或 server filters（数据量大时）；
4. Conversation history pagination；
5. release/version endpoint（可选）。

禁止为了 UI rewrite 改 Agent adapter/approval ownership/worktree semantics。

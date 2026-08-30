# Suggested API Contract Deltas

## Git file diff
`GET /projects/:id/git/diff/file?path=...&staged=false&whitespace=default`

返回：path, language, status, additions, deletions, original, modified, truncated。

## Sessions
`GET /sessions?projectId=&stateGroup=active|history&cursor=&limit=`

## Messages
`GET /sessions/:id/messages?beforeSequence=&limit=100`

这些是“当真实数据触发前端性能问题时”的增量，不要求第一天全部实现。

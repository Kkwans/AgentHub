# State / Query / Realtime

## Query
保留 TanStack Query。避免每个 realtime event invalidate 6–8 个完整 query；v1.0 可逐步直接 merge message/event/run state。

## Workspace
- event stream append into cache
- sessions summary targeted update
- git status 5s polling only when Changes visible
- file content only selected file
- Monaco lazy

## URL State
Inspector tab/file/change/whitespace 可保留 URL deep link；panel pixel size 留 localStorage，不写 URL。

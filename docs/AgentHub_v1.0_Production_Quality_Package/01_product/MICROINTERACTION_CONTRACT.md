# Microinteraction Contract

## Hover
仅改变 surface tone/border，不默认抬升 2–4px。生产工具中 hover 不应产生“卡片漂浮”。

## Press
80–120ms，轻微 darken；不缩放正文区域。

## Panel enter
120–180ms；只 transform/opacity；resize 不动画以避免滞后。

## Streaming
Agent streaming 不使用闪烁 skeleton；用稳定 caret/soft pulse。

## Success
Commit/Save 成功使用 inline receipt，2–4s 后淡化；关键 sha/result 保持可复制。

## Error
不 shake UI；在原操作位置出现 error + retry。

## Drag resize
separator hover 扩大 hit zone 到 8–10px，视觉线仍 1px。

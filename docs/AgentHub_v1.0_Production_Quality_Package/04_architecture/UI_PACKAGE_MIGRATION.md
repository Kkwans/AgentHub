# @agenthub/ui Migration Plan

## Phase A — additive
新增 token / primitives，不删除旧 Ah*。

## Phase B — feature adoption
Home/Projects/Workspace/Settings 逐步使用新 primitive。

## Phase C — compatibility removal
统计 `.ah-compat-*` 使用；0 consumer 后删除 compat skin。

## Rule
UI package 不应成为另一套业务组件仓库；只提供跨 feature 的视觉/交互 contract。
